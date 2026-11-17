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

## The look and the controls (added 2026-11-16)

**Right edge**
- **Compass:** the orange tip points north. Tap it to turn the map north-up.
- **3D / 2D:** 3D shows real hills and creek bottoms (stretched about 2x so gentle East Texas ground is readable).
  In 3D, drag with two fingers to tilt and twist to rotate. 2D is the flat map.
- **Locate:** shows where you are with a blue dot, a halo for how exact the fix is, and a cone for the way you face.
  Tap again to re-centre; tap while it's following you to turn it off.
- **Moon:** red night mode, so the screen doesn't ruin your night vision.

**Top left: time of day**
- The pill shows the time and the wind. Tap it for a slider that runs through the day.
- The sun's real position lights the hills and colors the sky: dawn gold, midday, dusk, night.
- Sliding to an hour that has already passed plans **tomorrow**: the wind uses tomorrow's forecast for that hour.
- **Now** goes back to the live time.

**On the map**
- **Wind:** faint streaks drift the way the wind blows (Layers → Wind turns them off).
- **Scent fan:** tap one of your pins and an orange fan shows where your scent drifts at the time on the slider.
- **Map types** (Layers): Satellite, Hybrid (satellite with topo lines over it) and Topo fade into each other.
- Pins glow, the tapped pin gets a ring, saved paths draw themselves in when you tap Show, and the go-to line flows toward the pin.
- **Opening fly-in:** on a fresh start the app flies from the globe down to your last view. Tap to skip.
  It doesn't play when you flip back to the app within half an hour.

**Sharper pictures and Street View (added 2026-11-17)**
- **Layers → Summer photo / Winter, leaves off:** two Texas state aerial photos (2022 and 2015). The winter one shows
  trails and creek bottoms that summer leaves hide. They need signal. With signal, the Esri satellite is still the sharpest.
- **Zoom** goes two steps closer than before (the picture gets bigger, not finer; Esri has nothing finer here).
- **Menu → Download maps → Extra sharp offline photos:** saves the state's 2022 photo at twice the detail for use with
  no signal. About triple the size per county, and slower to download. Tap **Update** on a county to add it.
- **Street View** and **Google Maps** buttons are at the bottom of every tap card and pin card. Street View only
  has pictures along roads, and needs signal.
- The state's extra-sharp 6-inch photos don't cover Montgomery, Walker or San Jacinto counties.

**Small things (2026-11-17)**
- Every switch in **Layers** remembers how you left it, even after closing the app. There are now switches for
  **My pins** and **My paths** too.
- The blue wash over public hunting land fades out as you zoom in, so you can see the ground. Outlines stay.
- If the phone refuses location, the locate button shows the exact iPhone settings to check.
- Camps, parking, info stations, boat ramps and gates on public land are square badges (tent, P, i…), so they
  can't be mistaken for the round blue "you are here" dot.

**Grid-down map: Galveston to Huntsville (added 2026-11-17)**
- **Layers → Roads, rail & towns:** every road, side road, service road, track, path and railroad, with street and
  town names (from OpenStreetMap). Highways are orange, other roads white, railroads have a tie pattern, tracks are dashed.
- **Menu → Download maps → Grid-down map** saves the whole area from Galveston and Freeport up past Huntsville, in
  three parts you choose: **Roads, rail lines and town names** (about 190 MB, do this one first), **Topo map**
  (about 1 GB) and **Satellite picture** (about 1 GB, less detail than a county download).
- Use Wi-Fi, plug the phone in and keep the app open; the big parts take a while. **Stop** and **Update** pick up
  where they left off.
- Property owner names are only saved for the three hunting counties, not the whole area.
- Your location marker is now a big blue dot with a **YOU** tag. The direction cone turns on with a second tap of
  the locate button (an iPhone home-screen app can only ask one permission question at a time).

**Menu → Display**
- **Graphics:** Auto (eases off by itself on a slow phone, low battery or Low Power Mode), Full, or Lite.
- Night mode switch, and a switch to turn the opening fly-in off.

**Offline:** county downloads now include the 3D ground. A county downloaded before this update needs one tap on
**Update** (Menu → Download maps) to get it. Without it the map still works offline, just flat.

## Good to know

- Property lines are approximate, not a survey. Some owner names are blank (the county left them out).
- With signal, the satellite map is Esri. Offline, it's the free USGS satellite map (a bit less sharp),
  because Esri's terms don't clearly allow saving their pictures.
- Walking paths only record while the app is open on screen. The screen stays on while recording.
- Pins, paths and downloads live on each device separately (the PC and phone don't share them).

## How the code is laid out

`public/app.js` starts everything. Each part has its own file: `map.js` (the map and layers), `layers.js` (map type,
sightings, roads, online check), `parcels.js`, `pins.js`, `tracks.js`, `menu.js`, `gps.js`, `terrain.js` (3D),
`daylight.js` (sun and time slider), `wind.js` (wind, scent, weather mood), `effects.js` (animations), `intro.js`,
`perf.js` (keeps it smooth and rests effects when idle), `ui.js`, `core.js`. Storage (`db.js`) is unchanged.

Tests (the server must not already be running): `tests/addons.mjs`, `tests/visuals.mjs`, `tests/check.mjs` (slow,
downloads a county), each run as `OWN_SERVER=1 PLAYWRIGHT_BROWSERS_PATH=0 node tests/<name>`. `tests/shots.mjs` takes
screenshots at chosen times of day for checking the look.

## Adding another county

Add a line to `scripts/counties.mjs` (zip link from the TxGIO DataHub Land Parcels collection), then run
`npm run prepare-county -- <key>`. Refresh hunting areas with `npm run prepare-public`.
Test with `OWN_SERVER=1 PLAYWRIGHT_BROWSERS_PATH=0 node tests/check.mjs` (server must not already be running).
