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
    rtcViewers: {},             // unitId -> live WebRTC viewer handle
    blobUrls: {},               // unitId -> object URL for an uploaded MP4
    myStatus: 'online',         // this user's chosen presence
    peerStatus: 'offline',      // counterpart's presence
    presenceRef: null,          // firebase ref watching the counterpart
    zelloStatus: 'off',         // off|connecting|connected|reconnecting|error
    zelloError: null,           // last Zello error reason (for display)
    zelloRx: null,              // name of unit currently transmitting to us
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
    stopPresence();
    stopPolling();
    teardownMedia();
    teardownCameras();
    if (window.AccessPTTZello) window.AccessPTTZello.disconnect();
    state.zelloStatus = 'off'; state.zelloRx = null;
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
    hydrateUploadedCameras();
    selectUnit(state.units[0] && state.units[0].id);
    updateOnlineCount();
    updateZelloPill();
    setupZello();

    initTalkControls();
    initMessaging();
    initSettings();
    initPresence();
    initZelloTalk();
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
    startPresence();
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

  /* Render a single unit's camera into its surface. Precedence:
   * uploaded MP4 (blob) > manual stream URL > live WebRTC > simulated feed. */
  function mountFeed(unit, surface) {
    const url = state.blobUrls[unit.id] || (unit.camera && unit.camera.stream || '').trim();
    surface.innerHTML = '';

    if (!unit.online) {
      surface.innerHTML = simScrim() +
        '<div class="cam-offline"><span>SIGNAL LOST</span></div>';
      return;
    }

    // No manual URL: use the live WebRTC feed from the unit's device when
    // a backend is configured, otherwise fall back to the simulated feed.
    if (!url) {
      if (window.AccessPTTRTC && window.AccessPTTRTC.init()) {
        mountLiveFeed(unit, surface);
      } else {
        surface.innerHTML = simulatedFeed(unit) + simScrim();
      }
      return;
    }

    // Embeddable page (e.g. free YouTube Live) → render in a frame.
    const embed = embedUrl(url);
    if (embed) {
      const frame = document.createElement('iframe');
      frame.className = 'cam-feed cam-frame';
      frame.src = embed;
      frame.allow = 'autoplay; encrypted-media; picture-in-picture';
      frame.setAttribute('allowfullscreen', '');
      frame.setAttribute('frameborder', '0');
      surface.appendChild(frame);
      surface.insertAdjacentHTML('beforeend', simScrim());
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

  /* Subscribe to a unit device's live WebRTC stream. Shows a "waiting"
   * simulated feed until the unit goes live, then the real video. */
  function mountLiveFeed(unit, surface) {
    surface.innerHTML = simulatedFeed(unit) + simScrim() +
      '<div class="cam-badge" data-live-badge>no camera feed</div>';

    const video = document.createElement('video');
    video.className = 'cam-feed';
    video.autoplay = true;
    video.playsInline = true;
    video.muted = false;        // operator should hear the unit
    video.style.display = 'none';
    surface.insertBefore(video, surface.firstChild);
    surface.insertAdjacentHTML('beforeend', simScrim());

    const badge = surface.querySelector('[data-live-badge]');
    const viewer = window.AccessPTTRTC.view(unit.id, {
      onTrack(stream) {
        video.srcObject = stream;
        video.style.display = '';
        if (badge) badge.remove();
        video.play().catch(() => {});
      },
      onState(s) {
        if (s === 'unit-offline') {
          video.style.display = 'none';
          if (badge) { badge.style.display = ''; badge.textContent = 'no camera feed'; }
        } else if (s === 'unit-online' && badge) {
          badge.textContent = 'connecting…';
        }
      },
    });
    state.rtcViewers[unit.id] = viewer;
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
    Object.values(state.rtcViewers).forEach((v) => { try { v.stop(); } catch (_) {} });
    state.rtcViewers = {};
    Object.values(state.blobUrls).forEach((u) => { try { URL.revokeObjectURL(u); } catch (_) {} });
    state.blobUrls = {};
  }

  /* Tear down just one unit's live resources (for a targeted re-mount). */
  function teardownUnit(id) {
    if (state.hlsInstances[id]) { try { state.hlsInstances[id].destroy(); } catch (_) {} delete state.hlsInstances[id]; }
    if (state.rtcViewers[id]) { try { state.rtcViewers[id].stop(); } catch (_) {} delete state.rtcViewers[id]; }
  }
  function remountUnit(id) {
    const unit = state.units.find((u) => u.id === id);
    const tile = tileFor(id);
    const surface = tile && tile.querySelector('.cam-surface');
    if (unit && surface) { teardownUnit(id); mountFeed(unit, surface); }
  }

  /* Load any uploaded MP4s from IndexedDB and play them in their tiles. */
  async function hydrateUploadedCameras() {
    for (const unit of state.units) {
      try {
        const blob = await camStore.get(unit.id);
        if (blob) {
          if (state.blobUrls[unit.id]) URL.revokeObjectURL(state.blobUrls[unit.id]);
          state.blobUrls[unit.id] = URL.createObjectURL(blob);
          remountUnit(unit.id);
        }
      } catch (_) {}
    }
  }

  /* Tiny IndexedDB store for uploaded camera videos (persists across reloads). */
  const camStore = (function () {
    const DB = 'accessptt', STORE = 'cameraFiles';
    function open() {
      return new Promise((res, rej) => {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    function tx(mode, fn) {
      return open().then((db) => new Promise((res, rej) => {
        const t = db.transaction(STORE, mode);
        const rq = fn(t.objectStore(STORE));
        t.oncomplete = () => res(rq && rq.result);
        t.onerror = () => rej(t.error);
      }));
    }
    return {
      put(id, blob) { return tx('readwrite', (s) => s.put(blob, id)); },
      get(id) { return tx('readonly', (s) => s.get(id)); },
      del(id) { return tx('readwrite', (s) => s.delete(id)); },
    };
  })();

  function canPlayNativeHls(video) {
    return video.canPlayType('application/vnd.apple.mpegurl') !== '';
  }

  /* Returns an embeddable iframe URL for page-based feeds (YouTube Live,
   * or anything the operator explicitly marks with #embed), else null so
   * the feed is treated as a direct video stream. */
  function embedUrl(url) {
    const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|live\/|embed\/)|youtu\.be\/)([\w-]{6,})/i);
    if (yt) return `https://www.youtube.com/embed/${yt[1]}?autoplay=1&mute=1&playsinline=1`;
    if (/[?#]embed\b/i.test(url)) return url.replace(/[?#]embed\b/i, '');
    return null;
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

    // real Zello transmission when connected with credentials
    const Z = window.AccessPTTZello;
    if (Z && Z.canTransmit()) Z.startTalk();

    await startMic();
  }

  function stopTransmit() {
    if (!state.transmitting) return;
    state.transmitting = false;
    const Z = window.AccessPTTZello;
    if (Z) Z.stopTalk();
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
    if (fb.ready) {
      try { await fb.send(msg); }
      catch (_) { setBackend(false); localBus.post(msg); }
    } else {
      localBus.post(msg);   // same-device fallback (no backend configured)
    }
  }

  /* Start live message sync. Prefers Firebase Realtime Database (free tier);
   * falls back to a same-device BroadcastChannel when not configured. */
  function startPolling() {
    stopPolling();
    localBus.listen((m) => { if (m.thread === THREAD_ID) ingest([m]); });
    if (fb.init()) {
      setBackend(true);
      fb.subscribe(THREAD_ID, (m) => ingest([m]), () => setBackend(false));
    } else {
      setBackend(false);
    }
  }
  function stopPolling() {
    fb.unsubscribe();
    localBus.stop();
  }

  /* ----- Firebase Realtime Database adapter ----- */
  const fb = (function () {
    let app = null, db = null, ref = null, ready = false;
    return {
      get ready() { return ready; },
      init() {
        if (ready) return true;
        const c = cfg.firebase || {};
        if (!c.databaseURL || !window.firebase) return false;
        try {
          app = window.firebase.apps && window.firebase.apps.length
            ? window.firebase.app()
            : window.firebase.initializeApp(c);
          db = window.firebase.database(app);
          ready = true;
          return true;
        } catch (_) { ready = false; return false; }
      },
      subscribe(thread, onMsg, onErr) {
        if (!ready) return;
        ref = db.ref('threads/' + thread);
        // last 200 messages, then live updates
        ref.limitToLast(200).on('child_added',
          (snap) => { const v = snap.val(); if (v) onMsg(v); },
          (err) => { if (onErr) onErr(err); });
      },
      async send(msg) {
        if (!ready) throw new Error('firebase not ready');
        await db.ref('threads/' + msg.thread + '/' + msg.id).set(msg);
      },
      unsubscribe() { if (ref) { try { ref.off(); } catch (_) {} ref = null; } },

      /* presence: each person publishes their status at presence/<id> */
      setPresence(id, status, autoOffline) {
        if (!ready) return;
        const r = db.ref('presence/' + id);
        if (autoOffline) { try { r.onDisconnect().set('offline'); } catch (_) {} }
        r.set(status).catch(() => {});
      },
      watchPresence(id, cb) {
        if (!ready) return null;
        const r = db.ref('presence/' + id);
        r.on('value', (snap) => cb(snap.val() || 'offline'));
        return r;
      },
    };
  })();

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
    renderPeerStatus();
  }

  /* The message-window header shows the COUNTERPART's chosen presence
   * (Online / Busy / Offline), or a connection hint when the backend is down. */
  function renderPeerStatus() {
    const s = $('#msg-status');
    if (!s) return;
    s.classList.remove('busy', 'offline');
    if (!state.backendOk) { s.textContent = 'local only'; s.classList.add('offline'); return; }
    const st = state.peerStatus || 'offline';
    if (st === 'busy') { s.textContent = 'busy'; s.classList.add('busy'); }
    else if (st === 'online') { s.textContent = 'online'; }
    else { s.textContent = 'offline'; s.classList.add('offline'); }
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
   * PRESENCE (Online / Busy / Offline)
   * ===================================================== */
  function initPresence() {
    const sel = $('#presence-select');
    sel.addEventListener('change', () => {
      state.myStatus = sel.value;
      $('#presence-dot').dataset.status = sel.value;
      if (fb.ready) fb.setPresence(state.me.id, sel.value, sel.value !== 'offline');
    });
  }

  /* Publish my status and watch the counterpart's. Called per sign-in. */
  function startPresence() {
    stopPresence();
    state.myStatus = 'online';
    const sel = $('#presence-select');
    if (sel) sel.value = 'online';
    $('#presence-dot').dataset.status = 'online';

    if (!fb.ready) { state.peerStatus = 'offline'; renderPeerStatus(); return; }
    fb.setPresence(state.me.id, 'online', true);
    state.presenceRef = fb.watchPresence(state.other.id, (status) => {
      state.peerStatus = status;
      renderPeerStatus();
    });
  }
  function stopPresence() {
    if (state.presenceRef) { try { state.presenceRef.off(); } catch (_) {} state.presenceRef = null; }
    if (fb.ready && state.me) fb.setPresence(state.me.id, 'offline', false);
  }

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
      <div class="modal-field">
        <span>${escapeHtml(u.name)}</span>
        <input type="url" data-unit="${u.id}" placeholder="https://… .m3u8 / mjpeg / .mp4"
               value="${escapeAttr(u.camera.stream || '')}" />
        <div class="upload-row">
          <button type="button" class="up-btn" data-up="${u.id}">Upload MP4…</button>
          <input type="file" accept="video/*" data-file="${u.id}" hidden />
          <span class="up-status" data-upstatus="${u.id}"></span>
        </div>
      </div>`).join('');

    // wire upload buttons / inputs
    $$('#settings-fields .up-btn').forEach((btn) => {
      btn.addEventListener('click', () => $(`#settings-fields input[data-file="${btn.dataset.up}"]`).click());
    });
    $$('#settings-fields input[data-file]').forEach((inp) => {
      inp.addEventListener('change', () => {
        const file = inp.files && inp.files[0];
        if (file) handleUpload(inp.dataset.file, file);
        inp.value = '';
      });
    });
    state.units.forEach((u) => refreshUploadStatus(u.id));
    $('#settings-modal').hidden = false;
  }

  async function handleUpload(id, file) {
    try {
      await camStore.put(id, file);
      if (state.blobUrls[id]) URL.revokeObjectURL(state.blobUrls[id]);
      state.blobUrls[id] = URL.createObjectURL(file);
      remountUnit(id);
      refreshUploadStatus(id, file.name);
    } catch (_) { refreshUploadStatus(id, null, 'upload failed'); }
  }

  async function removeUpload(id) {
    try { await camStore.del(id); } catch (_) {}
    if (state.blobUrls[id]) { URL.revokeObjectURL(state.blobUrls[id]); delete state.blobUrls[id]; }
    remountUnit(id);
    refreshUploadStatus(id);
  }

  function refreshUploadStatus(id, name, err) {
    const el = document.querySelector(`[data-upstatus="${id}"]`);
    if (!el) return;
    el.innerHTML = '';
    if (err) { el.textContent = err; el.className = 'up-status err'; return; }
    if (state.blobUrls[id]) {
      el.className = 'up-status on';
      el.append(`✓ ${name || 'uploaded video'} · `);
      const rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'up-remove'; rm.textContent = 'Remove';
      rm.addEventListener('click', () => removeUpload(id));
      el.appendChild(rm);
    } else {
      el.className = 'up-status';
      el.textContent = '';
    }
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
    hydrateUploadedCameras();   // uploaded MP4s take precedence over URLs
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
  /* Connect to Zello (if configured) and reflect status in the pill. */
  function setupZello() {
    const Z = window.AccessPTTZello;
    if (!Z || !Z.available()) { updateZelloPill(); return; }
    // log in to Zello with the account for whoever signed in (operator/admin).
    // Password comes from this device's local store first (kept out of the repo),
    // falling back to any value in config.
    const accounts = (cfg.zello && cfg.zello.accounts) || {};
    const acctCfg = accounts[state.role] || {};
    const account = acctCfg.username
      ? { username: acctCfg.username, password: storedZelloPw(state.role) || acctCfg.password || '' }
      : null;
    Z.connect({
      onStatus: (s, extra) => {
        state.zelloStatus = s;
        if (s === 'error') { state.zelloError = extra || 'connection failed'; console.error('[Zello]', extra); }
        else if (s === 'connected') { state.zelloError = null; }
        updateZelloPill();
      },
      onIncoming: (name, active) => onZelloIncoming(name, active),
    }, account);
  }

  /* Per-device Zello password store (never committed / never leaves the device). */
  const ZPW_KEY = 'accessptt.zello.pw';
  function zelloPwMap() { try { return JSON.parse(localStorage.getItem(ZPW_KEY) || '{}'); } catch (_) { return {}; } }
  function storedZelloPw(role) { return zelloPwMap()[role] || ''; }
  function setStoredZelloPw(role, pw) {
    const m = zelloPwMap(); m[role] = pw;
    try { localStorage.setItem(ZPW_KEY, JSON.stringify(m)); } catch (_) {}
  }

  function initZelloTalk() {
    $('#zello-talk-btn').addEventListener('click', openZelloModal);
    $('#zello-close').addEventListener('click', () => { $('#zello-modal').hidden = true; });
    $('#zello-modal').addEventListener('click', (e) => { if (e.target === $('#zello-modal')) $('#zello-modal').hidden = true; });
    $('#zello-connect').addEventListener('click', submitZelloPw);
    $('#zello-pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitZelloPw(); });
  }
  function openZelloModal() {
    const accounts = (cfg.zello && cfg.zello.accounts) || {};
    const acct = accounts[state.role] || {};
    $('#zello-user').textContent = acct.username || 'your account';
    $('#zello-msg').hidden = true;
    $('#zello-pw').value = '';
    $('#zello-modal').hidden = false;
    setTimeout(() => $('#zello-pw').focus(), 80);
  }
  function submitZelloPw() {
    const pw = $('#zello-pw').value.trim();
    if (!pw) { return; }
    setStoredZelloPw(state.role, pw);
    $('#zello-pw').value = '';
    $('#zello-modal').hidden = true;
    // reconnect as the signed-in user with credentials
    if (window.AccessPTTZello) window.AccessPTTZello.disconnect();
    state.zelloStatus = 'connecting'; state.zelloRx = null;
    updateZelloPill();
    setupZello();
  }
  function updateZelloTalkBtn() {
    const btn = $('#zello-talk-btn');
    if (!btn) return;
    const Z = window.AccessPTTZello;
    const accounts = (cfg.zello && cfg.zello.accounts) || {};
    const acct = accounts[state.role] || {};
    const show = !!(Z && Z.available() && state.zelloStatus === 'connected' && acct.username && !Z.canTransmit());
    btn.hidden = !show;
  }

  /* A unit is transmitting on the channel → light its green ring + pill.
   * Match the Zello username to a unit by its `zello` field (or name). */
  function onZelloIncoming(name, active) {
    state.zelloRx = active ? name : null;
    updateZelloPill();
    const key = String(name || '').toLowerCase();
    const unit = state.units.find((u) =>
      (u.zello && u.zello.toLowerCase() === key) || u.name.toLowerCase() === key);
    if (unit) { const t = tileFor(unit.id); if (t) t.classList.toggle('speaking', active); }
  }

  function updateZelloPill() {
    const dot = $('#zello-dot');
    const text = $('#zello-text');
    const pill = $('#zello-pill');
    const Z = window.AccessPTTZello;

    if (!Z || !Z.available()) {
      dot.className = 'dot off';
      text.textContent = 'Voice: Zello app';
      pill.title = 'Zello not configured. Add a developer token + channel in config.js (SETUP.md §4) to connect this console to a Zello channel.';
      updateZelloTalkBtn();
      return;
    }
    if (state.zelloRx) {
      dot.className = 'dot live'; text.textContent = '▶ ' + state.zelloRx;
      pill.title = 'Receiving from ' + state.zelloRx; return;
    }
    switch (state.zelloStatus) {
      case 'connected':
        dot.className = 'dot live';
        text.textContent = Z.canTransmit() ? 'Zello: ready' : 'Zello: listening';
        pill.title = Z.canTransmit() ? 'Connected to Zello — push to talk to transmit.' : 'Connected to Zello (listen-only). Add a Zello username/password to transmit.';
        break;
      case 'connecting':
      case 'reconnecting':
        dot.className = 'dot'; text.textContent = 'Zello: connecting…'; pill.title = 'Connecting to Zello…'; break;
      case 'error':
        dot.className = 'dot off'; text.textContent = 'Zello: error'; pill.title = 'Could not connect to Zello. Check the token, channel, and credentials in config.js.'; break;
      default:
        dot.className = 'dot off'; text.textContent = 'Zello: offline'; pill.title = 'Zello disconnected.';
    }
    // surface the real Zello error reason so it's visible (not just console)
    const errEl = $('#zello-error');
    if (errEl) {
      if (state.zelloStatus === 'error' && state.zelloError) {
        errEl.textContent = 'Zello: ' + state.zelloError;
        errEl.hidden = false;
      } else { errEl.hidden = true; }
    }
    updateZelloTalkBtn();
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
