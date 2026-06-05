/* =========================================================
 * AccessPTT — Configuration
 * ---------------------------------------------------------
 * Operator console settings. Units, cameras and access are
 * defined here so the deployment can be tailored on site
 * without touching application logic.
 * ======================================================= */

window.ACCESSPTT_CONFIG = {
  /* SHA-256 hash of the encrypted access passcode.
   * The plaintext passcode is NEVER stored in the app.
   * To rotate the passcode, run:
   *   node -e "console.log(require('crypto').createHash('sha256').update('NEW_CODE').digest('hex'))"
   * and replace the value below. */
  passcodeHash: 'e44302269299d84f67a1fbca7609c41ad60dc6cc3cf880a2a9b83596209a54c7',

  /* Operator identity shown in the top bar. */
  operator: {
    name: 'Operator',
    device: 'iPad · Headset',
  },

  /* Field units. Each unit carries a 4G PTT Zello radio,
   * an earpiece, and a mini WiFi camera.
   *
   * camera:
   *   - "stream": an HLS (.m3u8), MJPEG or MP4 stream URL from the
   *               unit's mini WiFi camera. Leave empty to use the
   *               built-in simulated feed (useful for demos / when a
   *               camera is offline).
   * online: initial connection state.
   */
  units: [
    { id: 'u-hillel', name: 'Hillel', camera: { stream: '' }, online: true },
    { id: 'u-moshe',  name: 'Moshe',  camera: { stream: '' }, online: true },
    { id: 'u-david',  name: 'David',  camera: { stream: '' }, online: true },
    { id: 'u-sarah',  name: 'Sarah',  camera: { stream: '' }, online: true },
    { id: 'u-eli',    name: 'Eli',    camera: { stream: '' }, online: false },
    { id: 'u-noa',    name: 'Noa',    camera: { stream: '' }, online: true },
  ],

  /* Which unit the messaging window targets by default. */
  defaultMessageUnit: 'u-hillel',
};
