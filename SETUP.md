# AccessPTT — Setup Guide (the free / cheap path)

This explains, in plain language, how to make the console actually work end to
end without monthly fees. There are three pieces: **sign-in**, **messaging**,
**cameras**, and **voice**.

---

## 1. Sign-in (already works, free)

- Open the site → **Operator** tab, passcode `AL1896$bob!` → you're **Yitzy**.
- **Admin** tab, passcode `ervf37!` → you're **Hillel**.

To change a passcode, generate a new hash and paste it into `config.js`:

```bash
node -e "console.log(require('crypto').createHash('sha256').update('NEW_CODE').digest('hex'))"
```

---

## 2. Messaging between Yitzy & Hillel — Firebase free tier ($0)

Live messaging across two different devices needs a tiny real-time database.
**Firebase's free "Spark" plan** is perfect and needs **no credit card**.

1. Go to <https://console.firebase.google.com> → **Add project** (any name).
2. In the project, open **Build → Realtime Database → Create Database**.
   - Pick a location, start in **test mode** (we'll lock it down in step 4).
3. Open **Project settings → General → Your apps → Web app** (the `</>` icon),
   register an app, and copy the `firebaseConfig` values.
4. Paste them into the `firebase` block of `config.js`:

   ```js
   firebase: {
     apiKey: 'AIza…',
     authDomain: 'your-project.firebaseapp.com',
     databaseURL: 'https://your-project-default-rtdb.firebaseio.com',
     projectId: 'your-project',
     appId: '1:…:web:…',
   },
   ```

5. Lock the database so only the messages branch is readable/writable. In
   **Realtime Database → Rules**, set:

   ```json
   {
     "rules": {
       "threads":  { ".read": true, ".write": true },
       "rooms":    { ".read": true, ".write": true },
       "presence": { ".read": true, ".write": true },
       "$other":   { ".read": false, ".write": false }
     }
   }
   ```

   > `threads` carries the chat; `rooms` carries the live-camera connection
   > handshake (section 3A); `presence` carries Online/Busy/Offline status.
   > This is fine for low-stakes coordination. For
   > stronger security later we can add Firebase **Anonymous Auth** and
   > restrict by signed-in user.

Until you fill this in, messaging still works **on the same device** (for
testing) and shows "local only" next to the name.

The Firebase config values are **safe to commit** — Firebase web keys are
public identifiers; security comes from the database rules above.

---

## 3. Cameras — getting your WiFi cams into the app (cheap, then $0/month)

There are two ways to feed cameras in. **Option A (built in, free, recommended)**
uses any phone/tablet/webcam at the unit as the camera — no special hardware.
Options B/C are for standalone IP cameras and end with a URL you paste into the
in-app **⚙ Camera Settings** panel.

### Option A — the unit's own device streams into the app  ★ recommended (free)
The live camera is **built into AccessPTT** over WebRTC, using the Firebase you
set up in section 2 (so make sure `rooms` is in your database rules).

1. At the unit, take any device with a camera + browser (a cheap/old phone,
   tablet, or a laptop webcam).
2. Open **`/unit.html`** on it (e.g. `https://your-site.netlify.app/unit.html`).
   Tip: open `…/unit.html?u=u-shlomo` to preselect that unit.
3. Pick the unit name, enter the access passcode (`AL1896$bob!`), tap **Go Live**,
   and allow camera + microphone.
4. That unit's tile in the operator/admin dashboard goes live within a second or
   two. The operator also hears the unit's mic.

Notes:
- Live video uses **mobile data** (~0.5–1 GB/hour) when on 4G.
- Connections use free STUN + a free public **TURN** relay so they work across
  mobile networks (CGNAT). The public TURN has no uptime guarantee — for
  production, plug your own TURN credentials into `webrtc.js`.
- Leave the unit page open with the screen on (it requests a wake-lock).

### Option B — go2rtc box (for standalone IP cameras, <1s delay)
1. Run **[go2rtc](https://github.com/AlexxIT/go2rtc)** (free, open-source) on
   any always-on machine: a **Raspberry Pi (~$40)** or **an old PC/laptop you
   already own ($0)**.
2. Add each camera's RTSP URL to go2rtc's config. (Find your camera's RTSP URL
   at <https://www.webrtsp.com/rtsp-guide>.)
3. go2rtc gives each camera an **HLS** URL like
   `http://<box>:1984/api/stream.m3u8?src=shlomo`. Paste it into Camera
   Settings for that unit. Done — live feed in the app.
   - To view from outside your network, expose the box with a free tunnel like
     **Cloudflare Tunnel** (free).

### Option C — free YouTube Live (no box, ~15s delay)
1. Point the camera (or a small encoder) to push **RTMP** to a free
   **unlisted YouTube Live** stream.
2. Paste the YouTube link (`https://youtu.be/…` or `…/live/…`) into Camera
   Settings — the app embeds it automatically.

> Any direct `.m3u8` / `.mp4` / `.webm` / MJPEG URL also works. For a generic
> embeddable page that isn't auto-detected, add `#embed` to the end of the URL.

Until a URL is added, each tile shows a **simulated feed** so the layout works.

---

## 4. Voice — connect the console to Zello (BETA, $0)

The console can connect **directly to a Zello channel from the browser** using
the Zello **Channels API** — and this works with the **free consumer Zello
network**. The operator can **hear** the channel, and with a Zello account can
**push-to-talk** to it. The field units keep using their normal Zello radios on
the same channel.

### Get a developer token (free)
1. Make sure you have a (free) **Zello account** in the Zello app, and create or
   join a **channel** (note its exact name).
2. Go to **<https://developers.zello.com>** and log in with your Zello account.
3. Fill in the developer profile and submit. Copy the **Sample Development
   Token** (a long JWT). It's valid for **30 days** — perfect for testing.

### Configure the app
In `config.js`, edit the `zello` block:

```js
zello: {
  enabled: true,
  serverUrl: 'wss://zello.io/ws',     // consumer Zello
  channel: 'YOUR CHANNEL NAME',
  authToken: 'PASTE_DEVELOPMENT_TOKEN',
  // To TALK (not just listen), add a Zello account:
  username: '',   // your Zello username
  password: '',   // your Zello password
},
```

- **Listen-only:** leave `username`/`password` blank — the operator will *hear*
  the channel. The top-bar pill shows **Zello: listening**.
- **Talk too:** add a Zello `username`/`password`. Push-to-talk then transmits
  to the channel, and the pill shows **Zello: ready**. When a unit talks, their
  camera tile lights up with the green "speaking" ring (matched by name).

### Important notes
- **Security:** everything in `config.js` ships to the browser. For listen-only
  you only need the token (no password). **Do not commit a real Zello password
  to a public repo** — add credentials only in your private deployment.
- **Production tokens:** the dev token expires in 30 days. For a permanent
  setup, host a tiny backend that signs JWTs with your Zello **issuer + private
  key** (also from the developer portal) and set `tokenEndpoint` to its URL
  instead of `authToken`.
- This is **BETA** and uses the vendored Zello JS SDK in `/vendor/zcc`. Test on
  a real device with mic permission over HTTPS.

---

## Cost summary

| Piece | Service | Monthly cost |
|---|---|---|
| Hosting | Netlify free | $0 |
| Messaging | Firebase Spark (free) | $0 |
| Cameras | unit device via `/unit.html` (built in), or go2rtc, or YouTube Live | $0 (+ mobile data for live video) |
| Voice | Zello Channels API on the free consumer network (dev token) | $0 |
