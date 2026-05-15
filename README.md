# Maritime Rescue Dashboard — Carrickfinn Station

A fullscreen, kiosk-mode HTML dashboard for a wall-mounted display in a Coast Guard / maritime rescue operations room. Designed to run unattended for weeks on a Raspberry Pi or mini-PC, displaying live weather, sea state, tides, sun/moon data, and active Met Éireann warnings for Carrickfinn Beach, Co. Donegal, Ireland.

- **Location:** Carrickfinn Beach (55.04385° N, 8.34712° W)
- **Units:** Metric — °C, km/h, m, hPa, mm
- **Timezone:** Europe/Dublin
- **Language:** English

No build step. No npm. No frameworks. Just plain HTML, CSS, and vanilla JavaScript that runs from `file://` or any static webserver.

---

## What it shows

| Section | Data |
|---|---|
| **Header** | Station name, coordinates, large clock, current date, "last updated" stamp |
| **Warning banner** *(when active)* | Met Éireann warnings filtered for Donegal / coastal / marine, colour-coded yellow / orange / red |
| **Atmospheric card** | Temperature, feels-like, sky, humidity, precipitation, **visibility** (highlighted red < 1 km), pressure + 3 h trend |
| **Wind card** | Animated compass rose, wind speed, gusts, Beaufort badge, colour-coded by speed |
| **Sea-state card** | Wave height, period, direction (mini compass), swell height + period, sea surface temperature, colour-coded by wave height |
| **Tides** | 24 h SVG curve, current-tide marker, next 4 high / low events, rising / falling status |
| **Footer** | Sunrise, sunset, daylight remaining countdown, moon phase, Beaufort legend |

Visual alerts (gentle pulse on affected card) trigger when any threshold in `config.js` is exceeded:
- Sustained wind > 50 km/h
- Gusts > 75 km/h
- Wave height > 3 m
- Visibility < 1 km
- Any matching Met Éireann warning

---

## Data sources

All free, no API key required for the MVP:

- **Open-Meteo Forecast** — weather, sunrise/sunset, hourly pressure history (3 h trend)
- **Open-Meteo Marine** — wave height/period/direction, swell, sea surface temperature
- **Met Éireann Open Data** — Irish public warnings feed (filtered)
- **Tides** — harmonic estimate (M2 + S2 + N2) by default. Add a Stormglass or WorldTides API key in `config.js` for accurate data (see below).

---

## Quick start (local test)

The whole dashboard is a folder of static files. Open `index.html` in any modern browser:

**Windows (PowerShell):**
```powershell
Start-Process "index.html"
```

**macOS:**
```bash
open index.html
```

**Linux:**
```bash
xdg-open index.html
```

Or serve it from a tiny local webserver (recommended — avoids any `file://` CORS quirks):

```bash
# Python 3
python -m http.server 8080
# then open http://localhost:8080/
```

Fullscreen kiosk-style locally:
```bash
chromium --kiosk --noerrdialogs --disable-features=Translate file:///absolute/path/to/maritime-dashboard/index.html
```

---

## Editing `config.js`

Open `config.js` in a text editor. Sections:

```js
station       // name, coordinates, timezone
refresh       // polling intervals (ms)
alerts        // threshold values for the pulse alert
colorThresholds // colour bands for wind & wave cards
warnings      // keywords used to match Met Éireann warnings
apiKeys       // optional Stormglass / WorldTides keys
ui            // dark mode default, show seconds
```

Save and reload the page. No build step.

---

## API keys for operational reliability

For real operational use we strongly recommend filling in three free API keys. All three are free, no credit card required (except OWM which asks for one but never charges on free tier).

### Tide data — recommended for any operational use

The default tide curve is a 3-constituent harmonic **estimate** — it's clearly labelled as such in the UI and can be off by ±30 min and ±0.5 m. For operational accuracy add **one** of the following keys:

### Stormglass (50 requests/day free)
1. Register at <https://stormglass.io/>
2. Copy your API key
3. Paste into `config.js`:
   ```js
   apiKeys: {
     STORMGLASS_KEY: 'paste-key-here',
     WORLDTIDES_KEY: ''
   }
   ```
4. Reload. The tide source label will change from "Estimated" to "Stormglass".

### WorldTides (100 requests/month free)
1. Register at <https://www.worldtides.info/>
2. Copy your API key
3. Paste into `config.js`:
   ```js
   apiKeys: {
     STORMGLASS_KEY: '',
     WORLDTIDES_KEY: 'paste-key-here'
   }
   ```

The dashboard polls tide data once an hour, well within both free tiers.

### OpenWeatherMap — independent backup provider

Without this key, the weather chain only uses Open-Meteo (which combines several numerical models internally — so you have model redundancy but not provider redundancy). Adding an OpenWeatherMap key gives true second-provider redundancy: if Open-Meteo's API goes down entirely, the dashboard automatically switches to OWM and the source badge turns amber.

1. Register at <https://openweathermap.org/api> — free tier: 60 calls/min, 1M/month
2. Wait ~2 hours after sign-up for the key to activate
3. Paste into `config.js`:
   ```js
   apiKeys: {
     STORMGLASS_KEY:    '',
     WORLDTIDES_KEY:    '',
     OPENWEATHERMAP_KEY: 'paste-key-here'
   }
   ```
4. Reload. When OWM is used you'll see "via OpenWeatherMap" (amber) under the panel title.

Daily usage at default refresh: ~290 calls/day (weather + 3-h forecast every 10 min) — well within the free tier.

---

## Raspberry Pi kiosk-mode setup

Recommended hardware:
- **Raspberry Pi 4 (4 GB)** or newer
- **Wired Ethernet** (recommended over Wi-Fi for reliability)
- **24"+ display** at 1920×1080 or higher
- HDMI cable, official Pi power supply

### 1. Install Raspberry Pi OS (Bookworm or later, Desktop with recommended software)

Use Raspberry Pi Imager → Raspberry Pi OS (64-bit) with desktop. During imaging set:
- Hostname: `rescue-dashboard`
- A username/password
- Enable SSH
- Set locale: Europe/Dublin, en_IE.UTF-8, Irish keyboard

### 2. First boot

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y chromium-browser unclutter xdotool
```

### 3. Copy the dashboard

Put the `maritime-dashboard/` folder somewhere stable, e.g.:
```bash
mkdir -p /home/pi/maritime-dashboard
# scp / rsync / git clone the files into that folder
```

### 4. Disable screen blanking

Edit `/etc/lightdm/lightdm.conf` — under `[Seat:*]` add:
```ini
xserver-command=X -s 0 -dpms
```

And in `/etc/xdg/lxsession/LXDE-pi/autostart` (or `~/.config/lxsession/LXDE-pi/autostart`) make sure these lines are present:
```
@xset s off
@xset -dpms
@xset s noblank
@unclutter -idle 0.5 -root
```

### 5. Auto-launch Chromium in kiosk mode

Create `~/.config/autostart/maritime-dashboard.desktop`:
```ini
[Desktop Entry]
Type=Application
Name=Maritime Dashboard
Exec=/usr/bin/chromium-browser --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --check-for-update-interval=31536000 --incognito file:///home/pi/maritime-dashboard/index.html
X-GNOME-Autostart-enabled=true
```

`--incognito` prevents the "Restore session?" dialog after a power loss.

### 6. (Optional) Auto-restart on crash via systemd

Create `/etc/systemd/system/maritime-dashboard.service`:
```ini
[Unit]
Description=Maritime Rescue Dashboard (Chromium kiosk)
After=graphical.target network-online.target
Wants=network-online.target

[Service]
User=pi
Environment=DISPLAY=:0
Environment=XAUTHORITY=/home/pi/.Xauthority
ExecStart=/usr/bin/chromium-browser --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --check-for-update-interval=31536000 --incognito file:///home/pi/maritime-dashboard/index.html
Restart=always
RestartSec=10

[Install]
WantedBy=graphical.target
```

Enable:
```bash
sudo systemctl daemon-reload
sudo systemctl enable maritime-dashboard.service
```

### 7. (Optional) Screen rotation

If the display is mounted portrait, edit `/boot/firmware/config.txt` (or `/boot/config.txt` on older OS):
```
display_rotate=1   # 1 = 90°, 2 = 180°, 3 = 270°
```

### 8. (Optional) Weekly reboot to keep memory tidy

```bash
sudo crontab -e
```
Add:
```
0 4 * * 1 /sbin/reboot
```
(Reboots Monday 04:00.)

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Whole screen blanks at night | Steps 4 + autostart `@xset` lines not applied; check `~/.config/lxsession/LXDE-pi/autostart` |
| "No network" banner stays on | Check `ping api.open-meteo.com`; verify Ethernet; the dashboard backs off exponentially up to 5 min |
| Tide says "Estimated" | Add a Stormglass or WorldTides API key in `config.js` (see above) |
| Met Éireann warnings never appear | The current verified endpoint is `https://www.met.ie/Open_Data/json/warning_IRELAND.json` (returns `[]` when no warnings are active — that's normal). Met Éireann has changed this URL before; add new ones to `warnings.urls` in `config.js` if they break it again. Some Met Éireann endpoints intermittently lack CORS headers from `file://` — serve via `python -m http.server` and point Chromium at `http://localhost:8080/` if so. |
| Wrong time / wrong timezone | `sudo timedatectl set-timezone Europe/Dublin` and reboot |
| Card stuck "stale" (greyed) | Browser console shows the failing fetch; check upstream API status |
| Chromium "session crashed" banner after power loss | `--incognito` flag in the autostart entry suppresses it |
| Clock keeps showing the same second | `setInterval` paused — usually because Chromium throttled the background tab; the visibility listener auto-resumes when the screen wakes |

---

## How robustness works

- Every fetch is wrapped in `try/catch` with a 15 s timeout (AbortController).
- On failure: keep showing previous data, mark the card visually stale, exponentially back off (capped at 5 min between retries).
- Last successful response for each source is mirrored to `localStorage`, so after a power cycle the dashboard paints immediately from cache while it re-fetches.
- The tab-visibility API pauses polling when the screen sleeps and forces a refresh when it wakes.
- A 1-minute watchdog kicks any source whose last success is older than 4× its refresh interval.
- A single failing source never blocks the others — they each have their own scheduler.

---

## Customising for another station

Change four values in `config.js`:
```js
station: {
  name: 'Your Station',
  label: 'MARITIME RESCUE — YOUR STATION',
  latitude: 53.27,
  longitude: -9.05,
  timezone: 'Europe/Dublin'
}
```
Open-Meteo handles any lat/lon globally. Met Éireann warnings only cover Ireland — outside Ireland, edit `warnings.regionKeywords` to filter your local warning feed (or remove the banner from `index.html`).

---

## Known limitations

- Tide data is a **harmonic estimate** until you add a Stormglass / WorldTides key.
- Met Éireann's JSON feed CORS headers are inconsistent; if the warning banner is empty when active warnings exist nationally, serve via `http://localhost:8080/` instead of `file://`.
- Open-Meteo's free tier is rate-limited; the default 10-min refresh is well within limits.
- Sea-surface temperature for Open-Meteo Marine is a modelled value, not a buoy reading.

---

## Files

| File | Purpose |
|---|---|
| `index.html` | DOM structure |
| `style.css` | All styling (dark theme by default, light theme toggle) |
| `app.js`    | All logic (fetchers, renderers, scheduler, SVG drawing) |
| `config.js` | Edit-only configuration (no logic) |
| `README.md` | This file |

---

Data: Open-Meteo · Met Éireann.
