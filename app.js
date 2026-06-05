/* =========================================================
 * AccessPTT — Operator Console
 * ---------------------------------------------------------
 * Lock flow, unit camera grid, push-to-talk transmission
 * (with live mic level), speaking indicator (green ring),
 * and the per-unit messaging window.
 * ======================================================= */

(function () {
  'use strict';

  const cfg = window.ACCESSPTT_CONFIG || {};
  const Auth = window.AccessPTTAuth;

  /* ----- element refs ----- */
  const $ = (sel) => document.querySelector(sel);
  const lockScreen = $('#lock-screen');
  const dashboard = $('#dashboard');

  /* ----- runtime state ----- */
  const state = {
    units: (cfg.units || []).map((u) => ({ ...u })),
    selectedUnitId: null,      // unit targeted for messaging + single talk
    talkAll: false,
    transmitting: false,
    messages: {},              // unitId -> [{from, text, ts}]
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

      const ok = await Auth.verify(input.value);
      if (ok) {
        input.value = '';
        showDashboard();
      } else {
        error.hidden = false;
        lockScreen.classList.add('shake');
        setTimeout(() => lockScreen.classList.remove('shake'), 500);
        input.select();
      }
      unlockBtn.disabled = false;
      unlockBtn.textContent = 'Unlock Console';
    });

    setTimeout(() => input.focus(), 100);
  }

  function showLock() {
    Auth.lock();
    teardownMedia();
    dashboard.hidden = true;
    lockScreen.classList.remove('hidden-screen');
    lockScreen.style.display = '';
    setTimeout(() => $('#passcode').focus(), 100);
  }

  function showDashboard() {
    lockScreen.style.display = 'none';
    dashboard.hidden = false;
    initDashboardOnce();
  }

  /* =======================================================
   * DASHBOARD
   * ===================================================== */
  let dashboardReady = false;
  function initDashboardOnce() {
    if (dashboardReady) return;
    dashboardReady = true;

    // operator identity
    if (cfg.operator) {
      $('.op-name').textContent = cfg.operator.name || 'Operator';
      $('.op-device').textContent = cfg.operator.device || '';
      $('.op-avatar').textContent = initials(cfg.operator.name || 'OP');
    }

    renderCameras();
    selectUnit(cfg.defaultMessageUnit || (state.units[0] && state.units[0].id));
    updateOnlineCount();

    initTalkControls();
    initMessaging();
    startClock();

    $('#lock-btn').addEventListener('click', showLock);
  }

  /* ----- camera grid ----- */
  function renderCameras() {
    const grid = $('#camera-grid');
    grid.innerHTML = '';

    state.units.forEach((unit) => {
      const tile = document.createElement('div');
      tile.className = 'camera-tile' + (unit.online ? '' : ' offline');
      tile.dataset.unitId = unit.id;
      tile.setAttribute('role', 'button');
      tile.setAttribute('tabindex', '0');
      tile.setAttribute('aria-label', 'Unit ' + unit.name);

      const feed = unit.camera && unit.camera.stream
        ? `<video class="cam-feed" muted autoplay playsinline loop src="${escapeAttr(unit.camera.stream)}"></video>`
        : simulatedFeed(unit);

      tile.innerHTML = `
        <span class="speak-ring" aria-hidden="true"></span>
        <div class="cam-surface">
          ${feed}
          <div class="cam-scrim"></div>
          ${unit.online ? '' : '<div class="cam-offline"><span>SIGNAL LOST</span></div>'}
        </div>
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
    });
  }

  function simulatedFeed(unit) {
    // A lightweight animated stand-in for the unit's mini WiFi camera.
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
    document.querySelectorAll('.camera-tile').forEach((t) => {
      t.classList.toggle('selected', t.dataset.unitId === unitId);
    });
    updateTargetLine();
    bindMessageWindow(unitId);
  }

  function selectedUnit() {
    return state.units.find((u) => u.id === state.selectedUnitId) || null;
  }

  function updateTargetLine() {
    const el = $('#target-value');
    if (state.talkAll) {
      el.textContent = 'ALL UNITS';
      el.classList.add('all');
    } else {
      const u = selectedUnit();
      el.textContent = u ? u.name : 'Select a unit';
      el.classList.remove('all');
    }
  }

  function updateOnlineCount() {
    const n = state.units.filter((u) => u.online).length;
    $('#online-count').textContent = n;
  }

  /* =======================================================
   * TALK CONTROLS (Push-to-Talk)
   * ===================================================== */
  function initTalkControls() {
    const pttBtn = $('#ptt-btn');
    const talkAll = $('#talk-all');

    talkAll.addEventListener('change', () => {
      state.talkAll = talkAll.checked;
      updateTargetLine();
    });

    // Press & hold (mouse + touch)
    const start = (e) => { e.preventDefault(); startTransmit(); };
    const end = (e) => { e.preventDefault(); stopTransmit(); };

    pttBtn.addEventListener('mousedown', start);
    pttBtn.addEventListener('touchstart', start, { passive: false });
    window.addEventListener('mouseup', () => { if (state.transmitting) stopTransmit(); });
    pttBtn.addEventListener('touchend', end);
    pttBtn.addEventListener('touchcancel', end);

    // Spacebar = hold to talk (operator headset workflow)
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.repeat && !isTyping(e.target)) {
        e.preventDefault();
        startTransmit();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space' && state.transmitting && !isTyping(e.target)) {
        e.preventDefault();
        stopTransmit();
      }
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
    if (targets.length === 0) {
      flashSub(state.talkAll ? 'No units online' : 'Select an online unit');
      return;
    }
    state.transmitting = true;

    const btn = $('#ptt-btn');
    btn.classList.add('transmitting');
    btn.setAttribute('aria-pressed', 'true');
    $('.ptt-label').textContent = 'ON AIR';
    $('#ptt-sub').textContent = state.talkAll
      ? `Transmitting to ${targets.length} units`
      : `Transmitting to ${targets[0].name}`;

    // glowing green ring around target unit(s)
    targets.forEach((u) => {
      const tile = tileFor(u.id);
      if (tile) tile.classList.add('speaking');
    });

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

    document.querySelectorAll('.camera-tile.speaking')
      .forEach((t) => t.classList.remove('speaking'));

    stopMicMeter();
  }

  function flashSub(msg) {
    const sub = $('#ptt-sub');
    const prev = sub.textContent;
    sub.textContent = msg;
    sub.classList.add('warn');
    setTimeout(() => { sub.textContent = prev; sub.classList.remove('warn'); }, 1400);
  }

  /* ----- microphone capture + level meter ----- */
  async function startMic() {
    try {
      if (!state.media.stream) {
        state.media.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
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
    } catch (err) {
      // Mic permission denied / unavailable — keep the visual transmit state,
      // just animate a synthetic meter so the operator still gets feedback.
      runSyntheticMeter();
    }
  }

  function runMeter() {
    const analyser = state.media.analyser;
    const bars = document.querySelectorAll('#level-meter span');
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (!state.transmitting) return;
      analyser.getByteFrequencyData(data);
      paintMeter(bars, data);
      state.media.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  function paintMeter(bars, data) {
    const step = Math.floor(data.length / bars.length);
    bars.forEach((bar, i) => {
      const v = data[i * step] / 255;
      bar.style.transform = `scaleY(${Math.max(0.08, v)})`;
      bar.style.opacity = 0.35 + v * 0.65;
    });
  }

  function runSyntheticMeter() {
    const bars = document.querySelectorAll('#level-meter span');
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
    document.querySelectorAll('#level-meter span').forEach((bar) => {
      bar.style.transform = 'scaleY(0.08)';
      bar.style.opacity = 0.3;
    });
  }

  function teardownMedia() {
    stopMicMeter();
    if (state.media.stream) {
      state.media.stream.getTracks().forEach((t) => t.stop());
      state.media.stream = null;
    }
    if (state.media.ctx) {
      state.media.ctx.close().catch(() => {});
      state.media.ctx = null;
      state.media.analyser = null;
    }
  }

  /* =======================================================
   * MESSAGING WINDOW (per unit, default "Hillel")
   * ===================================================== */
  function initMessaging() {
    const form = $('#msg-form');
    const input = $('#msg-text');

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || !state.selectedUnitId) return;
      addMessage(state.selectedUnitId, { from: 'operator', text, ts: Date.now() });
      input.value = '';
      input.focus();
      // simulated acknowledgement / reply from the unit
      simulateReply(state.selectedUnitId);
    });
  }

  function bindMessageWindow(unitId) {
    const unit = state.units.find((u) => u.id === unitId);
    if (!unit) return;
    $('#msg-name').textContent = unit.name;
    $('#msg-avatar').textContent = initials(unit.name);
    $('#msg-status').textContent = unit.online ? 'online' : 'offline';
    $('#msg-status').classList.toggle('offline', !unit.online);
    renderMessages(unitId);
  }

  function addMessage(unitId, msg) {
    if (!state.messages[unitId]) state.messages[unitId] = [];
    state.messages[unitId].push(msg);
    if (unitId === state.selectedUnitId) renderMessages(unitId);
  }

  function renderMessages(unitId) {
    const body = $('#msg-body');
    const msgs = state.messages[unitId] || [];
    if (msgs.length === 0) {
      body.innerHTML = `<div class="msg-empty">No messages yet. Send a note to ${escapeHtml(nameOf(unitId))}.</div>`;
      return;
    }
    body.innerHTML = msgs.map((m) => `
      <div class="bubble ${m.from === 'operator' ? 'out' : 'in'}">
        <span class="bubble-text">${escapeHtml(m.text)}</span>
        <span class="bubble-time">${fmtTime(m.ts)}</span>
      </div>`).join('');
    body.scrollTop = body.scrollHeight;
  }

  const replyLines = [
    'Copy that.', 'Roger.', 'On my way.', 'Understood, standing by.',
    'In position.', 'All clear here.', 'Affirmative.', 'Received, over.',
  ];
  function simulateReply(unitId) {
    const unit = state.units.find((u) => u.id === unitId);
    if (!unit || !unit.online) return;
    setTimeout(() => {
      const text = replyLines[Math.floor(Math.random() * replyLines.length)];
      addMessage(unitId, { from: 'unit', text, ts: Date.now() });
    }, 800 + Math.random() * 1400);
  }

  /* =======================================================
   * MISC
   * ===================================================== */
  function startClock() {
    const el = $('#clock');
    const tick = () => {
      el.textContent = new Date().toLocaleTimeString([], { hour12: false });
    };
    tick();
    setInterval(tick, 1000);
  }

  /* ----- helpers ----- */
  function nameOf(unitId) {
    const u = state.units.find((x) => x.id === unitId);
    return u ? u.name : 'unit';
  }
  function initials(name) {
    return name.trim().split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  }
  function isTyping(el) {
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }
  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  function hashSeed(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
    return h;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  /* =======================================================
   * BOOT
   * ===================================================== */
  document.addEventListener('DOMContentLoaded', () => {
    initLock();
    if (Auth.isUnlocked()) showDashboard();
  });
})();
