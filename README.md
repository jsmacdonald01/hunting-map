# Hunting Map

A Texas hunting map for your PC and iPhone: satellite and topo maps, property lines with owner names,
TPWD public hunting areas, GPS, pins, walking paths, and offline counties.

## Start it on the PC

1. Open the `Hunting Map` folder (the one that holds this `app` folder).
2. Double-click **Start Hunting Map**.
3. A black window opens and then your browser opens the map. Leave the black window open; closing it turns the app off.

## Use it on the iPhone

The app lives on free GitHub Pages: **https://jsmacdonald01.github.io/hunting-map/**
Every change uploaded to GitHub updates that address about a minute later. The phone doesn't need the PC.

1. Open **Safari** on the iPhone and go to the address above.
2. Tap the **Share** button (square with an arrow), then **Add to Home Screen**, then **Add**.
3. Open Hunting Map from the home screen icon from now on. Allow location when it asks.

## Download counties for no-signal use

1. On Wi-Fi, open Hunting Map.
2. Tap **Menu**, then **Download maps**.
3. Tap **Download** next to a county and wait for it to finish (keep the app open).

Ready now: Montgomery, Walker, San Jacinto (Sam Houston National Forest).

## Add-ons (added 2026-11-05, try them and keep what you like)

- **Layers → Animal sightings:** deer, hogs, turkey, ducks, doves and more from iNaturalist and eBird. Dots or hot spots, by season.
- **Layers → Forest roads & trails:** Forest Service roads (with open dates), ATV trails and foot trails.
- **Today:** wind and weather, legal shooting hours, moon and feeding times, and which seasons are open.
- **Measure:** tap points for distance and acres.
- **Pins:** pick a kind (stand, trail cam, scrape, truck…), add photos, share by text.
- **Go to:** arrow and distance back to a pin, like your truck.
- **Menu → Pins & paths → Share** sends a walking path as a GPX file.
- Tapping Sam Houston National Forest shows TPWD facts (permits, phone, link).

Refresh sightings and roads with `node scripts/prepare-extras.mjs` (about 10 minutes).

## Good to know

- Property lines are approximate, not a survey. Some owner names are blank (the county left them out).
- With signal, the satellite map is Esri. Offline, it's the free USGS satellite map (a bit less sharp),
  because Esri's terms don't clearly allow saving their pictures.
- Walking paths only record while the app is open on screen. The screen stays on while recording.
- Pins, paths and downloads live on each device separately (the PC and phone don't share them).

## Adding another county (for Claude)

Add a line to `scripts/counties.mjs` (zip link from the TxGIO DataHub Land Parcels collection), then run
`npm run prepare-county -- <key>`. Refresh hunting areas with `npm run prepare-public`.
Test with `OWN_SERVER=1 PLAYWRIGHT_BROWSERS_PATH=0 node tests/check.mjs` (server must not already be running).
