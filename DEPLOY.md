# Deploying Escape the Heat

The app is fully static (no build step, no API keys, no backend) and lives at
**https://github.com/hniv00/escape-the-heat**. Deploying = serving the repo
on any static host with HTTPS. HTTPS matters: browsers only allow geolocation
and service workers on secure origins, so the deployed app is the first place
the real "find cooling near me" flow works.

## Option A — GitHub Pages (recommended: repo already set up)
One-time, in the browser:
1. https://github.com/hniv00/escape-the-heat/settings/pages
2. Source: **Deploy from a branch** → Branch: **main**, folder **/ (root)** → Save
3. After ~1 minute the app is live at
   **https://hniv00.github.io/escape-the-heat/**
   (all app paths are relative, so the subpath works fine)

From then on every `git push` redeploys automatically.

## Option B — Netlify from Git
1. https://app.netlify.com → Add new site → Import an existing project
2. Pick the `escape-the-heat` GitHub repo, no build command, publish dir `/`
3. Auto-deploys on every push; nicer custom domains if wanted later

## After deploying — install on the phone
- **iPhone (Safari):** open the URL → Share → *Add to Home Screen*
- **Android (Chrome):** open the URL → the install prompt appears, or
  menu → *Install app*

It launches full-screen with the droplet icon, asks for location once,
and works like a native app.

## Updating a deployed version
1. Make changes locally, verify in the preview
2. Bump `CACHE` in `sw.js` (`eth-v1` → `eth-v2`, …) so installed phones
   pick up the new version immediately instead of after two visits
3. Re-deploy the folder the same way as before

## Notes
- The service worker only registers on the deployed site, not on
  localhost — local development always sees fresh code.
- All data sources (Overpass, Open-Meteo, OSRM, Nominatim, CARTO tiles)
  are free public services. Fine for personal use; if the app ever gets
  real traffic, add a caching proxy or self-hosted Overpass first.
