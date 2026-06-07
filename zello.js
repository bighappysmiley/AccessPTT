/* =========================================================
 * AccessPTT — Zello voice (Zello Channels API, BETA)
 * ---------------------------------------------------------
 * Connects the console to a Zello channel from the browser
 * using the official Zello Channels SDK (vendored under
 * /vendor/zcc). Lets the operator HEAR the channel and —
 * when a Zello username/password is configured — TALK to it
 * with push-to-talk.
 *
 * Works with the FREE consumer Zello network; you supply a
 * developer token (see SETUP.md §4). Listen-only needs only
 * a token; transmitting also needs a Zello account.
 * ======================================================= */

window.AccessPTTZello = (function () {
  'use strict';

  let session = null;
  let outgoing = null;
  let connected = false;
  let sdkReady = null;

  const conf = () => (window.ACCESSPTT_CONFIG || {}).zello || {};

  /* Is Zello configured enough to attempt a connection? */
  function available() {
    const z = conf();
    return !!(z.enabled && z.channel && (z.authToken || z.tokenEndpoint) && window.ZCC && window.ZCC.Sdk);
  }

  /* Transmitting also requires a Zello account. */
  function canTransmit() {
    return connected && !!conf().username;
  }
  function isConnected() { return connected; }

  /* Load the SDK's async modules (recorder/encoder/decoder/player). */
  function loadSdk() {
    if (sdkReady) return sdkReady;
    sdkReady = new Promise((resolve, reject) => {
      if (!window.ZCC || !window.ZCC.Sdk) { reject(new Error('Zello SDK not loaded')); return; }
      try {
        const p = window.ZCC.Sdk.init();
        if (p && typeof p.then === 'function') p.then(resolve).catch(reject);
        else resolve();
      } catch (e) { reject(e); }
    });
    return sdkReady;
  }

  async function getToken() {
    const z = conf();
    if (z.tokenEndpoint) {
      const r = await fetch(z.tokenEndpoint);
      if (!r.ok) throw new Error('token endpoint ' + r.status);
      const d = await r.json();
      return d.token || d.authToken || d.jwt;
    }
    return z.authToken;
  }

  function senderName(m) {
    try {
      if (!m) return 'unit';
      if (typeof m.getSenderName === 'function') return m.getSenderName() || 'unit';
      return m.sender || m.from ||
        (m.options && (m.options.from || m.options.sender)) ||
        (m.jsonData && m.jsonData.from) || 'unit';
    } catch (_) { return 'unit'; }
  }

  /* Connect to the channel. handlers: { onStatus(state, extra), onIncoming(name, active) } */
  async function connect(handlers) {
    handlers = handlers || {};
    const status = (s, e) => handlers.onStatus && handlers.onStatus(s, e);
    if (!available()) { status('disabled'); return; }

    try {
      await loadSdk();
      const z = conf();
      const token = await getToken();
      const opts = {
        serverUrl: z.serverUrl || 'wss://zello.io/ws',
        channel: z.channel,
        authToken: token,
      };
      if (z.username) { opts.username = z.username; opts.password = z.password; }

      session = new window.ZCC.Session(opts);

      session.on('session_connect', () => { connected = true; status('connected'); });
      session.on('session_fail_connect', (e) => { connected = false; status('error', e); });
      session.on('session_connection_lost', () => { connected = false; status('reconnecting'); });
      session.on('session_disconnect', () => { connected = false; status('disconnected'); });
      session.on('incoming_voice_will_start', (m) => handlers.onIncoming && handlers.onIncoming(senderName(m), true));
      session.on('incoming_voice_did_stop', (m) => handlers.onIncoming && handlers.onIncoming(senderName(m), false));

      status('connecting');
      session.connect((err) => { if (err) status('error', err); });
    } catch (e) {
      status('error', e);
    }
  }

  function startTalk() {
    if (!session || !connected) return false;
    try { outgoing = session.startVoiceMessage(); return true; }
    catch (_) { return false; }
  }
  function stopTalk() {
    if (outgoing) { try { outgoing.stop(); } catch (_) {} outgoing = null; }
  }

  function disconnect() {
    stopTalk();
    if (session) { try { session.disconnect(); } catch (_) {} session = null; }
    connected = false;
  }

  return { available, canTransmit, isConnected, connect, disconnect, startTalk, stopTalk };
})();
