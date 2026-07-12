# Escape the Heat — code

Static web app, no build step. Serve the folder with any static server, or use the
Claude launch config `escape-the-heat` (port 5147). Deployment: see `DEPLOY.md`.

## Files
- `index.html` — layout: map, top bar (brand, live temp, language toggle), locate button, bottom sheet (layer chips, notice, recommendation/detail card)
- `styles.css` — minimal light theme, glass surfaces, mobile-first (desktop = floating panel)
- `app.js` — all logic; `CATEGORIES` at the top is the single place to add/tune layers (Overpass selectors, search radius, cooling °C, recommendation eligibility)
- `manifest.webmanifest`, `sw.js`, `icons/` — PWA layer (installable on
  phones); the service worker registers on deployed origins only, never on
  localhost, and uses stale-while-revalidate for shell + CDN assets — bump
  `CACHE` in `sw.js` when deploying an update
- `DEPLOY.md` — deployment options (Netlify Drop / Vercel / GitHub Pages)

## Opening hours (cool buildings)
- `openState()` parses the common OSM `opening_hours` subset (24/7, day
  ranges/lists, multiple + overnight time ranges, off/closed rules); exotic
  syntax (month rules, sunrise…) returns null = unknown
- Card shows a green **Open now** / red **Closed now** badge when known;
  known-closed buildings are dimmed on the map and excluded from the
  recommendation; unknown hours get a daytime assumption (08–20) for
  recommendation purposes only — no badge is shown

## External services (all free, no API keys)
- **Overpass API** (`overpass-api.de`) — OSM cooling spots
- **Open-Meteo** — current air temperature
- **OSRM foot profile** (`routing.openstreetmap.de`) — walking routes; haversine estimate used until a route is requested
- **CARTO Positron** tiles — light minimal basemap

## Behaviour notes
- Language auto-detects (cs/en), toggle persisted in `localStorage` (`eth-lang`)
- Geolocation denied/unavailable → falls back to Prague centre with a notice
- **Czechia only**: map is clamped to CZ bounds (`maxBounds`, minZoom 7), and
  both Overpass and heat-map fetches are skipped outside the CZ bbox; a
  geolocation outside CZ falls back to Prague with an `outsideCz` notice
- **Smart picks** row above the card: 🏊 nearest swim spot, 🌲 best green
  escape (park/forest by cooling-vs-walk score), 🚰 nearest drinking water —
  tap to select; hidden in heat mode, respects layer toggles, distances
  always from the user's location
- If the boot fetch fails (throttling), the recommendation card fills in
  automatically when a later fetch succeeds
- **Quips**: every card shows a rotating quirky one-liner per place type
  (`I18N[lang].quips`, cs + en); buildings get subtype-specific lines
  (church/library/townhall/community_centre/mall via `spot.sub`); chosen
  once per selection (no flicker on re-render), avoids immediate repeats
- Recommendation = max of `cooling / (walkMinutes + 4)` over recommend-eligible categories, always relative to the *user's* location (not the map view)
- Estimated local temperature = current temp − category cooling offset
- Benches and toilets are off by default to keep the map calm

## Dynamic data loading (pan anywhere)
- Spots load around the current map centre whenever the user pans/zooms outside
  previously fetched areas (`loadedAreas` circles; 350 ms debounce on `moveend`)
- Fetch radius scales with the viewport, clamped per category (`radius`…`maxRadius`)
- City-wide views (span > 2.5 km) fetch only parks/forests/misting — point
  amenities would be capped out of view anyway; such "wide" areas don't count
  as coverage for later close-up views
- Everything fetched is cached for the session (`spotCache`), markers are
  rendered only for the viewport, closest-to-centre first, capped per category
  by zoom (120 / 60 / 30)
- Overpass endpoint rotation (overpass-api.de → kumi.systems → private.coffee)
  with a 15 s per-attempt timeout, plus an automatic 20 s retry after total
  failure — Overpass throttles bursts, so this matters in practice
- `window.__eth = { map, state, czGenitive, spotTitle, setMode, selectSpot }` is a console debug handle

## Naming unnamed spots
- When the card shows an unnamed spot, it's reverse-geocoded via Nominatim
  (lazy, one request per shown spot, cached on the spot object)
- Czech titles use a genitive declension helper (`czGenitive`) → "Pítko u
  Obecního domu", "Lavička u Truhlářské"; when declension isn't confidently
  possible (Florenc, plurals) it falls back to "Pítko · Florenc"
- English composes "Drinking fountain on Týnská" / "Bench near Josefov"

## Clustering
- 2+ spots of the same category within 200 m (`CLUSTER_CATS`: bench, water,
  fountain, toilets, misting) collapse into one marker with a count badge
- Tapping shows "66 benches on Karlínské náměstí" in the card and expands
  the members as small blue dots; tapping empty map collapses back
- Czech plurals handled (2–4 "lavičky", 5+ "laviček"); caps apply after
  clustering, so a cluster counts as one marker

## Cool buildings 🏛️
- Free-entry public buildings that are reliably cool inside: libraries,
  community centres, town halls, churches (place_of_worship), malls
- `fee=yes` and `access=no|private|customers` are excluded
- There is NO reliable "has AC" dataset — OSM's `air_conditioning=yes` tag is
  too sparse and city cooling-centre lists aren't APIs; this proxy is the
  honest MVP, curated lists can layer on later

## Area polygons (parks, greenery, swimmable water)
- Parks/greenery/swimmable water are fetched **with geometry** (`out geom`,
  relations stitched into rings incl. holes; empty member role = outer) and
  drawn as smoothed polygons (Chaikin corner-cutting) in a dedicated `greens`
  pane below routes/markers — green for parks/greenery, blue for water
- "Park" includes leisure=park/garden (non-private), landuse=village_green
  (Czech squares!) and recreation_ground
- Unnamed green shapes are dropped as scraps when smaller than 500 m²
  (`MIN_GREEN_AREA_M2`) **or narrower than 15 m effective width**
  (`MIN_GREEN_WIDTH_M`, width = 2·area/perimeter — catches roadside verge
  strips that pass the area test); named areas and `leisure=park` are exempt
- 🌳 icons only on **named** parks; greenery has no icons at all — the shape
  shows the area; polygons are clickable (select → blue outline)
- One 🏊 swim category groups pools, water parks, swimming areas AND
  natural water that is **explicitly swimmable** (`swimming=yes` or
  `sport=swimming`); `access=private` pools and `swimming=no`/`access=no`
  waters are excluded — protected lakes (Šumava) never appear. Untagged
  swimmable ponds won't show until tagged in OSM (deliberate trade-off).
  Swim spots always keep their icon; swimmable waters also get blue polygons
- Capped at 150 polygons per view, closest to the map centre first

## Heat-aware recommendation
- `HEAT_BANDS` tilts the recommendation score by live temperature:
  under 27 °C parks win and AC buildings are damped (×0.7); 27–32 °C
  boosts swimming/water/misting; above 32 °C AC buildings, water,
  swimming and misting dominate while open parks are damped

## Performance
- **Local data cache**: everything fetched persists to localStorage for 24h
  (`eth-data-v1`, ~0.5 MB); boots hydrate instantly and only uncovered
  areas hit Overpass at all
- **Last-location pre-render**: the previous GPS fix (`eth-last-loc`) lets
  the app render map + markers + recommendation in ~50 ms while the real
  GPS is still warming up; the fix then re-centres silently
- **Endpoint racing**: Overpass queries go to two mirrors in parallel
  (`Promise.any`, 20 s round timeout) instead of sequential 15 s retries

## Transit mode (HIDDEN — AC public transport, Prague)
- `TRANSIT_ENABLED = false`: requiring users to bring their own Golemio
  API key is bad UX (Veronika's call); code stays dormant until there is
  a keyless path (e.g. a tiny proxy holding the key)
- Third mode segment: live positions of **air-conditioned PID vehicles**
  via Golemio `v2/vehiclepositions` (filter `trip.air_conditioned === true`)
- Needs a free Golemio API key (api.golemio.cz/api-keys) — entered in the
  app, stored ONLY in localStorage (`eth-golemio-key`), never in the repo
- Refreshes every 20 s while the mode is active; viewport markers
  (🚋/🚌/🚇) + nearest-6 list with route, headsign and distance
- Field mapping is defensive (schema was not verifiable without a key):
  if Golemio's real payload differs, adjust the mapping in `refreshTransit`

## Area data notes
- The greens Overpass statement must use `out geom` (body verbosity) —
  `out geom tags` strips relation member lists and silently breaks every
  multipolygon park (this bug hid Vítkov and the Letenské sady relation)
- `dedupeNamedAreas()` drops duplicate representations of one named place
  (e.g. Letenské sady = 2 ways + 1 relation) within 2 km, preferring the
  relation with geometry

## Heat map mode
- Segmented toggle in the sheet: Cool spots ↔ Heat map
- Samples live Open-Meteo `temperature_2m` on an **absolute lattice**
  (multiples of 0.01°×2ⁿ, ~7 nodes across the view) — the same place always
  samples the same coordinates, so colours are pixel-stable when panning,
  and coarse-zoom nodes are an exact subset of fine-zoom nodes
- Node values cached 20 min (`heatCache`); on move only missing nodes are
  fetched (one multi-location request), otherwise it's a pure redraw
- Rendered as bilinear-interpolated blue→yellow→red canvas (`L.imageOverlay`)
  with a min/max legend
- Country-level views legitimately show less local detail: nodes are tens of
  km apart, so a city's warm spot may fall between samples — that's model +
  sampling resolution, not a bug (disclosed in the legend note)
- The colour scale is **locked on first render** (`state.heatScale`, reset on
  re-locate) so one temperature keeps one colour at any pan/zoom; values
  outside the range saturate at the gradient ends
- Heat mode adds `body.heat-on`, which makes `.glass` surfaces nearly opaque
  (0.94) — otherwise the coloured overlay bleeds through the translucent
  glass and tints the sheet/pills
- Resolution is the weather model's (~1–2 km) — honest note shown in the
  legend; satellite land-surface temperature is the roadmap upgrade
