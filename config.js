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

  /* Field units. Each carries a 4G PTT Zello radio, an earpiece,
   * and a mini WiFi camera.
   *
   * camera.stream: a browser-playable URL from the unit's camera —
   *   HLS (.m3u8), MJPEG, MP4 or WebM. Leave empty to use the built-in
   *   simulated feed. Camera URLs can also be set/overridden at runtime
   *   from the in-app Camera Settings panel (saved per device).
   *
   * NOTE: Most WiFi cameras only expose RTSP, which browsers cannot play
   *   directly. Such cameras need a small restream (RTSP→HLS/WebRTC)
   *   gateway; paste that gateway's HLS/WebRTC URL here.            */
  units: [
    { id: 'u-shlomo',   name: 'Shlomo',   camera: { stream: '' }, online: true },
    { id: 'u-ari',      name: 'Ari',      camera: { stream: '' }, online: true },
    { id: 'u-gavriel',  name: 'Gavriel',  camera: { stream: '' }, online: true },
  ],

  /* Messaging backend (Netlify Functions). When reachable, messages
   * between the operator and admin sync live across devices. If it is
   * unreachable, the app falls back to same-device delivery so the UI
   * still works offline / in local dev. */
  messaging: {
    endpoint: '/api/messages',
    pollMs: 2500,
  },

  /* Zello voice.
   * Consumer Zello has no public API, so a browser cannot bridge audio
   * to/from the physical radios. Real in-browser voice requires a
   * "Zello Work" network + a developer API key (Zello Channels API).
   * When you have those, fill this in and live PTT can be enabled. */
  zello: {
    enabled: false,         // set true once Zello Work credentials exist
    network: '',            // e.g. "yourcompany" (Zello Work network)
    channel: '',            // channel name to transmit on
    // The auth token / JWT is issued from the Zello Work developer console
    // and should be minted by a backend, never hard-coded here.
    tokenEndpoint: '',      // backend endpoint that returns a Zello JWT
  },
};
