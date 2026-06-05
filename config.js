/* =========================================================
 * AccessPTT — Configuration
 * ---------------------------------------------------------
 * Site-specific settings. Roles, people, units and access
 * live here so the deployment can be tailored without
 * touching application logic.
 * ======================================================= */

window.ACCESSPTT_CONFIG = {
  /* People in the system.
   * - operator: uses iPad + headset; views cameras, runs push-to-talk.
   * - admin:    can view everything and message the operator. */
  people: {
    operator: { id: 'yitzy',  name: 'Yitzy',  role: 'Operator', device: 'iPad · Headset' },
    admin:    { id: 'hillel', name: 'Hillel', role: 'Admin',    device: 'Admin Console' },
  },

  /* Access roles. The plaintext passcode is NEVER stored — only a
   * SHA-256 hash, verified locally on the device.
   * To rotate a code, run:
   *   node -e "console.log(require('crypto').createHash('sha256').update('NEW_CODE').digest('hex'))"
   * and replace the hash below.
   *   operator → AL1896$bob!
   *   admin    → ervf37!                                            */
  roles: {
    operator: { hash: 'e44302269299d84f67a1fbca7609c41ad60dc6cc3cf880a2a9b83596209a54c7' },
    admin:    { hash: 'b8cd0c1b4ccba9d179c2d61adab4377157aeb4ebe631554f9e8ab894a142793c' },
  },

  /* Field units. Voice runs on the unit's 4G PTT Zello radio (free Zello
   * app); the website shows each unit's mini WiFi camera feed.
   *
   * camera.stream: a browser-playable feed URL. Supported:
   *   - HLS (.m3u8), MP4, WebM, MJPEG  → e.g. the URL produced by a free
   *     go2rtc / MediaMTX box that bridges your RTSP WiFi cameras.
   *   - A YouTube Live / embeddable page URL → shown in an embedded frame
   *     (e.g. a camera pushing to a free unlisted YouTube Live stream).
   *   Leave empty to use the built-in simulated feed. URLs can also be set
   *   at runtime from the in-app Camera Settings (⚙) panel (saved per
   *   device). See SETUP.md for the cheap/free camera options.
   *
   * NOTE: Remote WiFi cameras only expose RTSP, which no browser can open
   *   directly — they need a small (free) bridge first. See SETUP.md.    */
  units: [
    { id: 'u-shlomo',   name: 'Shlomo',   camera: { stream: '' }, online: true },
    { id: 'u-ari',      name: 'Ari',      camera: { stream: '' }, online: true },
    { id: 'u-gavriel',  name: 'Gavriel',  camera: { stream: '' }, online: true },
  ],

  /* Messaging backend — Firebase Realtime Database (free "Spark" tier).
   * When configured, operator (Yitzy) and admin (Hillel) message each other
   * live across devices for $0. Until you paste your project config below,
   * the app falls back to same-device delivery so the UI still works.
   * Setup steps are in SETUP.md. The values below are safe to expose in a
   * client app (security is enforced by Realtime Database rules). */
  firebase: {
    apiKey: 'AIzaSyAdaczUdGIF5xOk8kF0cP6htDlHyl-ioZU',
    authDomain: 'accessptt.firebaseapp.com',
    databaseURL: 'https://accessptt-default-rtdb.firebaseio.com',
    projectId: 'accessptt',
    storageBucket: 'accessptt.firebasestorage.app',
    messagingSenderId: '1058310718077',
    appId: '1:1058310718077:web:86edbab412ad14af832714',
  },

  /* Voice.
   * The 4G PTT radios run the free Zello app for walkie-talkie voice.
   * Consumer Zello has no public API, so the website cannot carry that
   * audio itself (that needs paid "Zello Work" + an API key). The in-app
   * push-to-talk therefore drives the on-screen "speaking" indicator and
   * the operator's local mic level; the actual voice path is the Zello app
   * running alongside this console. */
  voice: {
    provider: 'zello-app',  // 'zello-app' (free) | 'zello-work' (paid API)
  },
};
