/* =========================================================
 * AccessPTT — Live camera transport (WebRTC + Firebase)
 * ---------------------------------------------------------
 * A field "unit" device publishes its camera + mic; the
 * operator / admin dashboard subscribes and shows the live
 * feed. Signaling (the connection handshake) rides on the
 * Firebase Realtime Database that already powers messaging,
 * so there is no extra server and no monthly cost.
 *
 *   Unit (publisher):  AccessPTTRTC.publish(unitId, stream)
 *   Dashboard (viewer): AccessPTTRTC.view(unitId, { onTrack, onState })
 *
 * One publisher serves multiple viewers (operator + admin) via
 * a separate peer connection per viewer (small mesh).
 * ======================================================= */

(function () {
  'use strict';

  /* Free STUN + public free TURN relay. TURN matters because mobile
   * carriers (4G/CGNAT) often block direct peer connections; the free
   * Open Relay TURN gives a fallback path. It's a community service with
   * no uptime guarantee — swap in your own TURN later for production. */
  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ];

  let db = null;

  function init() {
    if (db) return db;
    const c = (window.ACCESSPTT_CONFIG || {}).firebase || {};
    if (!c.databaseURL || !window.firebase) return null;
    try {
      const app = window.firebase.apps && window.firebase.apps.length
        ? window.firebase.app()
        : window.firebase.initializeApp(c);
      db = window.firebase.database(app);
      return db;
    } catch (_) { return null; }
  }

  function rid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function newPC() { return new RTCPeerConnection({ iceServers: ICE_SERVERS }); }

  /* =======================================================
   * PUBLISHER (the field unit device)
   * ===================================================== */
  function publish(unitId, stream, opts) {
    opts = opts || {};
    const database = init();
    if (!database) { if (opts.onState) opts.onState('no-backend'); return { stop() {} }; }

    const room = database.ref('rooms/' + unitId);
    const viewersRef = room.child('viewers');
    const peers = {};   // viewerId -> { pc, candRef }

    // mark this unit live, and auto-clear if it disconnects
    room.child('online').onDisconnect().set(false);
    room.child('online').set(true);
    if (opts.onState) opts.onState('online');

    // a fresh publishing session clears any stale viewer offers
    viewersRef.remove();

    const onViewer = (snap) => {
      const viewerId = snap.key;
      const data = snap.val() || {};
      if (!data.offer || peers[viewerId]) return;

      const pc = newPC();
      const vref = viewersRef.child(viewerId);
      peers[viewerId] = { pc };

      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      pc.onicecandidate = (e) => {
        if (e.candidate) vref.child('unitCandidates').push(e.candidate.toJSON());
      };
      pc.onconnectionstatechange = () => {
        if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
          cleanupPeer(viewerId);
        }
      };

      pc.setRemoteDescription(new RTCSessionDescription(data.offer))
        .then(() => pc.createAnswer())
        .then((ans) => pc.setLocalDescription(ans))
        .then(() => vref.child('answer').set({ type: pc.localDescription.type, sdp: pc.localDescription.sdp }))
        .catch(() => cleanupPeer(viewerId));

      // remote ICE from this viewer
      const candRef = vref.child('viewerCandidates');
      const onCand = (cs) => { const c = cs.val(); if (c) pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}); };
      candRef.on('child_added', onCand);
      peers[viewerId].candRef = candRef;
    };

    function cleanupPeer(viewerId) {
      const p = peers[viewerId];
      if (!p) return;
      try { p.pc.close(); } catch (_) {}
      if (p.candRef) p.candRef.off();
      delete peers[viewerId];
      viewersRef.child(viewerId).remove().catch(() => {});
    }

    viewersRef.on('child_added', onViewer);

    return {
      stop() {
        viewersRef.off('child_added', onViewer);
        Object.keys(peers).forEach(cleanupPeer);
        room.child('online').set(false);
        viewersRef.remove().catch(() => {});
      },
    };
  }

  /* =======================================================
   * VIEWER (operator / admin dashboard tile)
   * ===================================================== */
  function view(unitId, opts) {
    opts = opts || {};
    const database = init();
    if (!database) { if (opts.onState) opts.onState('no-backend'); return { stop() {} }; }

    const room = database.ref('rooms/' + unitId);
    const viewerId = rid();
    const vref = room.child('viewers/' + viewerId);

    let pc = null;
    let onlineRef = room.child('online');
    let started = false;
    let stopped = false;

    const onlineHandler = (snap) => {
      const live = snap.val() === true;
      if (opts.onState) opts.onState(live ? 'unit-online' : 'unit-offline');
      if (live && !started && !stopped) start();
      if (!live && started) teardownPeer();
    };
    onlineRef.on('value', onlineHandler);

    function start() {
      started = true;
      pc = newPC();

      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });

      pc.ontrack = (e) => { if (opts.onTrack) opts.onTrack(e.streams[0]); };
      pc.onicecandidate = (e) => {
        if (e.candidate) vref.child('viewerCandidates').push(e.candidate.toJSON());
      };
      pc.onconnectionstatechange = () => {
        if (opts.onState) opts.onState('pc-' + pc.connectionState);
      };

      pc.createOffer()
        .then((off) => pc.setLocalDescription(off))
        .then(() => vref.child('offer').set({ type: pc.localDescription.type, sdp: pc.localDescription.sdp }))
        .catch(() => { if (opts.onState) opts.onState('error'); });

      // unit's answer
      vref.child('answer').on('value', (snap) => {
        const ans = snap.val();
        if (ans && pc && !pc.currentRemoteDescription) {
          pc.setRemoteDescription(new RTCSessionDescription(ans)).catch(() => {});
        }
      });
      // unit's ICE
      vref.child('unitCandidates').on('child_added', (cs) => {
        const c = cs.val();
        if (c && pc) pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      });
    }

    function teardownPeer() {
      started = false;
      try { vref.child('answer').off(); } catch (_) {}
      try { vref.child('unitCandidates').off(); } catch (_) {}
      if (pc) { try { pc.close(); } catch (_) {} pc = null; }
    }

    return {
      stop() {
        stopped = true;
        onlineRef.off('value', onlineHandler);
        teardownPeer();
        vref.remove().catch(() => {});
      },
    };
  }

  window.AccessPTTRTC = { init, publish, view, ICE_SERVERS };
})();
