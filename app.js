/* =========================================================
 * AccessPTT — Operator / Admin Console
 * ---------------------------------------------------------
 * Role-based sign-in (Yitzy = operator, Hillel = admin),
 * unit camera wall with live stream playback, push-to-talk
 * with mic level + green speaking ring, and live operator⇄
 * admin messaging backed by Netlify Functions (with a local
 * fallback so the UI works offline).
 * ======================================================= */

(function () {
  'use strict';

  const cfg = window.ACCESSPTT_CONFIG || {};
  const Auth = window.AccessPTTAuth;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const CAM_KEY = 'accessptt.cameras';   // per-device camera URL overrides
  const THREAD_ID = 'yitzy-hillel';      // single operator⇄admin conversation

  const state = {
    role: null,                 // 'operator' | 'admin'
    me: null,                   // person object
    other: null,                // the counterpart person
    lockRole: 'operator',       // role tab currently selected on lock screen
    units: [],
    selectedUnitId: null,
    talkAll: false,
    transmitting: false,
    messages: [],
    lastMsgTs: 0,
    pollTimer: null,
    backendOk: true,
    hlsInstances: {},           // unitId -> Hls instance
    media: { stream: null, ctx: null, analyser: null, raf: null },
  };

  /* =======================================================
   * LOCK SCREEN
   * ===================================================== */
  function initLock() {
    const form = $('#lock-form');
    const input = $('#passcode');
    const error = $('#lock-error');
    const toggle = $('#toggle-pass');
    const unlockBtn = $('#unlock-btn');

    $$('.role-tab').forEach((tab) => {
      tab.addEventListener('click', () => setLockRole(tab.dataset.role));
    });

    toggle.addEventListener('click', () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      toggle.classList.toggle('active', !showing);
      input.focus();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.hidden = true;
      unlockBtn.disabled = true;
      unlockBtn.textContent = 'Verifying…';

      const ok = await Auth.verify(state.lockRole, input.value);
      if (ok) {
        input.value = '';
        enter(state.lockRole);
      } else {
        error.hidden = false;
        $('#lock-screen').classList.add('shake');
        setTimeout(() => $('#lock-screen').classList.remove('shake'), 500);
        input.select();
      }
      unlockBtn.disabled = false;
      unlockBtn.textContent = 'Unlock Console';
    });

    setTimeout(() => input.focus(), 100);
  }

  function setLockRole(role) {
    state.lockRole = role;
    $$('.role-tab').forEach((t) => t.classList.toggle('active', t.dataset.role === role));
    const isAdmin = role === 'admin';
    $('#lock-mode-sub').textContent = isAdmin ? 'Admin Console' : 'Operator Console';
    $('#lock-label').textContent = isAdmin ? 'Admin Passcode' : 'Operator Passcode';
    $('#lock-error').hidden = true;
    $('#passcode').focus();
  }

  function showLock() {
    Auth.lock();
    stopPolling();
    teardownMedia();
    teardownCameras();
    state.role = null;
    $('#dashboard').hidden = true;
    $('#lock-screen').style.display = '';
    setTimeout(() => $('#passcode').focus(), 100);
  }

  /* =======================================================
   * ENTER DASHBOARD (role-aware)
   * ===================================================== */
  function enter(role) {
    state.role = role;
    const people = cfg.people || {};
    state.me = role === 'admin' ? people.admin : people.operator;
    state.other = role === 'admin' ? people.operator : people.admin;

    $('#lock-screen').style.display = 'none';
    $('#dashboard').hidden = false;

    initDashboardOnce();
    applyRole();
  }

  let dashboardReady = false;
  function initDashboardOnce() {
    if (dashboardReady) return;
    dashboardReady = true;

    state.units = (cfg.units || []).map((u) => ({ ...u, camera: { ...u.camera } }));
    applyCameraOverrides();

    renderCameras();
    selectUnit(state.units[0] && state.units[0].id);
    updateOnlineCount();
    updateZelloPill();

    initTalkControls();
    initMessaging();
    initSettings();
    startClock();

    $('#lock-btn').addEventListener('click', showLock);
  }

  function applyRole() {
    const me = state.me;
    $('#me-name').textContent = `${me.name} · ${me.role}`;
    $('#me-device').textContent = me.device || '';
    $('#me-avatar').textContent = initials(me.name);

    // messaging window is the conversation with the counterpart person
    $('#msg-name').textContent = state.other.name;
    $('#msg-avatar').textContent = initials(state.other.name);

    // (re)start live message sync for this session
    state.messages = [];
    state.lastMsgTs = 0;
    renderMessages();
    startPolling();
  }

  /* =======================================================
   * CAMERA GRID + LIVE PLAYBACK
   * ===================================================== */
  function renderCameras() {
    const grid = $('#camera-grid');
    grid.innerHTML = '';
    teardownCameras();

    state.units.forEach((unit) => {
      const tile = document.createElement('div');
      tile.className = 'camera-tile' + (unit.online ? '' : ' offline');
      tile.dataset.unitId = unit.id;
      tile.setAttribute('role', 'button');
      tile.setAttribute('tabindex', '0');
      tile.setAttribute('aria-label', 'Unit ' + unit.name);

      tile.innerHTML = `
        <span class="speak-ring" aria-hidden="true"></span>
        <div class="cam-surface"></div>
        <div class="cam-topline">
          <span class="cam-rec"><i></i>LIVE</span>
          <span class="cam-speaking">SPEAKING</span>
        </div>
        <div class="cam-name">
          <span class="cam-online-dot ${unit.online ? 'on' : 'off'}"></span>
          <span class="cam-name-text">${escapeHtml(unit.name)}</span>
        </div>`;

      tile.addEventListener('click', () => selectUnit(unit.id));
      tile.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectUnit(unit.id); }
      });
      grid.appendChild(tile);

      mountFeed(unit, tile.querySelector('.cam-surface'));
    });
  }

  /* Render a single unit's camera into its surface: real stream when a
   * URL is set, otherwise the simulated placeholder feed. */
  function mountFeed(unit, surface) {
    const url = (unit.camera && unit.camera.stream || '').trim();
    surface.innerHTML = '';

    if (!unit.online) {
      surface.innerHTML = simScrim() +
        '<div class="cam-offline"><span>SIGNAL LOST</span></div>';
      return;
    }

    if (!url) {
      surface.innerHTML = simulatedFeed(unit) + simScrim();
      return;
    }

    const video = document.createElement('video');
    video.className = 'cam-feed';
    video.muted = true;        // operator audio comes via Zello, not the camera
    video.autoplay = true;
    video.playsInline = true;
    video.loop = true;
    surface.appendChild(video);
    surface.insertAdjacentHTML('beforeend', simScrim());

    const isHls = /\.m3u8(\?|$)/i.test(url);
    const onError = () => fallbackToSim(unit, surface);

    if (isHls && !canPlayNativeHls(video) && window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({ lowLatencyMode: true });
      hls.on(window.Hls.Events.ERROR, (_e, data) => { if (data && data.fatal) onError(); });
      hls.loadSource(url);
      hls.attachMedia(video);
      state.hlsInstances[unit.id] = hls;
    } else {
      video.src = url;          // native HLS (Safari/iPad), MP4, WebM, MJPEG
      video.addEventListener('error', onError);
    }
    video.play().catch(() => {/* autoplay may defer until interaction */});
  }

  function fallbackToSim(unit, surface) {
    if (state.hlsInstances[unit.id]) {
      try { state.hlsInstances[unit.id].destroy(); } catch (_) {}
      delete state.hlsInstances[unit.id];
    }
    surface.innerHTML = simulatedFeed(unit) + simScrim() +
      '<div class="cam-badge">no signal · simulated</div>';
  }

  function teardownCameras() {
    Object.values(state.hlsInstances).forEach((h) => { try { h.destroy(); } catch (_) {} });
    state.hlsInstances = {};
  }

  function canPlayNativeHls(video) {
    return video.canPlayType('application/vnd.apple.mpegurl') !== '';
  }

  function simScrim() { return '<div class="cam-scrim"></div>'; }
  function simulatedFeed(unit) {
    const seed = hashSeed(unit.id);
    return `<div class="cam-feed sim" style="--seed:${seed}">
              <div class="sim-grid"></div>
              <div class="sim-noise"></div>
              <div class="sim-scan"></div>
            </div>`;
  }

  function tileFor(unitId) {
    return document.querySelector(`.camera-tile[data-unit-id="${unitId}"]`);
  }

  /* ----- selection ----- */
  function selectUnit(unitId) {
    if (!unitId) return;
    state.selectedUnitId = unitId;
    $$('.camera-tile').forEach((t) => t.classList.toggle('selected', t.dataset.unitId === unitId));
    updateTargetLine();
  }
  function selectedUnit() {
    return state.units.find((u) => u.id === state.selectedUnitId) || null;
  }
  function updateTargetLine() {
    const el = $('#target-value');
    if (state.talkAll) { el.textContent = 'ALL UNITS'; el.classList.add('all'); }
    else {
      const u = selectedUnit();
      el.textContent = u ? u.name : 'Select a unit';
      el.classList.remove('all');
    }
  }
  function updateOnlineCount() {
    $('#online-count').textContent = state.units.filter((u) => u.online).length;
  }

  /* =======================================================
   * PUSH-TO-TALK
   * ===================================================== */
  function initTalkControls() {
    const pttBtn = $('#ptt-btn');
    const talkAll = $('#talk-all');

    talkAll.addEventListener('change', () => {
      state.talkAll = talkAll.checked;
      updateTargetLine();
    });

    const start = (e) => { e.preventDefault(); startTransmit(); };
    const end = (e) => { e.preventDefault(); stopTransmit(); };

    pttBtn.addEventListener('mousedown', start);
    pttBtn.addEventListener('touchstart', start, { passive: false });
    window.addEventListener('mouseup', () => { if (state.transmitting) stopTransmit(); });
    pttBtn.addEventListener('touchend', end);
    pttBtn.addEventListener('touchcancel', end);

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.repeat && !isTyping(e.target)) { e.preventDefault(); startTransmit(); }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space' && state.transmitting && !isTyping(e.target)) { e.preventDefault(); stopTransmit(); }
    });
  }

  function targetUnits() {
    if (state.talkAll) return state.units.filter((u) => u.online);
    const u = selectedUnit();
    return u && u.online ? [u] : [];
  }

  async function startTransmit() {
    if (state.transmitting) return;
    const targets = targetUnits();
    if (targets.length === 0) { flashSub(state.talkAll ? 'No units online' : 'Select an online unit'); return; }
    state.transmitting = true;

    const btn = $('#ptt-btn');
    btn.classList.add('transmitting');
    btn.setAttribute('aria-pressed', 'true');
    $('.ptt-label').textContent = 'ON AIR';
    $('#ptt-sub').textContent = state.talkAll
      ? `Transmitting to ${targets.length} units`
      : `Transmitting to ${targets[0].name}`;

    targets.forEach((u) => { const t = tileFor(u.id); if (t) t.classList.add('speaking'); });
    await startMic();
  }

  function stopTransmit() {
    if (!state.transmitting) return;
    state.transmitting = false;
    const btn = $('#ptt-btn');
    btn.classList.remove('transmitting');
    btn.setAttribute('aria-pressed', 'false');
    $('.ptt-label').textContent = 'HOLD TO TALK';
    $('#ptt-sub').textContent = 'Press & hold · or Space';
    $$('.camera-tile.speaking').forEach((t) => t.classList.remove('speaking'));
    stopMicMeter();
  }

  function flashSub(msg) {
    const sub = $('#ptt-sub');
    const prev = 'Press & hold · or Space';
    sub.textContent = msg; sub.classList.add('warn');
    setTimeout(() => { sub.textContent = prev; sub.classList.remove('warn'); }, 1400);
  }

  /* ----- mic capture + level meter ----- */
  async function startMic() {
    try {
      if (!state.media.stream) state.media.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!state.media.ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        state.media.ctx = new Ctx();
        const src = state.media.ctx.createMediaStreamSource(state.media.stream);
        state.media.analyser = state.media.ctx.createAnalyser();
        state.media.analyser.fftSize = 256;
        src.connect(state.media.analyser);
      }
      if (state.media.ctx.state === 'suspended') await state.media.ctx.resume();
      runMeter();
    } catch (_) {
      runSyntheticMeter();
    }
  }
  function runMeter() {
    const analyser = state.media.analyser;
    const bars = $$('#level-meter span');
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (!state.transmitting) return;
      analyser.getByteFrequencyData(data);
      const step = Math.floor(data.length / bars.length);
      bars.forEach((bar, i) => {
        const v = data[i * step] / 255;
        bar.style.transform = `scaleY(${Math.max(0.08, v)})`;
        bar.style.opacity = 0.35 + v * 0.65;
      });
      state.media.raf = requestAnimationFrame(tick);
    };
    tick();
  }
  function runSyntheticMeter() {
    const bars = $$('#level-meter span');
    const tick = () => {
      if (!state.transmitting) return;
      bars.forEach((bar) => {
        const v = Math.random() * 0.7 + 0.1;
        bar.style.transform = `scaleY(${v})`;
        bar.style.opacity = 0.35 + v * 0.65;
      });
      state.media.raf = requestAnimationFrame(() => setTimeout(tick, 70));
    };
    tick();
  }
  function stopMicMeter() {
    if (state.media.raf) cancelAnimationFrame(state.media.raf);
    state.media.raf = null;
    $$('#level-meter span').forEach((bar) => { bar.style.transform = 'scaleY(0.08)'; bar.style.opacity = 0.3; });
  }
  function teardownMedia() {
    stopMicMeter();
    if (state.media.stream) { state.media.stream.getTracks().forEach((t) => t.stop()); state.media.stream = null; }
    if (state.media.ctx) { state.media.ctx.close().catch(() => {}); state.media.ctx = null; state.media.analyser = null; }
  }

  /* =======================================================
   * MESSAGING (operator ⇄ admin, live via backend)
   * ===================================================== */
  function initMessaging() {
    const form = $('#msg-form');
    const input = $('#msg-text');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      await sendMessage(text);
    });
  }

  async function sendMessage(text) {
    const msg = { id: rid(), thread: THREAD_ID, from: state.me.id, fromName: state.me.name, text, ts: Date.now() };
    // optimistic local render
    ingest([msg]);
    const ep = (cfg.messaging && cfg.messaging.endpoint) || '';
    if (ep && state.backendOk) {
      try {
        const r = await fetch(ep, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(msg),
        });
        if (!r.ok) throw new Error('bad status ' + r.status);
      } catch (_) {
        setBackend(false);
        localBus.post(msg);   // same-device fallback
      }
    } else {
      localBus.post(msg);
    }
  }

  function startPolling() {
    stopPolling();
    const ep = (cfg.messaging && cfg.messaging.endpoint) || '';
    const ms = (cfg.messaging && cfg.messaging.pollMs) || 2500;
    localBus.listen((m) => { if (m.thread === THREAD_ID) ingest([m]); });
    if (!ep) { setBackend(false); return; }

    const poll = async () => {
      try {
        const r = await fetch(`${ep}?thread=${encodeURIComponent(THREAD_ID)}&since=${state.lastMsgTs}`);
        if (!r.ok) throw new Error('bad status ' + r.status);
        const data = await r.json();
        if (Array.isArray(data.messages)) ingest(data.messages);
        setBackend(true);
      } catch (_) {
        setBackend(false);
      }
    };
    poll();
    state.pollTimer = setInterval(poll, ms);
  }
  function stopPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
    localBus.stop();
  }

  function ingest(msgs) {
    let added = false;
    msgs.forEach((m) => {
      if (!m || !m.id) return;
      if (state.messages.some((x) => x.id === m.id)) return;
      state.messages.push(m);
      if (m.ts > state.lastMsgTs) state.lastMsgTs = m.ts;
      added = true;
    });
    if (added) {
      state.messages.sort((a, b) => a.ts - b.ts);
      renderMessages();
    }
  }

  function renderMessages() {
    const body = $('#msg-body');
    if (!state.me) return;
    if (state.messages.length === 0) {
      body.innerHTML = `<div class="msg-empty">No messages yet. Say hello to ${escapeHtml(state.other.name)}.</div>`;
      return;
    }
    body.innerHTML = state.messages.map((m) => `
      <div class="bubble ${m.from === state.me.id ? 'out' : 'in'}">
        <span class="bubble-text">${escapeHtml(m.text)}</span>
        <span class="bubble-time">${fmtTime(m.ts)}</span>
      </div>`).join('');
    body.scrollTop = body.scrollHeight;
  }

  function setBackend(ok) {
    state.backendOk = ok;
    const s = $('#msg-status');
    if (ok) { s.textContent = 'online'; s.classList.remove('offline'); }
    else { s.textContent = 'local only'; s.classList.add('offline'); }
  }

  /* Same-device message bus (fallback when the backend is unreachable,
   * e.g. local dev). Uses BroadcastChannel across tabs on one device. */
  const localBus = (function () {
    let ch = null, handler = null;
    return {
      listen(fn) {
        handler = fn;
        try { ch = new BroadcastChannel('accessptt-msg'); ch.onmessage = (e) => handler && handler(e.data); }
        catch (_) { ch = null; }
      },
      post(msg) { try { ch && ch.postMessage(msg); } catch (_) {} },
      stop() { try { ch && ch.close(); } catch (_) {} ch = null; handler = null; },
    };
  })();

  /* =======================================================
   * CAMERA SETTINGS MODAL
   * ===================================================== */
  function initSettings() {
    const modal = $('#settings-modal');
    $('#settings-btn').addEventListener('click', openSettings);
    $('#settings-close').addEventListener('click', () => { modal.hidden = true; });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
    $('#settings-save').addEventListener('click', saveSettings);
  }

  function openSettings() {
    const wrap = $('#settings-fields');
    wrap.innerHTML = state.units.map((u) => `
      <label class="modal-field">
        <span>${escapeHtml(u.name)}</span>
        <input type="url" data-unit="${u.id}" placeholder="https://… .m3u8 / mjpeg / .mp4"
               value="${escapeAttr(u.camera.stream || '')}" />
      </label>`).join('');
    $('#settings-modal').hidden = false;
  }

  function saveSettings() {
    const overrides = {};
    $$('#settings-fields input[data-unit]').forEach((inp) => {
      const url = inp.value.trim();
      overrides[inp.dataset.unit] = url;
      const unit = state.units.find((u) => u.id === inp.dataset.unit);
      if (unit) unit.camera.stream = url;
    });
    try { localStorage.setItem(CAM_KEY, JSON.stringify(overrides)); } catch (_) {}
    renderCameras();
    selectUnit(state.selectedUnitId);
    $('#settings-modal').hidden = true;
  }

  function applyCameraOverrides() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(CAM_KEY) || '{}'); } catch (_) {}
    state.units.forEach((u) => {
      if (Object.prototype.hasOwnProperty.call(saved, u.id)) u.camera.stream = saved[u.id];
    });
  }

  /* =======================================================
   * ZELLO STATUS PILL
   * ===================================================== */
  function updateZelloPill() {
    const z = cfg.zello || {};
    const dot = $('#zello-dot');
    const text = $('#zello-text');
    if (z.enabled && z.network) { dot.className = 'dot live'; text.textContent = 'Radios linked'; }
    else { dot.className = 'dot off'; text.textContent = 'Radios: app only'; $('#zello-pill').title = 'Consumer Zello has no browser API — audio runs in the Zello app. Add Zello Work + API key to link radios here.'; }
  }

  /* =======================================================
   * MISC HELPERS
   * ===================================================== */
  function startClock() {
    const el = $('#clock');
    const tick = () => { el.textContent = new Date().toLocaleTimeString([], { hour12: false }); };
    tick(); setInterval(tick, 1000);
  }
  function initials(name) { return name.trim().split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase(); }
  function isTyping(el) { return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable); }
  function fmtTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  function rid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function hashSeed(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360; return h; }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  /* =======================================================
   * BOOT
   * ===================================================== */
  document.addEventListener('DOMContentLoaded', () => {
    initLock();
    const role = Auth.currentRole();
    if (role) enter(role);
  });
})();
