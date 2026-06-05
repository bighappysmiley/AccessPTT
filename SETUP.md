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
       "threads": { ".read": true, ".write": true },
       "$other": { ".read": false, ".write": false }
     }
   }
   ```

   > This is fine for low-stakes coordination. For stronger security later we
   > can add Firebase **Anonymous Auth** and restrict by signed-in user.

Until you fill this in, messaging still works **on the same device** (for
testing) and shows "local only" next to the name.

The Firebase config values are **safe to commit** — Firebase web keys are
public identifiers; security comes from the database rules above.

---

## 3. Cameras — getting your WiFi cams into the app (cheap, then $0/month)

Your units are on 4G, and **no browser can open a remote RTSP WiFi camera
directly** — it needs a small "translator". Two free options; both end with a
URL you paste into the in-app **⚙ Camera Settings** panel.

### Option A — go2rtc box (best quality, <1s delay)  ★ recommended
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

### Option B — free YouTube Live (no box, ~15s delay)
1. Point the camera (or a small encoder) to push **RTMP** to a free
   **unlisted YouTube Live** stream.
2. Paste the YouTube link (`https://youtu.be/…` or `…/live/…`) into Camera
   Settings — the app embeds it automatically.

> Any direct `.m3u8` / `.mp4` / `.webm` / MJPEG URL also works. For a generic
> embeddable page that isn't auto-detected, add `#embed` to the end of the URL.

Until a URL is added, each tile shows a **simulated feed** so the layout works.

---

## 4. Voice — walkie-talkie audio ($0)

The 4G PTT radios run the **free Zello app** for voice. Consumer Zello has **no
public API**, so the website cannot carry that audio itself (that would require
paid **Zello Work** + an API key). So:

- **Voice** = the Zello app on the radios and on the operator's iPad, running
  alongside this console.
- The in-app **push-to-talk** button drives the on-screen "speaking" ring and
  your local mic level for coordination.

If you ever move to **Zello Work**, set `voice.provider` to `'zello-work'` in
`config.js` and we can wire true in-browser PTT via the Zello Channels API.

---

## Cost summary

| Piece | Service | Monthly cost |
|---|---|---|
| Hosting | Netlify free | $0 |
| Messaging | Firebase Spark (free) | $0 |
| Cameras | go2rtc on a Pi/old PC, **or** free YouTube Live | $0 (one-time ~$0–40 hardware) |
| Voice | Free Zello app | $0 |
