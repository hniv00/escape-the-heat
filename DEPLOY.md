# Deploying Escape the Heat

The app is fully static (no build step, no API keys, no backend). Deploying =
putting this `code/` folder on any static host with HTTPS. HTTPS matters:
browsers only allow geolocation and service workers on secure origins, so the
deployed app is the first place the real "find cooling near me" flow works.

## Option A — Netlify Drop (fastest, no account tooling)
1. Open https://app.netlify.com/drop
2. Drag the whole `code/` folder onto the page
3. Done — you get an `https://<something>.netlify.app` URL immediately
4. (Optional) Log in to keep the site permanent and rename it:
   Site settings → Change site name → e.g. `escape-the-heat`

## Option B — Vercel CLI
```bash
cd "personal/escape-the-heat/code"
npx vercel --prod
```
Log in when prompted (first time only), accept the defaults.

## Option C — GitHub Pages
```bash
cd "personal/escape-the-heat/code"
git init && git add -A && git commit -m "Escape the Heat"
gh repo create escape-the-heat --public --source=. --push
gh api repos/{owner}/escape-the-heat/pages -X POST -f 'source[branch]=main' -f 'source[path]=/'
```
App appears at `https://<username>.github.io/escape-the-heat/`
(all paths in the app are relative, so a subpath works fine).

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
