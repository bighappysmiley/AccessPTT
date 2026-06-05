# AccessPTT

Secure web console for an **operator** to **speak to, hear, and view** field
units in real time.

- **Operator setup:** iPad + headset
- **Unit setup:** 4G PTT Zello radio · earpiece · mini WiFi camera

## Features

- **Encrypted passcode lock.** The app opens only after the operator enters the
  access passcode. The plaintext code is never stored — only a SHA-256 hash is
  kept, and verification happens locally on the device.
- **Unit camera wall (right side).** A live tile for every unit's mini WiFi
  camera, each labelled with the unit's name in the bottom-right corner. Tiles
  show online/offline state, and an offline unit reads `SIGNAL LOST`.
- **Push-to-talk.** Hold the big PTT button (or press **Space** with the
  headset) to transmit. Toggle **Talk to All** to broadcast to every online
  unit, or tap a single camera to target just that unit. A live mic-level meter
  shows you're on air.
- **Glowing green speaking ring.** While transmitting, a pulsing green ring
  wraps the camera(s) of the unit(s) currently being spoken to, with an
  on-screen `SPEAKING` badge.
- **Messaging window.** A chat panel (defaulting to **Hillel**) where the
  operator can send text messages to the selected unit and read their replies.

## Run locally

It's a static site — no build step:

```bash
# any static server works; this one ships with most machines
python3 -m http.server 8080
# then open http://localhost:8080
```

> Microphone capture (`getUserMedia`) requires a secure context, so use
> `http://localhost` (treated as secure) or an HTTPS deployment. Without mic
> permission the console still works and shows a simulated level meter.

## Configuration

All site-specific settings live in [`config.js`](./config.js):

- **Units** — name, online state, and each camera's `stream` URL (HLS `.m3u8`,
  MJPEG or MP4 from the mini WiFi camera). Leave `stream` empty to use the
  built-in simulated feed.
- **Operator** — name and device label shown in the top bar.
- **Default message unit** — which unit the messaging window opens on.

### Rotating the passcode

```bash
node -e "console.log(require('crypto').createHash('sha256').update('NEW_CODE').digest('hex'))"
```

Paste the result into `passcodeHash` in `config.js`.

## Deploy

Configured for **Netlify** (`netlify.toml`) as a zero-build static site served
over HTTPS — required for camera/mic access. Any static host works equally well.
