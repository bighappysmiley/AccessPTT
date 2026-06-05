/* =========================================================
 * AccessPTT — Authentication
 * ---------------------------------------------------------
 * Two roles (operator / admin), each gated by an encrypted
 * passcode. Codes are verified locally against a stored
 * SHA-256 hash; the plaintext is never persisted and never
 * leaves the device.
 * ======================================================= */

(function () {
  'use strict';

  const SESSION_KEY = 'accessptt.session.role';
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
    /* The role unlocked for this session, or null. */
    currentRole() {
      const r = sessionStorage.getItem(SESSION_KEY);
      return r === 'operator' || r === 'admin' ? r : null;
    },

    isUnlocked() {
      return this.currentRole() !== null;
    },

    /* Verify a passcode for a given role ('operator' | 'admin'). */
    async verify(role, passcode) {
      const roleCfg = (cfg.roles || {})[role];
      if (!roleCfg || !passcode) return false;
      const hash = await sha256(passcode);
      const ok = hash === roleCfg.hash;
      if (ok) sessionStorage.setItem(SESSION_KEY, role);
      return ok;
    },

    lock() {
      sessionStorage.removeItem(SESSION_KEY);
    },
  };

  window.AccessPTTAuth = Auth;
})();
