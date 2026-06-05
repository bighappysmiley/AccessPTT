/* =========================================================
 * AccessPTT — Messaging backend (Netlify Function)
 * ---------------------------------------------------------
 * Tiny relay so the operator (Yitzy) and admin (Hillel) can
 * message each other live across devices. Messages are kept
 * in Netlify Blobs, keyed per conversation thread.
 *
 *   GET  /api/messages?thread=<id>&since=<ms>  -> { messages: [...] }
 *   POST /api/messages   body: { id, thread, from, fromName, text, ts }
 *
 * Storage is capped to the most recent messages per thread.
 * ======================================================= */

import { getStore } from '@netlify/blobs';

const MAX_PER_THREAD = 500;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });

export default async function handler(req) {
  const url = new URL(req.url);
  const store = getStore('accessptt-messages');

  if (req.method === 'GET') {
    const thread = url.searchParams.get('thread') || 'default';
    const since = Number(url.searchParams.get('since') || 0);
    const all = (await store.get(thread, { type: 'json' })) || [];
    const messages = since ? all.filter((m) => m.ts > since) : all;
    return json(200, { messages });
  }

  if (req.method === 'POST') {
    let msg;
    try {
      msg = await req.json();
    } catch {
      return json(400, { error: 'invalid JSON' });
    }
    if (!msg || !msg.thread || !msg.text || !msg.from) {
      return json(400, { error: 'missing fields' });
    }

    const clean = {
      id: String(msg.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      thread: String(msg.thread).slice(0, 64),
      from: String(msg.from).slice(0, 64),
      fromName: String(msg.fromName || msg.from).slice(0, 64),
      text: String(msg.text).slice(0, 2000),
      ts: Number(msg.ts) || Date.now(),
    };

    const all = (await store.get(clean.thread, { type: 'json' })) || [];
    if (!all.some((m) => m.id === clean.id)) {
      all.push(clean);
      all.sort((a, b) => a.ts - b.ts);
      while (all.length > MAX_PER_THREAD) all.shift();
      await store.setJSON(clean.thread, all);
    }
    return json(200, { ok: true, message: clean });
  }

  return json(405, { error: 'method not allowed' });
}
