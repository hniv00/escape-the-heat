/* ============================================================
   Escape the Heat — app logic
   Data: OpenStreetMap via Overpass API · Weather: Open-Meteo
   Routing: OSRM (FOSSGIS, foot profile)
   ============================================================ */

"use strict";

/* ---------- Config ---------- */

const PRAGUE = { lat: 50.0874, lon: 14.4213 };
const WALK_SPEED_KMH = 4.6;

// The app (data fetching + heat map) is limited to Czechia for now
const CZ = { s: 48.55, w: 12.09, n: 51.06, e: 18.87 };
const inCzechia = (p) => p.lat >= CZ.s && p.lat <= CZ.n && p.lon >= CZ.w && p.lon <= CZ.e;

// Category registry. `cooling` = heuristic °C benefit vs street level.
// `radius`/`maxRadius` = min/max Overpass search radius in metres (the
// actual radius scales with the visible viewport). `recommend` = eligible
// as a "where should I go" destination.
const CATEGORIES = {
  park: {
    emoji: "🌳", cooling: 3, radius: 1600, maxRadius: 5000, recommend: true, defaultOn: true,
    overpass: [
      'way["leisure"="park"]', 'relation["leisure"="park"]',
      'way["leisure"="garden"]', 'relation["leisure"="garden"]',
      'way["landuse"="village_green"]', 'relation["landuse"="village_green"]',
      'way["landuse"="recreation_ground"]',
    ],
  },
  forest: {
    emoji: "🌲", cooling: 5, radius: 2500, maxRadius: 6000, recommend: true, defaultOn: true,
    overpass: ['way["landuse"="forest"]', 'way["natural"="wood"]', 'relation["natural"="wood"]'],
  },
  // One layer for everything you can actually swim in: pools, water
  // parks, and natural water explicitly tagged as swimmable. Protected
  // lakes (swimming=no / access=no) never make it in.
  swim: {
    emoji: "🏊", cooling: 4, radius: 2000, maxRadius: 6000, recommend: true, defaultOn: true,
    overpass: [
      'node["leisure"="swimming_pool"]', 'way["leisure"="swimming_pool"]',
      'node["leisure"="water_park"]', 'way["leisure"="water_park"]',
      'node["leisure"="swimming_area"]', 'way["leisure"="swimming_area"]', 'relation["leisure"="swimming_area"]',
      'way["natural"="water"]["swimming"="yes"]', 'relation["natural"="water"]["swimming"="yes"]',
      'way["natural"="water"]["sport"="swimming"]', 'relation["natural"="water"]["sport"="swimming"]',
    ],
  },
  // Free-entry public buildings that are reliably cool inside: libraries,
  // community centres, town halls, churches, malls. There is no clean
  // "has AC" dataset — this is the honest proxy (fee=yes filtered out).
  building: {
    emoji: "🏛️", cooling: 5, radius: 1500, maxRadius: 4000, recommend: true, defaultOn: true,
    overpass: [
      'node["amenity"="library"]', 'way["amenity"="library"]',
      'node["amenity"="community_centre"]', 'way["amenity"="community_centre"]',
      'node["amenity"="townhall"]', 'way["amenity"="townhall"]',
      'node["amenity"="place_of_worship"]', 'way["amenity"="place_of_worship"]',
      'node["shop"="mall"]', 'way["shop"="mall"]',
    ],
  },
  water: {
    emoji: "🚰", cooling: 2, radius: 1200, maxRadius: 3500, recommend: true, defaultOn: true,
    overpass: ['node["amenity"="drinking_water"]'],
  },
  fountain: {
    emoji: "⛲", cooling: 2, radius: 1400, maxRadius: 4000, recommend: true, defaultOn: true,
    overpass: ['node["amenity"="fountain"]', 'way["amenity"="fountain"]'],
  },
  misting: {
    emoji: "💦", cooling: 4, radius: 2500, maxRadius: 6000, recommend: true, defaultOn: true,
    overpass: ['node["fountain"="misting"]', 'node["amenity"="misting_station"]'],
  },
  bench: {
    emoji: "🪑", cooling: 1, radius: 500, maxRadius: 1500, recommend: false, defaultOn: false,
    overpass: ['node["amenity"="bench"]'],
  },
  toilets: {
    emoji: "🚻", cooling: 0, radius: 1200, maxRadius: 3500, recommend: false, defaultOn: false,
    overpass: ['node["amenity"="toilets"]'],
  },
};

/* ---------- i18n ---------- */

const I18N = {
  en: {
    appName: "Escape the Heat",
    loading: "Finding cool places near you…",
    loadingMore: "Loading places…",
    modeSpots: "Cool spots",
    modeHeat: "Heat map",
    modeTransit: "Transit",
    save: "Save",
    transitKeyInfo: "Live positions of air-conditioned PID vehicles need a free Golemio API key. Get one at api.golemio.cz/api-keys — it is stored only on this device.",
    transitNote: "Air-conditioned PID vehicles near the map view, live via Golemio (Prague open data). Refreshes every 20 s.",
    transitEmpty: "No air-conditioned vehicles nearby right now.",
    transitBadKey: "Golemio rejected the API key — check it at api.golemio.cz.",
    heatNote: "Live air temperature from the Open-Meteo weather model (~1–2 km resolution). Street-level shade differences won't show — surface heat data is on the roadmap.",
    near: (base, place) => `${base} ${place.kind === "road" ? "on" : "near"} ${place.name}`,
    empty: "No cooling spots found nearby. Try zooming out or moving the map.",
    showRoute: "Show route",
    back: "Back",
    recommended: "Coolest move right now",
    selected: "Cooling spot",
    cooler: (d) => `~${d}°C cooler`,
    walk: (min) => `${min} min walk`,
    away: (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`),
    fallbackLocation: "Location unavailable — showing Prague centre. Tap the target button to retry.",
    outsideCz: "Escape the Heat currently covers Czechia only — showing Prague centre.",
    dataError: "Couldn't load places right now. Please try again in a moment.",
    routeError: "Couldn't load the walking route.",
    pickSwim: "Go for a swim",
    pickGreen: "Green escape",
    pickDrink: "Drinking water",
    openNow: "Open now",
    closedNow: "Closed now",
    cat: {
      park: "Park", forest: "Greenery", swim: "Swimming", building: "Cool building",
      water: "Drinking water", fountain: "Fountain", misting: "Misting station",
      bench: "Bench", toilets: "Public toilets",
    },
    catPlural: {
      park: "Parks", forest: "Greenery", swim: "Swimming", building: "Cool buildings",
      water: "Drinking water", fountain: "Fountains", misting: "Misting",
      bench: "Benches", toilets: "Toilets",
    },
    unnamed: {
      park: "Park", forest: "Patch of greenery", swim: "Swimming spot", building: "Public building",
      water: "Drinking fountain", fountain: "Fountain", misting: "Misting station",
      bench: "Bench", toilets: "Public toilets",
    },
    // Quirky one-liners for the card, rotating per place type
    quips: {
      park: [
        "Find a tree, claim the shade, do absolutely nothing for a while.",
        "Grass, shade and quiet — blanket optional.",
        "Trees have been doing air conditioning since forever.",
      ],
      forest: [
        "A patch of green is a patch of cool. Science.",
        "Hide between the trees — the heat can't follow you there.",
      ],
      swim: [
        "Jump in and make the heat someone else's problem.",
        "The best AC is the one you can cannonball into.",
        "Got swimwear on you? This is your moment.",
      ],
      water: [
        "Dry throat? Free cold water, right there.",
        "Refill, sip, splash your wrists — carry on.",
        "Hydration: the cheapest cooling tech there is.",
      ],
      fountain: [
        "Sit close — fountain spray cools the air around it.",
        "Free ASMR with a cooling bonus.",
      ],
      misting: [
        "Walk through the mist: refreshment without the soak.",
        "A shower you can take fully dressed.",
      ],
      bench: [
        "Sit, breathe out, finish your water. Breaks count too.",
        "A bench in the shade beats a bench in the sun. Choose wisely.",
      ],
      toilets: [
        "Cold water on your wrists — a ten-second miracle.",
      ],
      building: [
        "Thick walls, cool air inside. Step in for a while.",
      ],
      "building:church": [
        "Hide from the sun and admire the church décor while you're at it.",
        "Thick walls, silence and cool air. Churches have done this for centuries.",
      ],
      "building:library": [
        "AC, silence and free books. A winning combo.",
        "Heat isn't allowed between the shelves. Library rules.",
      ],
      "building:townhall": [
        "Bureaucratic chill — for once, the good kind.",
      ],
      "building:community_centre": [
        "Cool air and maybe a coffee too.",
      ],
      "building:mall": [
        "An air-conditioned maze. No need to buy anything — just wander.",
      ],
    },
    // n ≥ 2 cluster titles: "5 benches"
    plural: {
      bench: (n) => `${n} benches`, water: (n) => `${n} drinking fountains`,
      fountain: (n) => `${n} fountains`, misting: (n) => `${n} misting stations`,
      toilets: (n) => `${n} public toilets`,
    },
  },
  cs: {
    appName: "Escape the Heat",
    loading: "Hledám chladná místa poblíž…",
    loadingMore: "Načítám místa…",
    modeSpots: "Chladná místa",
    modeHeat: "Teplotní mapa",
    modeTransit: "MHD",
    save: "Uložit",
    transitKeyInfo: "Živé polohy klimatizovaných vozidel PID vyžadují bezplatný Golemio API klíč. Získáte ho na api.golemio.cz/api-keys — ukládá se jen na tomto zařízení.",
    transitNote: "Klimatizovaná vozidla PID poblíž výřezu mapy, živě přes Golemio (otevřená data Prahy). Obnovuje se každých 20 s.",
    transitEmpty: "Poblíž teď nejsou žádná klimatizovaná vozidla.",
    transitBadKey: "Golemio API klíč nefunguje — zkontrolujte ho na api.golemio.cz.",
    heatNote: "Aktuální teplota vzduchu z modelu Open-Meteo (rozlišení ~1–2 km). Rozdíly mezi jednotlivými ulicemi mapa nezachytí — povrchová data jsou v plánu.",
    near: (base, place) => {
      const gen = czGenitive(place.name);
      return gen ? `${base} u ${gen}` : `${base} · ${place.name}`;
    },
    empty: "V okolí nejsou žádná chladná místa. Zkuste mapu oddálit nebo posunout.",
    showRoute: "Ukázat trasu",
    back: "Zpět",
    recommended: "Nejlepší úkryt před vedrem",
    selected: "Chladné místo",
    cooler: (d) => `o ~${d} °C chladněji`,
    walk: (min) => `${min} min chůze`,
    away: (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`),
    fallbackLocation: "Poloha není dostupná — zobrazuji centrum Prahy. Klepněte na terčík pro nový pokus.",
    outsideCz: "Escape the Heat zatím pokrývá jen Česko — zobrazuji centrum Prahy.",
    dataError: "Místa se teď nepodařilo načíst. Zkuste to prosím za chvíli.",
    routeError: "Pěší trasu se nepodařilo načíst.",
    pickSwim: "Zaplavat si",
    pickGreen: "Do zeleně",
    pickDrink: "Napít se",
    openNow: "Otevřeno",
    closedNow: "Zavřeno",
    cat: {
      park: "Park", forest: "Zeleň", swim: "Koupání", building: "Chladná budova",
      water: "Pítko", fountain: "Fontána", misting: "Mlžítko",
      bench: "Lavička", toilets: "Veřejné toalety",
    },
    catPlural: {
      park: "Parky", forest: "Zeleň", swim: "Koupání", building: "Chladné budovy",
      water: "Pítka", fountain: "Fontány", misting: "Mlžítka",
      bench: "Lavičky", toilets: "Toalety",
    },
    unnamed: {
      park: "Park", forest: "Kousek zeleně", swim: "Koupaliště", building: "Veřejná budova",
      water: "Pítko", fountain: "Fontána", misting: "Mlžítko",
      bench: "Lavička", toilets: "Veřejné toalety",
    },
    // Quirky one-liners for the card, rotating per place type
    quips: {
      park: [
        "Najdi si strom, zaber si stín a chvíli nedělej vůbec nic.",
        "Tráva, stín a klid — deka je bonus.",
        "Stromy zvládají klimatizaci líp než kdejaký kancl.",
      ],
      forest: [
        "Kousek zeleně = kousek chládku. Věda.",
        "Schovej se mezi stromy, horko tam za tebou nemůže.",
      ],
      swim: [
        "Hoď se do vody a horko je rázem cizí problém.",
        "Nejlepší klimatizace je ta, do které se dá skočit.",
        "Plavky s sebou? Tohle je tvoje chvíle.",
      ],
      water: [
        "Polykáš naprázdno? Zažeň sucho v krku vodou z pítka.",
        "Doplň tekutiny, ať z tebe není rozinka.",
        "Studená voda zdarma. Víc netřeba dodávat.",
      ],
      fountain: [
        "Sedni si k fontáně — vodní tříšť ochlazuje vzduch okolo.",
        "Šplouchání fontány: ASMR zdarma, chládek k tomu.",
      ],
      misting: [
        "Projdi se mlhou — osvěžení bez namočení.",
        "Sprcha, kterou si můžeš dát v oblečení.",
      ],
      bench: [
        "Sedni, vydechni, dopij vodu. Pauza je taky výkon.",
        "Lavička ve stínu > lavička na slunci. Vybírej chytře.",
      ],
      toilets: [
        "Studená voda na zápěstí — zázrak za deset vteřin.",
      ],
      building: [
        "Tlusté zdi, chládek uvnitř. Zajdi na chvíli dovnitř.",
      ],
      "building:church": [
        "Skryj se před horkem a sluncem a pokochej se kostelní výzdobou.",
        "Tlusté zdi, ticho a chládek. Kostely to umí po staletí.",
      ],
      "building:library": [
        "Klimatizace, ticho a knížky zdarma. Kombo vítězů.",
        "Mezi regály vedro nesmí. Knihovní pravidlo.",
      ],
      "building:townhall": [
        "Úřední chlad — tentokrát v dobrém slova smyslu.",
      ],
      "building:community_centre": [
        "Chládek a možná i káva. Komunitní centrum tě podrží.",
      ],
      "building:mall": [
        "Klimatizované bludiště. Nakupovat nemusíš, stačí bloudit.",
      ],
    },
    // n ≥ 2 cluster titles: 2–4 → "lavičky", 5+ → "laviček"
    plural: {
      bench: (n) => `${n} ${n <= 4 ? "lavičky" : "laviček"}`,
      water: (n) => `${n} ${n <= 4 ? "pítka" : "pítek"}`,
      fountain: (n) => `${n} ${n <= 4 ? "fontány" : "fontán"}`,
      misting: (n) => `${n} ${n <= 4 ? "mlžítka" : "mlžítek"}`,
      toilets: (n) => `${n} ${n <= 4 ? "toalety" : "toalet"}`,
    },
  },
};

let lang = localStorage.getItem("eth-lang") ||
  (navigator.language && navigator.language.toLowerCase().startsWith("cs") ? "cs" : "en");

const t = (key, ...args) => {
  const v = I18N[lang][key];
  return typeof v === "function" ? v(...args) : v;
};

/* ---------- Czech genitive (for "pítko u Obecního domu") ----------
   Only declines when confident; returns null otherwise so the caller
   can fall back to a grammar-safe format ("pítko · Florenc"). */

const CZ_NOUN_GEN = {
  "dům": "domu", "most": "mostu", "park": "parku", "sad": "sadu",
  "vrch": "vrchu", "hrad": "hradu", "kostel": "kostela", "klášter": "kláštera",
  "ostrov": "ostrova", "dvůr": "dvora", "trh": "trhu", "mlýn": "mlýna",
  "rybník": "rybníka", "potok": "potoka", "pramen": "pramene", "palác": "paláce",
  "les": "lesa", "háj": "háje", "brod": "brodu",
};
// Neuter nouns ending in -í keep the same form in genitive
const CZ_I_NOUNS = new Set(["náměstí", "nábřeží", "nádraží", "údolí", "zákoutí", "ústí", "podhradí"]);

function czGenitiveWord(w) {
  const lw = w.toLowerCase();
  if (/^[0-9IVX.,-]+$/.test(w)) return w; // numbers, roman numerals
  if (CZ_NOUN_GEN[lw]) return w[0] + CZ_NOUN_GEN[lw].slice(1);
  if (CZ_I_NOUNS.has(lw)) return w;
  if (w.endsWith("ý")) return w.slice(0, -1) + "ého";
  if (w.endsWith("á")) return w.slice(0, -1) + "é";
  if (w.endsWith("é")) return w.slice(0, -1) + "ého";
  if (w.endsWith("í")) return w.slice(0, -1) + "ího"; // soft adjectives (Jižní…)
  if (w.endsWith("a")) return w.slice(0, -1) + "y";   // Stromovka → Stromovky
  if (w.endsWith("o")) return w.slice(0, -1) + "a";   // Karlovo → Karlova
  if (w.endsWith("e") || w.endsWith("ě")) return w;   // ulice, Kampě…
  return null; // not confident (Florenc, Smíchov…)
}

function czGenitive(phrase) {
  const out = [];
  for (const w of phrase.split(" ")) {
    const g = czGenitiveWord(w);
    if (g == null) return null;
    out.push(g);
  }
  return out.join(" ");
}

/* ---------- State ---------- */

const state = {
  user: null,            // {lat, lon}
  usingFallback: false,
  temperature: null,     // current air temp °C
  spotCache: new Map(),  // spotId -> spot, everything fetched this session
  spots: [],             // cache as array, sorted by distance from user
  loadedAreas: [],       // fetched circles [{lat, lon, span}]
  booted: false,         // initial load finished
  fetching: false,
  pendingCheck: false,   // a pan happened while a fetch was in flight
  mode: "spots",         // 'spots' | 'heat'
  heatScale: null,       // fixed {lo, hi} °C → colour mapping for the session
  selected: null,        // spot shown in card
  recommendation: null,  // best spot
  routeLine: null,
  layersOn: Object.fromEntries(Object.entries(CATEGORIES).map(([k, c]) => [k, c.defaultOn])),
  markers: {},           // spotId -> Leaflet marker
};

/* ---------- Map ---------- */

const map = L.map("map", {
  zoomControl: false,
  attributionControl: true,
  maxBounds: [[CZ.s - 0.35, CZ.w - 0.6], [CZ.n + 0.35, CZ.e + 0.6]],
  maxBoundsViscosity: 1.0,
  minZoom: 7,
}).setView([PRAGUE.lat, PRAGUE.lon], 15);

L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: "abcd",
  maxZoom: 19,
}).addTo(map);

// Green areas live in their own pane below routes and markers
map.createPane("greens").style.zIndex = 350;
const greenLayer = L.layerGroup().addTo(map);
const spotLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);
let userMarker = null;

/* ---------- DOM ---------- */

const $ = (id) => document.getElementById(id);
const els = {
  tempPill: $("tempPill"), tempValue: $("tempValue"), langToggle: $("langToggle"),
  locateBtn: $("locateBtn"), chips: $("chips"), notice: $("notice"),
  loadingPill: $("loadingPill"), card: $("card"), picks: $("picks"),
  cardQuip: $("cardQuip"),
  modeSpots: $("modeSpots"), modeHeat: $("modeHeat"), modeTransit: $("modeTransit"),
  heatPanel: $("heatPanel"), heatLo: $("heatLo"), heatHi: $("heatHi"),
  transitPanel: $("transitPanel"), transitKeyBox: $("transitKeyBox"),
  transitKeyInput: $("transitKeyInput"), transitKeySave: $("transitKeySave"),
  transitList: $("transitList"),
  cardLoading: $("cardLoading"), cardBody: $("cardBody"), cardEmpty: $("cardEmpty"),
  cardEmoji: $("cardEmoji"), cardKicker: $("cardKicker"), cardTitle: $("cardTitle"),
  cardTemp: $("cardTemp"), cardCooler: $("cardCooler"), cardMeta: $("cardMeta"),
  routeBtn: $("routeBtn"), clearBtn: $("clearBtn"),
};

/* ---------- Geometry helpers ---------- */

function haversine(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const estWalkMinutes = (meters) => Math.max(1, Math.round((meters * 1.3) / 1000 / WALK_SPEED_KMH * 60));

/* ---------- Weather (Open-Meteo) ---------- */

async function fetchWeather(loc) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,apparent_temperature`;
    const res = await fetch(url);
    const data = await res.json();
    state.temperature = data.current?.temperature_2m ?? null;
    if (state.temperature != null) {
      els.tempValue.textContent = `${Math.round(state.temperature)} °C`;
      els.tempPill.hidden = false;
    }
  } catch {
    /* non-fatal — temps just stay hidden */
  }
}

/* ---------- Overpass ---------- */

// `span` = how far the user can currently see (viewport half-diagonal).
// Each category searches at least its base radius, grows with the
// viewport, and is clamped so dense layers (benches) stay sane.
// At city-wide spans only the large green areas are fetched — point
// amenities would be capped out of view anyway and make queries slow.
const WIDE_SPAN = 2500;
const WIDE_CATEGORIES = new Set(["park", "forest", "swim", "misting"]);
// Categories rendered as area polygons (fetched with geometry)
const GREEN_CATS = new Set(["park", "forest", "swim"]);

function buildOverpassQuery(loc, span) {
  const points = [], greens = [];
  for (const [key, cat] of Object.entries(CATEGORIES)) {
    if (span > WIDE_SPAN && !WIDE_CATEGORIES.has(key)) continue;
    const radius = Math.round(Math.min(Math.max(cat.radius, span), cat.maxRadius));
    for (const selector of cat.overpass) {
      (GREEN_CATS.has(key) ? greens : points)
        .push(`${selector}(around:${radius},${loc.lat},${loc.lon});`);
    }
  }
  let q = `[out:json][timeout:25];`;
  if (points.length) q += `(${points.join("")});out center tags qt 4000;`;
  // NB: default (body) verbosity, NOT "tags" — the tags mode strips
  // relation member lists, which silently broke every multipolygon park
  if (greens.length) q += `(${greens.join("")});out geom qt 800;`;
  return q;
}

/* ---------- Green area geometry ---------- */

const EPS = 1e-7;
const samePt = (a, b) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;

// Join relation member ways end-to-end into closed rings
function stitchRings(members) {
  const segs = members.map((m) => m.geometry.map((g) => [g.lat, g.lon]));
  const rings = [];
  while (segs.length) {
    let ring = segs.pop();
    let extended = true;
    while (extended && !samePt(ring[0], ring[ring.length - 1])) {
      extended = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (samePt(ring[ring.length - 1], s[0])) ring = ring.concat(s.slice(1));
        else if (samePt(ring[ring.length - 1], s[s.length - 1])) ring = ring.concat(s.slice(0, -1).reverse());
        else if (samePt(ring[0], s[s.length - 1])) ring = s.slice(0, -1).concat(ring);
        else if (samePt(ring[0], s[0])) ring = s.slice(1).reverse().concat(ring);
        else continue;
        segs.splice(i, 1);
        extended = true;
        break;
      }
    }
    if (ring.length > 3 && samePt(ring[0], ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}

// → array of polygons, each [outerRing, ...innerRings], or null
function polysFromElement(el) {
  if (el.type === "way" && el.geometry) {
    const ring = el.geometry.map((g) => [g.lat, g.lon]);
    return ring.length > 3 ? [[ring]] : null;
  }
  if (el.type === "relation" && el.members) {
    // Empty role means "outer" in many multipolygons
    const outers = stitchRings(el.members.filter((m) => (m.role === "outer" || m.role === "") && m.geometry));
    if (!outers.length) return null;
    const inners = stitchRings(el.members.filter((m) => m.role === "inner" && m.geometry));
    return outers.map((o, i) => (i === 0 ? [o, ...inners] : [o]));
  }
  return null;
}

// Rough polygon area in m² (shoelace on locally-projected coords)
function ringAreaM2(ring) {
  const mLat = 111320, mLon = 111320 * Math.cos((ring[0][0] * Math.PI) / 180);
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [aLat, aLon] = ring[i], [bLat, bLon] = ring[(i + 1) % ring.length];
    sum += aLon * mLon * bLat * mLat - bLon * mLon * aLat * mLat;
  }
  return Math.abs(sum / 2);
}

function ringPerimeterM(ring) {
  let p = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    p += haversine({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] });
  }
  return p;
}

// Unnamed green scraps aren't worth showing: too small, or too narrow
// (roadside verge strips are long, so area alone doesn't catch them —
// effective width = 2·area/perimeter does). Named areas and official
// leisure=park stay regardless.
const MIN_GREEN_AREA_M2 = 500;
const MIN_GREEN_WIDTH_M = 15;

function isGreenScrap(polys) {
  const area = polys.reduce((a, rings) => a + ringAreaM2(rings[0]), 0);
  if (area < MIN_GREEN_AREA_M2) return true;
  const perimeter = polys.reduce((a, rings) => a + ringPerimeterM(rings[0]), 0);
  return (2 * area) / perimeter < MIN_GREEN_WIDTH_M;
}

function categoryOf(tags) {
  if (!tags) return null;
  const isPrivate = ["no", "private", "customers"].includes(tags.access);
  if (tags.amenity === "drinking_water") return "water";
  if (tags.fountain === "misting" || tags.amenity === "misting_station") return "misting";
  if (tags.amenity === "fountain") return "fountain";
  if (tags.amenity === "bench") return "bench";
  if (tags.amenity === "toilets") return "toilets";
  if (["library", "community_centre", "townhall", "place_of_worship"].includes(tags.amenity) ||
      tags.shop === "mall") {
    return tags.fee === "yes" || isPrivate ? null : "building"; // free entry only
  }
  if (["swimming_pool", "water_park", "swimming_area"].includes(tags.leisure)) {
    return tags.access === "private" ? null : "swim"; // skip backyard pools
  }
  if (tags.natural === "water" || tags.landuse === "reservoir") {
    const swimmable = tags.swimming === "yes" || /swimming/.test(tags.sport || "");
    const blocked = tags.swimming === "no" || ["no", "private"].includes(tags.access);
    return swimmable && !blocked ? "swim" : null;
  }
  if (tags.leisure === "park" || tags.landuse === "village_green" ||
      tags.landuse === "recreation_ground") return "park";
  if (tags.leisure === "garden") return isPrivate ? null : "park";
  if (tags.landuse === "forest" || tags.natural === "wood") return "forest";
  return null;
}

// Public Overpass instances — rotate to the next on failure/throttling
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
let overpassIdx = 0;
let retryTimer = null;

function buildingSub(tags) {
  if (tags.amenity === "place_of_worship") return "church";
  if (tags.shop === "mall") return "mall";
  return tags.amenity || null; // library, townhall, community_centre
}

/* ---------- Opening hours (common subset of the OSM syntax) ---------- */

// Handles "24/7", "Mo-Fr 08:00-18:00; Sa 09:00-12:00", day lists, multiple
// time ranges, overnight ranges, "off"/"closed" rules. Returns true (open),
// false (closed) or null (no data / exotic syntax → honest "unknown").
const OH_DAYS = ["su", "mo", "tu", "we", "th", "fr", "sa"];

function ohDayMatches(part, today) {
  let matched = false;
  for (const tok of part.split(",").map((x) => x.trim()).filter(Boolean)) {
    if (tok === "ph" || tok === "sh") continue; // public/school holidays: ignore
    const m = tok.match(/^([a-z]{2})(?:\s*-\s*([a-z]{2}))?$/);
    if (!m || !OH_DAYS.includes(m[1]) || (m[2] && !OH_DAYS.includes(m[2]))) return null;
    if (!m[2]) { if (m[1] === today) matched = true; continue; }
    const norm = (d) => (OH_DAYS.indexOf(d) + 6) % 7; // Mo=0…Su=6, ranges may wrap
    const a = norm(m[1]), b = norm(m[2]), d = norm(today);
    if (a <= b ? d >= a && d <= b : d >= a || d <= b) matched = true;
  }
  return matched;
}

function openState(hoursStr, date = new Date()) {
  if (!hoursStr) return null;
  const s = hoursStr.trim().toLowerCase();
  if (s === "24/7") return true;
  const today = OH_DAYS[date.getDay()];
  const mins = date.getHours() * 60 + date.getMinutes();
  let result = null;
  for (const rule of s.split(";").map((r) => r.trim()).filter(Boolean)) {
    const m = rule.match(/^([a-z ,-]*?)\s*((?:\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*,?\s*)+|off|closed|24\/7)$/);
    if (!m) return null; // exotic syntax → unknown
    const applies = m[1].trim() === "" ? true : ohDayMatches(m[1].trim(), today);
    if (applies === null) return null;
    if (!applies) continue;
    const times = m[2].trim();
    if (times === "off" || times === "closed") { result = false; continue; }
    if (times === "24/7") { result = true; continue; }
    result = times.split(",").some((range) => {
      const [a, b] = range.split("-").map((tm) => {
        const [h, mm] = tm.trim().split(":").map(Number);
        return h * 60 + mm;
      });
      return b >= a ? mins >= a && mins < b : mins >= a || mins < b; // overnight ok
    });
  }
  return result;
}

// Should this building count as a destination right now? Known hours
// decide; unknown hours get a daytime assumption (churches rarely tag
// hours, and recommending a locked one at midnight would be worse).
function buildingOpen(spot) {
  if (spot.cat !== "building") return true;
  const st = openState(spot.hours);
  if (st === null) {
    const h = new Date().getHours();
    return h >= 8 && h < 20;
  }
  return st;
}

async function fetchSpots(loc, span) {
  const body = "data=" + encodeURIComponent(buildOverpassQuery(loc, span));
  let data, lastErr;
  for (let attempt = 0; attempt < OVERPASS_ENDPOINTS.length; attempt++) {
    try {
      // Give slow/throttled instances 15s, then move to the next one
      const res = await fetch(OVERPASS_ENDPOINTS[overpassIdx], {
        method: "POST", body, signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      data = await res.json();
      break;
    } catch (e) {
      lastErr = e;
      overpassIdx = (overpassIdx + 1) % OVERPASS_ENDPOINTS.length;
    }
  }
  if (!data) throw lastErr;

  const origin = state.user || loc;
  const spots = [];
  for (const el of data.elements) {
    const cat = categoryOf(el.tags);
    if (!cat) continue;
    let lat = el.lat ?? el.center?.lat;
    let lon = el.lon ?? el.center?.lon;
    let polys = null, bbox = null;
    if (GREEN_CATS.has(cat)) {
      polys = polysFromElement(el);
      if ((cat === "forest" || cat === "park") && polys &&
          !el.tags?.name && el.tags?.leisure !== "park" && isGreenScrap(polys)) {
        continue;
      }
      if (el.bounds) {
        bbox = el.bounds;
        lat = lat ?? (el.bounds.minlat + el.bounds.maxlat) / 2;
        lon = lon ?? (el.bounds.minlon + el.bounds.maxlon) / 2;
      }
    }
    if (lat == null) continue;
    spots.push({
      id: `${el.type}/${el.id}`,
      cat,
      lat, lon,
      polys, bbox,
      sub: cat === "building" ? buildingSub(el.tags) : undefined,
      hours: cat === "building" ? el.tags.opening_hours || null : undefined,
      name: el.tags?.name || null,
      distance: Math.round(haversine(origin, { lat, lon })),
    });
  }
  return spots;
}

function mergeSpots(fetched) {
  for (const s of fetched) state.spotCache.set(s.id, s);
  state.spots = [...state.spotCache.values()].sort((a, b) => a.distance - b.distance);
  dedupeNamedAreas();
}

// OSM often maps one real place several times (Letenské sady = two ways
// + one relation). Keep the best representation per (category, name) —
// prefer the relation with geometry — and drop nearby duplicates.
function dedupeNamedAreas() {
  const groups = new Map();
  for (const s of state.spots) {
    if (!s.name || !GREEN_CATS.has(s.cat)) continue;
    const k = `${s.cat}|${s.name}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  const drop = new Set();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const rank = (s) =>
      (s.polys ? 2 : 0) + (s.id.startsWith("relation") ? 1 : 0);
    const best = g.reduce((a, b) => (rank(b) > rank(a) ? b : a));
    for (const s of g) {
      // Same-named places in other towns stay; parts of one place don't
      if (s !== best && haversine(s, best) < 2000) drop.add(s.id);
    }
  }
  if (drop.size) state.spots = state.spots.filter((s) => !drop.has(s.id));
}

// Fetch spots around a point and merge them into the session cache.
async function loadSpotsAround(center, span) {
  state.fetching = true;
  els.loadingPill.hidden = false;
  try {
    const fetched = await fetchSpots(center, span);
    state.loadedAreas.push({ lat: center.lat, lon: center.lon, span, wide: span > WIDE_SPAN });
    mergeSpots(fetched);
    renderMarkers();
    renderPicks();
    // If boot ran with no data (throttled first fetch), fill the
    // recommendation card once data finally arrives
    if (state.booted && !state.recommendation) {
      state.recommendation = pickRecommendation(state.spots);
      if (state.recommendation && !state.selected) {
        state.selected = state.recommendation;
        renderCard(state.recommendation);
      }
    }
  } catch {
    showNotice(t("dataError"));
    // No area got registered, so retry automatically once things calm down
    clearTimeout(retryTimer);
    retryTimer = setTimeout(maybeLoadMore, 20000);
  } finally {
    state.fetching = false;
    els.loadingPill.hidden = true;
    if (state.pendingCheck) {
      state.pendingCheck = false;
      maybeLoadMore();
    }
  }
}

// Called after every pan/zoom: if the visible area isn't covered by a
// previous fetch, load spots around the new map centre.
function maybeLoadMore() {
  if (!state.booted) return; // don't race the initial load
  const c = map.getCenter();
  const center = { lat: c.lat, lon: c.lng };
  if (!inCzechia(center)) return; // Czechia only for now
  const b = map.getBounds();
  const halfDiag = haversine(center, { lat: b.getNorth(), lon: b.getEast() });
  const span = Math.min(Math.max(halfDiag, 800), 4000);

  // A wide (parks/forests-only) fetch doesn't cover a close-up view,
  // which also needs the point amenities.
  const covered = state.loadedAreas.some(
    (a) => haversine(a, center) < a.span * 0.5 && span <= a.span * 1.2 &&
      (!a.wide || span > WIDE_SPAN)
  );
  if (covered) return;
  if (state.fetching) { state.pendingCheck = true; return; }
  loadSpotsAround(center, span);
}

/* ---------- Place names for unnamed spots (Nominatim) ---------- */

// Reverse-geocode one spot on demand (only when it's shown in the card),
// staying well inside Nominatim's 1 req/s policy.
async function fetchPlace(spot) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
    `&lat=${spot.lat}&lon=${spot.lon}&zoom=17&accept-language=cs`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const a = (await res.json()).address || {};
  const road = a.road || a.pedestrian || a.footway || a.square;
  const area = a.neighbourhood || a.quarter || a.suburb || a.city_district;
  if (road) return { kind: "road", name: road };
  if (area) return { kind: "area", name: area };
  return null;
}

function spotTitle(spot) {
  if (spot.count > 1) {
    const base = I18N[lang].plural[spot.cat](spot.count); // "5 laviček"
    return spot.place ? t("near", base, spot.place) : base;
  }
  if (spot.name) return spot.name;
  const base = I18N[lang].unnamed[spot.cat];
  if (!spot.place) return base;
  return t("near", base, spot.place);
}

// Kick off a lazy place lookup for the spot currently in the card
function ensurePlace(spot) {
  if ((spot.name && !spot.count) || spot.place !== undefined || spot.placeLoading) return;
  spot.placeLoading = true;
  fetchPlace(spot)
    .then((p) => { spot.place = p; })
    .catch(() => { spot.place = null; })
    .finally(() => {
      spot.placeLoading = false;
      if (state.selected?.id === spot.id && !els.cardBody.hidden) renderCard(spot);
    });
}

/* ---------- Recommendation ---------- */

// Heat-aware weighting: at 25 °C a park is lovely and AC is overkill;
// at 35 °C water and air-conditioned interiors matter most. Bands keyed
// by the live temperature; neutral (×1) when temperature is unknown.
const HEAT_BANDS = [
  { below: 27, w: { park: 1.1, forest: 1.1, swim: 0.95, building: 0.7, water: 1, fountain: 1, misting: 0.8 } },
  { below: 32, w: { park: 1, forest: 1.05, swim: 1.2, building: 1.05, water: 1.15, fountain: 1, misting: 1.15 } },
  { below: 99, w: { park: 0.85, forest: 0.95, swim: 1.35, building: 1.35, water: 1.3, fountain: 1.1, misting: 1.3 } },
];

function heatWeight(cat) {
  if (state.temperature == null) return 1;
  const band = HEAT_BANDS.find((b) => state.temperature < b.below) || HEAT_BANDS[HEAT_BANDS.length - 1];
  return band.w[cat] ?? 1;
}

// "Where should I go right now?" — balance cooling benefit against
// walking time, tilted by how hot it actually is right now.
function pickRecommendation(spots) {
  let best = null, bestScore = -Infinity;
  for (const s of spots) {
    const cat = CATEGORIES[s.cat];
    if (!cat.recommend) continue;
    if (!buildingOpen(s)) continue; // don't send people to a locked door
    const minutes = estWalkMinutes(s.distance);
    const score = (cat.cooling * heatWeight(s.cat)) / (minutes + 4);
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
}

/* ---------- Smart picks ---------- */

// Intent-based shortcuts: a swim, a green escape, a drink of water.
// Distances are always from the user's location, like the main card.
function computePicks() {
  const on = state.spots.filter((s) => state.layersOn[s.cat]);
  const nearest = (pred) => {
    let best = null;
    for (const s of on) if (pred(s) && (!best || s.distance < best.distance)) best = s;
    return best;
  };
  const swim = nearest((s) => s.cat === "swim");
  let green = null, bestScore = -Infinity;
  for (const s of on) {
    if (s.cat !== "park" && s.cat !== "forest") continue;
    const score = CATEGORIES[s.cat].cooling / (estWalkMinutes(s.distance) + 4);
    if (score > bestScore) { bestScore = score; green = s; }
  }
  const drink = nearest((s) => s.cat === "water");

  const picks = [], seen = new Set();
  for (const [label, spot] of [["pickSwim", swim], ["pickGreen", green], ["pickDrink", drink]]) {
    if (!spot || seen.has(spot.id)) continue;
    seen.add(spot.id);
    picks.push({ label, spot });
  }
  return picks;
}

function renderPicks() {
  const picks = state.mode === "spots" ? computePicks() : [];
  els.picks.innerHTML = "";
  els.picks.hidden = !picks.length;
  for (const p of picks) {
    const btn = document.createElement("button");
    btn.className = "pick";
    btn.innerHTML =
      `<span>${CATEGORIES[p.spot.cat].emoji}</span>` +
      `<span>${t(p.label)}</span>` +
      `<span class="pick-min">${estWalkMinutes(p.spot.distance)} min</span>`;
    btn.addEventListener("click", () => selectSpot(p.spot, true));
    els.picks.appendChild(btn);
  }
}

/* ---------- Routing (OSRM foot) ---------- */

async function fetchRoute(from, to) {
  const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/` +
    `${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const data = await res.json();
  const route = data.routes?.[0];
  if (!route) throw new Error("No route");
  return {
    coords: route.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
    minutes: Math.max(1, Math.round(route.duration / 60)),
    meters: Math.round(route.distance),
  };
}

function clearRoute() {
  routeLayer.clearLayers();
  state.routeLine = null;
}

async function showRoute(spot) {
  if (!state.user) return;
  clearRoute();
  els.routeBtn.disabled = true;
  try {
    const route = await fetchRoute(state.user, spot);
    spot.walkMinutes = route.minutes;
    spot.walkMeters = route.meters;
    state.routeLine = L.polyline(route.coords, {
      color: "#0e7ce8", weight: 5, opacity: 0.85, lineCap: "round",
    }).addTo(routeLayer);
    map.fitBounds(state.routeLine.getBounds(), {
      paddingTopLeft: [40, 80],
      paddingBottomRight: [40, Math.min(window.innerHeight * 0.4, 320)],
    });
    renderCard(spot); // refresh with precise time/distance
  } catch {
    showNotice(t("routeError"));
  } finally {
    els.routeBtn.disabled = false;
  }
}

/* ---------- Markers ---------- */

// Only render what's in (or near) the viewport, closest to the map
// centre first.
function visibleSpots() {
  const bounds = map.getBounds().pad(0.2);
  const c = map.getCenter();
  const center = { lat: c.lat, lon: c.lng };

  const inView = state.spots.filter((s) => {
    if (!state.layersOn[s.cat] || !bounds.contains([s.lat, s.lon])) return false;
    // Area categories are drawn as polygons; icons only for named parks,
    // never for greenery (the shape alone shows the area). Swim spots
    // always keep their icon — they're destinations.
    if (s.cat === "forest") return false;
    if (s.cat === "park" && !s.name && s.polys) return false;
    return true;
  });
  inView.sort((a, b) => haversine(center, a) - haversine(center, b));
  return inView;
}

/* ---------- Clustering (no cluttered mess) ---------- */

// 2+ things of the same category within 200 m collapse into one marker;
// tapping it reveals the members as small dots.
const CLUSTER_CATS = new Set(["bench", "water", "fountain", "toilets", "misting"]);
const CLUSTER_RADIUS = 200;

function clusterSpots(spots) {
  const out = [], pools = {};
  for (const s of spots) {
    if (CLUSTER_CATS.has(s.cat)) (pools[s.cat] ??= []).push(s);
    else out.push(s);
  }
  for (const [cat, list] of Object.entries(pools)) {
    const used = new Set();
    for (const s of list) { // sorted centre-out, so seeds are well spread
      if (used.has(s.id)) continue;
      const members = list.filter((m) => !used.has(m.id) && haversine(s, m) <= CLUSTER_RADIUS);
      members.forEach((m) => used.add(m.id));
      if (members.length === 1) { out.push(s); continue; }
      const repre = members.find((m) => m.name) || s;
      out.push({
        id: `cluster/${repre.id}`, cat,
        lat: repre.lat, lon: repre.lon,
        name: repre.name,
        distance: Math.min(...members.map((m) => m.distance)),
        count: members.length, members,
      });
    }
  }
  return out;
}

/* ---------- Green area rendering ---------- */

const AREA_STYLES = {
  park:   { pane: "greens", fillColor: "#79b56a", fillOpacity: 0.45, color: "#5ea152", weight: 1, opacity: 0.3 },
  forest: { pane: "greens", fillColor: "#79b56a", fillOpacity: 0.45, color: "#5ea152", weight: 1, opacity: 0.3 },
  swim:   { pane: "greens", fillColor: "#7db8e8", fillOpacity: 0.5,  color: "#4a90c2", weight: 1, opacity: 0.35 },
};
const areaStyle = (s, selected) =>
  selected ? { ...AREA_STYLES[s.cat], color: "#0e7ce8", weight: 2, opacity: 0.9 } : AREA_STYLES[s.cat];

// Chaikin corner-cutting → soft organic outlines instead of raw OSM edges
function smoothRing(ring) {
  if (ring.length > 600) return ring;
  const iters = ring.length > 200 ? 1 : 2;
  let r = ring;
  for (let k = 0; k < iters; k++) {
    const out = [];
    for (let i = 0; i < r.length; i++) {
      const p = r[i], q = r[(i + 1) % r.length];
      out.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]]);
      out.push([0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]);
    }
    r = out;
  }
  return r;
}

function renderGreens() {
  greenLayer.clearLayers();
  const bounds = map.getBounds().pad(0.5);
  const c = map.getCenter();
  const center = { lat: c.lat, lon: c.lng };
  const greens = state.spots
    .filter((s) => s.polys && state.layersOn[s.cat] &&
      (s.bbox
        ? bounds.intersects(L.latLngBounds([s.bbox.minlat, s.bbox.minlon], [s.bbox.maxlat, s.bbox.maxlon]))
        : bounds.contains([s.lat, s.lon])))
    .sort((a, b) => haversine(center, a) - haversine(center, b))
    .slice(0, 150);
  for (const s of greens) {
    if (!s.smooth) s.smooth = s.polys.map((rings) => rings.map(smoothRing));
    const style = areaStyle(s, state.selected?.id === s.id);
    for (const rings of s.smooth) {
      L.polygon(rings, style)
        .on("click", () => selectSpot(s, false))
        .addTo(greenLayer);
    }
  }
}

function renderMarkers() {
  spotLayer.clearLayers();
  state.markers = {};
  const zoom = map.getZoom();
  const cap = zoom >= 15 ? 120 : zoom >= 13 ? 60 : 30;
  const counts = {};
  for (const spot of clusterSpots(visibleSpots())) {
    // Never drop the selected spot; cap the rest per category by zoom
    if (state.selected?.id !== spot.id &&
        (counts[spot.cat] = (counts[spot.cat] || 0) + 1) > cap) continue;
    const badge = spot.count > 1 ? `<span class="spot-count">${spot.count}</span>` : "";
    const closed = spot.cat === "building" && !buildingOpen(spot) ? " closed" : "";
    const icon = L.divIcon({
      className: "",
      html: `<div class="spot-marker${state.selected?.id === spot.id ? " selected" : ""}${closed}">${CATEGORIES[spot.cat].emoji}${badge}</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
    const m = L.marker([spot.lat, spot.lon], { icon }).addTo(spotLayer);
    m.on("click", () => selectSpot(spot, false));
    state.markers[spot.id] = m;
  }
  // Expanded cluster: show every member as a small dot
  if (state.selected?.members) {
    for (const member of state.selected.members) {
      L.marker([member.lat, member.lon], {
        icon: L.divIcon({ className: "", html: '<div class="member-dot"></div>', iconSize: [12, 12], iconAnchor: [6, 6] }),
        interactive: false,
      }).addTo(spotLayer);
    }
  }
  renderGreens();
}

function renderUserMarker() {
  if (userMarker) userMarker.remove();
  if (!state.user) return;
  userMarker = L.marker([state.user.lat, state.user.lon], {
    icon: L.divIcon({ className: "", html: '<div class="user-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
    zIndexOffset: 1000,
    interactive: false,
  }).addTo(map);
}

/* ---------- Heat map (Open-Meteo grid overlay) ---------- */

const HEAT_N = 7;        // target ~7 sample nodes across the viewport
let heatOverlay = null;
let heatTimer = null;

// Samples live on an ABSOLUTE lattice (multiples of 0.01° × powers of
// two), not on the viewport: the same place always samples the same
// coordinates, so colours don't wobble when panning, and coarser-zoom
// nodes are an exact subset of finer ones. Values are cached for 20 min.
const heatCache = new Map(); // "lat:lon" -> { temp, at }
const HEAT_TTL = 20 * 60 * 1000;

function heatLattice() {
  const b = map.getBounds().pad(0.15);
  const span = Math.max(b.getNorth() - b.getSouth(), b.getEast() - b.getWest());
  const step = 0.01 * Math.pow(2, Math.max(0, Math.ceil(Math.log2(span / ((HEAT_N - 1) * 0.01)))));
  const lats = [], lons = [];
  for (let i = Math.floor(b.getSouth() / step); i <= Math.ceil(b.getNorth() / step); i++) {
    lats.push(+(i * step).toFixed(4));
  }
  for (let j = Math.floor(b.getWest() / step); j <= Math.ceil(b.getEast() / step); j++) {
    lons.push(+(j * step).toFixed(4));
  }
  return {
    lats, lons,
    bounds: L.latLngBounds([lats[0], lons[0]], [lats[lats.length - 1], lons[lons.length - 1]]),
  };
}

function heatColor(x) {
  // blue → yellow → red
  const mix = (a, b, f) => a.map((v, i) => Math.round(v + (b[i] - v) * f));
  const c = x < 0.5
    ? mix([59, 130, 246], [253, 224, 71], x * 2)
    : mix([253, 224, 71], [239, 68, 68], (x - 0.5) * 2);
  return c;
}

function drawHeat(bounds, temps, rows, cols) {
  const valid = temps.filter((v) => v != null);
  if (!valid.length) throw new Error("No temperature data");
  const mean = valid.reduce((a, v) => a + v, 0) / valid.length;
  const grid = temps.map((v) => v ?? mean);

  // Lock the colour scale on first render so one temperature keeps one
  // colour no matter where the user pans or zooms. Out-of-range values
  // saturate at the ends of the gradient.
  if (!state.heatScale) {
    let lo = Math.min(...valid), hi = Math.max(...valid);
    if (hi - lo < 3) { lo = mean - 1.5; hi = mean + 1.5; }
    state.heatScale = { lo: Math.floor(lo * 2) / 2, hi: Math.ceil(hi * 2) / 2 };
  }
  const { lo, hi } = state.heatScale;

  const W = 160, H = 160;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const gi = (1 - y / (H - 1)) * (rows - 1); // y=0 is north = max lat
    const i0 = Math.min(Math.floor(gi), rows - 2), fi = gi - i0;
    for (let x = 0; x < W; x++) {
      const gj = (x / (W - 1)) * (cols - 1);
      const j0 = Math.min(Math.floor(gj), cols - 2), fj = gj - j0;
      const tVal =
        grid[i0 * cols + j0] * (1 - fi) * (1 - fj) +
        grid[(i0 + 1) * cols + j0] * fi * (1 - fj) +
        grid[i0 * cols + j0 + 1] * (1 - fi) * fj +
        grid[(i0 + 1) * cols + j0 + 1] * fi * fj;
      const [r, g, bl] = heatColor(Math.min(1, Math.max(0, (tVal - lo) / (hi - lo))));
      const p = (y * W + x) * 4;
      img.data[p] = r; img.data[p + 1] = g; img.data[p + 2] = bl; img.data[p + 3] = 150;
    }
  }
  ctx.putImageData(img, 0, 0);

  const url = canvas.toDataURL();
  if (heatOverlay) {
    heatOverlay.setUrl(url);
    heatOverlay.setBounds(bounds);
  } else {
    heatOverlay = L.imageOverlay(url, bounds, { interactive: false }).addTo(map);
  }
  els.heatLo.textContent = `${lo.toFixed(1)} °C`;
  els.heatHi.textContent = `${hi.toFixed(1)} °C`;
}

async function refreshHeat() {
  const c = map.getCenter();
  if (!inCzechia({ lat: c.lat, lon: c.lng })) return; // Czechia only
  const { lats, lons, bounds } = heatLattice();
  const now = Date.now();

  const missing = [];
  for (const lat of lats) {
    for (const lon of lons) {
      const entry = heatCache.get(`${lat}:${lon}`);
      if (!entry || now - entry.at > HEAT_TTL) missing.push({ lat, lon });
    }
  }
  if (missing.length) {
    els.loadingPill.hidden = false;
    try {
      const url = `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${missing.map((m) => m.lat).join(",")}` +
        `&longitude=${missing.map((m) => m.lon).join(",")}&current=temperature_2m`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
      const data = await res.json();
      (Array.isArray(data) ? data : [data]).forEach((d, k) => {
        heatCache.set(`${missing[k].lat}:${missing[k].lon}`,
          { temp: d.current?.temperature_2m ?? null, at: now });
      });
    } catch {
      showNotice(t("dataError"));
      return;
    } finally {
      els.loadingPill.hidden = true;
    }
  }

  if (state.mode !== "heat") return; // user switched back mid-fetch
  const temps = [];
  for (const lat of lats) {
    for (const lon of lons) temps.push(heatCache.get(`${lat}:${lon}`)?.temp ?? null);
  }
  try {
    drawHeat(bounds, temps, lats.length, lons.length);
  } catch {
    showNotice(t("dataError"));
  }
}

/* ---------- AC public transport (Golemio / PID, Prague) ---------- */

const transitLayer = L.layerGroup();
const TRANSIT_KEY_LS = "eth-golemio-key";
const transitKey = () => localStorage.getItem(TRANSIT_KEY_LS) || "";
let transitTimer = null;
let lastVehicles = [];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function refreshTransit() {
  if (state.mode !== "transit" || !transitKey()) return;
  try {
    const res = await fetch(
      "https://api.golemio.cz/v2/vehiclepositions?limit=2000&includeNotTracking=false",
      { headers: { "X-Access-Token": transitKey(), "Content-Type": "application/json" } }
    );
    if (res.status === 401 || res.status === 403) {
      showNotice(t("transitBadKey"), true);
      els.transitKeyBox.hidden = false;
      return;
    }
    if (!res.ok) throw new Error(`Golemio ${res.status}`);
    const data = await res.json();
    lastVehicles = (data.features || [])
      .filter((f) => f?.properties?.trip?.air_conditioned === true)
      .map((f) => {
        const [lon, lat] = f.geometry?.coordinates || [];
        const gtfs = f.properties?.trip?.gtfs || {};
        return {
          lat, lon,
          route: gtfs.route_short_name || "?",
          headsign: gtfs.trip_headsign || "",
          emoji: gtfs.route_type === 0 ? "🚋" : gtfs.route_type === 1 ? "🚇" : "🚌",
        };
      })
      .filter((v) => v.lat != null);
    renderTransit();
  } catch {
    showNotice(t("dataError"));
  }
}

function renderTransit() {
  if (state.mode !== "transit") return;
  transitLayer.clearLayers();
  const b = map.getBounds().pad(0.2);
  const c = map.getCenter();
  const center = { lat: c.lat, lon: c.lng };

  for (const v of lastVehicles.filter((v) => b.contains([v.lat, v.lon])).slice(0, 150)) {
    L.marker([v.lat, v.lon], {
      icon: L.divIcon({
        className: "",
        html: `<div class="spot-marker">${v.emoji}</div>`,
        iconSize: [30, 30], iconAnchor: [15, 15],
      }),
      interactive: false,
    }).addTo(transitLayer);
  }

  const nearest = [...lastVehicles]
    .sort((a, bb) => haversine(center, a) - haversine(center, bb))
    .slice(0, 6);
  els.transitList.innerHTML = nearest.length
    ? nearest.map((v) =>
        `<div class="transit-row"><span>${v.emoji}</span>` +
        `<strong>${esc(v.route)}</strong>` +
        `<span class="transit-dest">→ ${esc(v.headsign)}</span>` +
        `<span class="transit-dist">${t("away", Math.round(haversine(center, v)))}</span></div>`
      ).join("")
    : `<p class="transit-empty">${t("transitEmpty")}</p>`;
}

/* ---------- Mode switching ---------- */

function setMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  const heat = mode === "heat", transit = mode === "transit", spots = mode === "spots";
  els.modeSpots.setAttribute("aria-selected", String(spots));
  els.modeHeat.setAttribute("aria-selected", String(heat));
  els.modeTransit.setAttribute("aria-selected", String(transit));
  els.chips.hidden = !spots;
  els.card.hidden = !spots;
  els.heatPanel.hidden = !heat;
  els.transitPanel.hidden = !transit;
  document.body.classList.toggle("heat-on", heat);
  renderPicks(); // hides itself outside spots mode

  [greenLayer, spotLayer, routeLayer].forEach((l) => (spots ? l.addTo(map) : map.removeLayer(l)));

  if (heat) refreshHeat();
  else if (heatOverlay) { map.removeLayer(heatOverlay); heatOverlay = null; }

  clearInterval(transitTimer);
  if (transit) {
    transitLayer.addTo(map);
    els.transitKeyBox.hidden = !!transitKey();
    els.transitList.innerHTML = "";
    refreshTransit();
    transitTimer = setInterval(refreshTransit, 20000);
  } else {
    map.removeLayer(transitLayer);
  }
}

/* ---------- UI: chips, notice, card ---------- */

function renderChips() {
  els.chips.innerHTML = "";
  for (const [key, cat] of Object.entries(CATEGORIES)) {
    const btn = document.createElement("button");
    btn.className = "chip";
    btn.setAttribute("aria-pressed", String(state.layersOn[key]));
    btn.innerHTML = `<span>${cat.emoji}</span><span>${I18N[lang].catPlural[key]}</span>`;
    btn.addEventListener("click", () => {
      state.layersOn[key] = !state.layersOn[key];
      btn.setAttribute("aria-pressed", String(state.layersOn[key]));
      renderMarkers();
      renderPicks();
    });
    els.chips.appendChild(btn);
  }
}

let noticeTimer = null;
function showNotice(msg, sticky = false) {
  els.notice.textContent = msg;
  els.notice.hidden = false;
  clearTimeout(noticeTimer);
  if (!sticky) noticeTimer = setTimeout(() => { els.notice.hidden = true; }, 6000);
}

// Pick a random quip for the spot's type (building subtypes get their
// own lines), avoiding an immediate repeat of the previous one
const lastQuipIdx = {};
function pickQuip(spot) {
  const quips = I18N[lang].quips;
  const key = spot.cat === "building" && quips[`building:${spot.sub}`]
    ? `building:${spot.sub}` : spot.cat;
  const list = quips[key];
  if (!list?.length) return "";
  let idx = Math.floor(Math.random() * list.length);
  if (list.length > 1 && idx === lastQuipIdx[key]) idx = (idx + 1) % list.length;
  lastQuipIdx[key] = idx;
  return list[idx];
}

function renderCard(spot) {
  els.cardLoading.hidden = true;
  els.cardEmpty.hidden = true;

  if (!spot) {
    els.cardBody.hidden = true;
    els.cardEmpty.hidden = false;
    return;
  }
  els.cardBody.hidden = false;

  const cat = CATEGORIES[spot.cat];
  const isRec = state.recommendation && spot.id === state.recommendation.id;

  els.cardEmoji.textContent = cat.emoji;
  els.cardKicker.textContent = isRec ? t("recommended") : I18N[lang].cat[spot.cat];
  els.cardTitle.textContent = spotTitle(spot);
  ensurePlace(spot); // resolves "Pítko" → "Pítko u Obecního domu" async

  if (state.temperature != null && cat.cooling > 0) {
    els.cardTemp.textContent = `≈ ${Math.round(state.temperature - cat.cooling)} °C`;
  } else {
    els.cardTemp.textContent = "";
  }
  els.cardCooler.textContent = cat.cooling > 0 ? t("cooler", cat.cooling) : "";

  // Rotating quirky remark — chosen once per selection, so it doesn't
  // flicker on re-renders but differs between visits
  if (state.quipSpot !== spot.id || state.quipLang !== lang) {
    state.quip = pickQuip(spot);
    state.quipSpot = spot.id;
    state.quipLang = lang;
  }
  els.cardQuip.textContent = state.quip;
  els.cardQuip.hidden = !state.quip;

  const meters = spot.walkMeters ?? spot.distance;
  const minutes = spot.walkMinutes ?? estWalkMinutes(spot.distance);
  let openBadge = "";
  if (spot.cat === "building") {
    const st = openState(spot.hours);
    if (st !== null) {
      openBadge = `<span class="open-badge ${st ? "open" : "closed"}">${t(st ? "openNow" : "closedNow")}</span>`;
    }
  }
  els.cardMeta.innerHTML =
    openBadge +
    `<span><strong>${t("walk", minutes)}</strong></span>` +
    `<span>${t("away", meters)}</span>`;

  els.clearBtn.hidden = isRec && !state.routeLine;
}

function selectSpot(spot, pan = true) {
  state.selected = spot;
  clearRoute();
  renderMarkers();
  renderCard(spot);
  if (pan) map.panTo([spot.lat, spot.lon]);
}

function backToRecommendation() {
  clearRoute();
  selectSpot(state.recommendation, false);
  if (state.user) map.setView([state.user.lat, state.user.lon], 15);
}

/* ---------- i18n rendering ---------- */

function renderStaticText() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  els.langToggle.textContent = lang === "cs" ? "CS" : "EN";
}

/* ---------- Location + boot ---------- */

function getLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
}

async function loadArea(loc) {
  els.cardLoading.hidden = false;
  els.cardBody.hidden = true;
  els.cardEmpty.hidden = true;
  clearRoute();
  state.spotCache.clear();
  state.spots = [];
  state.loadedAreas = [];
  state.heatScale = null; // new location → new colour baseline

  fetchWeather(loc); // parallel, non-blocking

  await loadSpotsAround(loc, 1200);

  state.recommendation = pickRecommendation(state.spots);
  state.selected = state.recommendation;
  renderMarkers();
  renderCard(state.recommendation);
  state.booted = true;
  maybeLoadMore(); // catch up if the user panned away during boot
}

async function locate() {
  const loc = await getLocation();
  // Outside-Czechia locations get the Prague fallback too (data is CZ-only)
  const usable = loc && inCzechia(loc) ? loc : null;
  state.fallbackMsg = usable ? null : (loc ? "outsideCz" : "fallbackLocation");
  state.usingFallback = !usable;
  state.user = usable || PRAGUE;
  if (state.fallbackMsg) showNotice(t(state.fallbackMsg), true);
  else els.notice.hidden = true;

  renderUserMarker();
  map.setView([state.user.lat, state.user.lon], 15);
  await loadArea(state.user);
}

/* ---------- Events ---------- */

els.langToggle.addEventListener("click", () => {
  lang = lang === "cs" ? "en" : "cs";
  localStorage.setItem("eth-lang", lang);
  renderStaticText();
  renderChips();
  renderPicks();
  if (!els.cardBody.hidden) renderCard(state.selected);
  if (state.fallbackMsg && !els.notice.hidden) showNotice(t(state.fallbackMsg), true);
});

els.locateBtn.addEventListener("click", locate);

els.routeBtn.addEventListener("click", () => {
  if (state.selected) showRoute(state.selected);
});

els.clearBtn.addEventListener("click", backToRecommendation);

els.modeSpots.addEventListener("click", () => setMode("spots"));
els.modeHeat.addEventListener("click", () => setMode("heat"));
els.modeTransit.addEventListener("click", () => setMode("transit"));

els.transitKeySave.addEventListener("click", () => {
  const key = els.transitKeyInput.value.trim();
  if (!key) return;
  localStorage.setItem(TRANSIT_KEY_LS, key);
  els.transitKeyInput.value = "";
  els.transitKeyBox.hidden = true;
  els.notice.hidden = true;
  refreshTransit();
});

// Tapping empty map collapses an expanded cluster back to its single marker
map.on("click", () => {
  if (state.selected?.count > 1 && state.recommendation) {
    state.selected = state.recommendation;
    clearRoute();
    renderMarkers();
    renderCard(state.selected);
  }
});

let moveTimer = null;
map.on("moveend", () => {
  if (state.mode === "heat") {
    // Cheap when the lattice is already cached — just a redraw
    clearTimeout(heatTimer);
    heatTimer = setTimeout(refreshHeat, 400);
    return;
  }
  if (state.mode === "transit") {
    renderTransit(); // re-filter cached vehicles to the new viewport
    return;
  }
  renderMarkers(); // re-apply the viewport filter immediately
  clearTimeout(moveTimer);
  moveTimer = setTimeout(maybeLoadMore, 350);
});

/* ---------- Go ---------- */

renderStaticText();
renderChips();
locate();

// PWA: register the service worker on real deployments only — on
// localhost a cached shell would mask code changes during development
if ("serviceWorker" in navigator &&
    !["localhost", "127.0.0.1"].includes(location.hostname)) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js"));
}

// Debug handle for driving the app from the console
window.__eth = { map, state, czGenitive, spotTitle, setMode, selectSpot };
