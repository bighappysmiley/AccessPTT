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
   *   directly — they need a small (free) bridge first. See SETUP.md.
   *
   * zello: the unit's Zello USERNAME only (no password). The unit's radio
   *   logs into Zello itself, so the console never needs their password —
   *   this is used purely to light the right tile's green ring when that
   *   unit talks on the channel. Leave blank to match by display name.    */
  units: [
    { id: 'u-shlomo',   name: 'Shlomo',   zello: '20shlomo26',  camera: { stream: '' }, online: true },
    { id: 'u-ari',      name: 'Ari',      zello: '20ari26',     camera: { stream: '' }, online: true },
    { id: 'u-gavriel',  name: 'Gavriel',  zello: '20gavriel26', camera: { stream: '' }, online: true },
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

  /* Voice — real Zello connection (Zello Channels API, BETA).
   *
   * This connects the console directly to a Zello channel from the browser,
   * so the operator can HEAR the channel and (with credentials) TALK to it.
   * Works with the FREE consumer Zello network — you just need a developer
   * token. See SETUP.md §4 for step-by-step setup.
   *
   *  - enabled:      turn the integration on.
   *  - serverUrl:    wss://zello.io/ws for consumer Zello (default).
   *  - channel:      the exact Zello channel name to join.
   *  - authToken:    a developer token from https://developers.zello.com
   *                  (the 30-day "Sample Development Token" is fine to test).
   *  - tokenEndpoint:optional — a backend URL returning a fresh signed JWT,
   *                  for production (so the token never expires/leaks).
   *  - username/password: a Zello account. ONLY needed to TRANSMIT (talk).
   *                  Leave blank for listen-only (hear the channel).
   *
   * SECURITY: anything here ships to the browser. For listen-only, just a
   * token is needed (no password). Do NOT commit a real Zello password to a
   * public repo — fill credentials in your private deployment only. */
  zello: {
    enabled: true,
    serverUrl: 'wss://zello.io/ws',
    channel: 'Universe Channel',
    authToken: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJXa002Vm1semFXOXVSR1YyT2pFLnU5ejNDWHJXUndGSlFoNkxMcWJWeFdZU19WS2haRXhseHlGUTBZcGVTU2ciLCJleHAiOjE3ODM0NzYyOTEsImF6cCI6ImRldiJ9.STEyr-ZE_cjdUwxIGec_F7sqyiI2RcJhBIIor62dLaCNKUebJAhcNqBZFIMbyOgM6dXIXL5iGosFyEboiunSlnPPD4wKF3DFkHmfHmX0xY6ZLySRLkelFJqxUPKVHy7d7BeEQ0cLQeHte_9_vvBWCJ9iY_i0uQke3Zj0mGSbkIDrAQMvqTUujF9FKEg6HP07UdYmv9CoPgxN69fxe3kbzGe-HWqKCfaoq_BQmK0ZVhqRFNNUEMUlmBzl9dSky5nWrgwFqmQE1fYnRFHI9vaa0jjLwnL8h7fVxQPOwTspqudRcph3_fouugpwyH_LemozYTjncAfOZFQUzt6FBmNSlA',
    tokenEndpoint: '',
    /* Each console user signs in to Zello with THEIR OWN account.
     * Operator (Yitzy) and Admin (Hillel) are separate Zello accounts;
     * the console logs in with the one matching whoever signed in.
     * Leave a password blank for listen-only for that role. */
    accounts: {
      operator: { username: 'IMS Login', password: '' },  // Yitzy's Zello account
      admin:    { username: 'VisionDev', password: '' },   // Hillel's Zello account
    },
  },
};
