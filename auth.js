/* =========================================================
 * AccessPTT — Authentication
 * ---------------------------------------------------------
 * The access passcode is verified locally against a stored
 * SHA-256 hash. The plaintext passcode is never persisted
 * and never leaves the device.
 * ======================================================= */

(function () {
  'use strict';

  const SESSION_KEY = 'accessptt.session';
  const cfg = window.ACCESSPTT_CONFIG || {};

  /* Hash arbitrary text with SHA-256 using the Web Crypto API. */
  async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  const Auth = {
    /* True when the operator has already unlocked this session. */
    isUnlocked() {
      return sessionStorage.getItem(SESSION_KEY) === 'true';
    },

    /* Verify a passcode against the configured hash. */
    async verify(passcode) {
      if (!passcode) return false;
      const hash = await sha256(passcode);
      const ok = hash === cfg.passcodeHash;
      if (ok) sessionStorage.setItem(SESSION_KEY, 'true');
      return ok;
    },

    /* Lock the console for the current session. */
    lock() {
      sessionStorage.removeItem(SESSION_KEY);
    },
  };

  window.AccessPTTAuth = Auth;
})();
