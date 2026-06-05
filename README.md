# AccessPTT

Secure web console for an **operator** and an **admin** to **message, view, and
coordinate** field units in real time — built to run **free** ($0/month).

- **Operator:** Yitzy · iPad + headset
- **Admin:** Hillel · admin console
- **Units:** Shlomo, Ari, Gavriel — each with a 4G PTT Zello radio (voice) and a
  mini WiFi camera (video)

> **New here? Read [SETUP.md](./SETUP.md)** — it walks through the free/cheap way
> to connect messaging (Firebase free tier), the cameras, and voice.

## Features

- **Encrypted, role-based sign-in.** Two tabs on the lock screen:
  **Operator** (Yitzy, `AL1896$bob!`) and **Admin** (Hillel, `ervf37!`). Codes
  are verified locally against a SHA-256 hash — plaintext is never stored.
- **Unit camera wall.** A live tile per unit, name in the bottom-right corner,
  online/offline state. Plays HLS / MP4 / WebM / MJPEG streams, or embeds a
  YouTube-Live feed — set per unit in the in-app **⚙ Camera Settings** panel.
  Shows a simulated feed until a real URL is added.
- **Live messaging (Yitzy ⇄ Hillel).** Real-time across devices via the
  **Firebase free tier**; falls back to same-device delivery until configured.
- **Push-to-talk + green speaking ring.** Hold the PTT button (or **Space**) to
  go on air; the targeted unit's camera gets a glowing green ring and a
  `SPEAKING` badge. Live mic-level meter. (See voice note below.)

## Voice (important)

The radios use the **free Zello app** for walkie-talkie voice. Consumer Zello
has no public API, so the website can't carry that audio itself — voice runs in
the Zello app alongside this console. True in-browser radio audio would require
paid **Zello Work** + an API key (scaffolded in `config.js` for later).

## Run locally

Static site — no build step:

```bash
python3 -m http.server 8080   # then open http://localhost:8080
```

> Mic capture needs a secure context — use `http://localhost` or an HTTPS
> deploy. The app still runs without mic permission (simulated meter).

## Configuration

Everything site-specific is in [`config.js`](./config.js): people, passcode
hashes, units & camera URLs, Firebase keys, and the voice provider. Step-by-step
instructions are in [`SETUP.md`](./SETUP.md).

## Deploy

Pure static site (`netlify.toml`) on **Netlify** free tier, served over HTTPS
(required for camera/mic). Messaging talks to Firebase directly from the
browser, so there's no server to run. Any static host works.
