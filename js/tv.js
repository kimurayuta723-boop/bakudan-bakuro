// テレビ(進行役)。ゲームの状態はすべてこの画面が持ち、公開してよい情報だけを全員に、手札などは本人だけに配る。
import { esc, rnd, pick, shuffle, now, M, WHEN, CARDS, Q, ST, icon, TVLINE, OFF, AX, TYPES, tyIll, valid, pipsHTML } from './shared.js';
import { createNet, isLocal } from './net.js';

const $ = s => document.querySelector(s);
let net, room = null, G = null;
let lobby = {}, online = new Set(), drafts = {}, offSince = {};
const set = { level: 2, extra: false, rounds: 5, short: false };
let lastT = now(), actx = null, soundOn = true, nextTick = 0, lastPub = '', lastPriv = {}, hostKey = '', lobbyKey = '';

/* ---------- 共通 ---------- */
const P = id => G.players.find(p => p.id === id);
const nm = id => (G && P(id)) ? P(id).name : (lobby[id] ? lobby[id].name : '');
const mult = () => G.final ? 2 : 1;
const earned = b => Math.floor(b.heldMs / 5000);
const enabledCards = () => Object.keys(CARDS).filter(k => CARDS[k].set === 1 || G.set.extra);
const deal = p => { if (p.cards.length < 2) p.cards.push(pick(enabledCards())); };
const SX = id => G.stats[id];
const rm = (p, c) => { const i = p.cards.indexOf(c); if (i >= 0) { p.cards.splice(i, 1); const s = G.stats[p.id]; s.cards[c] = (s.cards[c] || 0) + 1; } };
const log = t => { G.log.unshift(t); G.log.length = Math.min(G.log.length, 6); };
const note = (u, text) => { G.notes[u] = { id: ++G.nid, text }; };
const flash = (c, who) => { G.flash = { c, who, until: now() + 2800 }; };
const snapPips = () => { G.pips = {}; G.players.forEach(p => G.pips[p.id] = p.cards.length); };
const lobbyList = () => Object.entries(lobby).map(([id, v]) => ({ id, name: String(v.name || '').slice(0, 8), t: v.t || 0 })).sort((a, b) => a.t - b.t);
const phase = () => G ? G.phase : 'lobby';
function ctrlId() { const list = G ? G.players : lobbyList(); const on = list.find(p => online.has(p.id)); return on ? on.id : (list[0] ? list[0].id : null); }

function qPoolG(not) { let pool = []; for (let l = 1; l <= G.set.level; l++) pool = pool.concat(Q[l].map(t => ({ t, l }))); return pool.filter(x => x.t !== not); }
function randQ(not) {
  let pool = qPoolG(not); const fresh = pool.filter(x => !G.usedQ.includes(x.t)); if (fresh.length) pool = fresh; else G.usedQ = [];
  const top = pool.filter(x => x.l === G.set.level); const t = pick(Math.random() < .6 && top.length ? top : pool).t; G.usedQ.push(t); return t;
}

/* ---------- 進行 ---------- */
function startGame() {
  const list = lobbyList();
  if (list.length < 3) return false;
  G = { set: { ...set }, players: list.map(p => ({ id: p.id, name: p.name, score: 0, cards: [] })),
    round: 0, final: false, bombs: [], phase: 'intro', log: [], history: [], boom: null, reveal: null,
    notes: {}, nid: 0, seen: {}, peek: {}, usedQ: [], pips: {}, seq: 0, flash: null, diag: null };
  G.players.forEach(deal); newStats();
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
  nextRound(); return true;
}
function newStats() { G.stats = {}; G.players.forEach(p => G.stats[p.id] = { holds: [], to: {}, ownQ: 0, cards: {}, boom: 0, passes: 0 }); }
function nextRound() {
  G.round++; G.final = G.round > G.set.rounds; G.bombs = []; G.log = []; G.reveal = null; G.peek = {};
  const on = G.players.filter(p => online.has(p.id)).map(p => p.id);
  const order = shuffle(on.length >= 2 ? on : G.players.map(p => p.id));
  for (let i = 0; i < (G.final ? 2 : 1); i++) G.bombs.push(newBomb(order[i % order.length]));
  snapPips(); G.phase = 'intro'; G.introUntil = now() + 3000;
}
function newBomb(h) {
  const [a, b] = G.set.short ? [20, 50] : [40, 120];
  return { id: 'b' + Math.random().toString(36).slice(2, 7), holder: h, hseq: ++G.seq, q: randQ(), qBy: null, extra: null, ans: '', extraAns: '',
    fuse: rnd(a, b) * 1000, age: 0, heldMs: 0, lastPasser: null, recv: { [h]: 1 }, seal: null, sealKnown: false, idle: 0, proph: [], yogen: {}, lastAns: {}, fakeP: 0, done: false };
}
function passTargets(b, from) {
  const others = G.players.filter(p => p.id !== from);
  const pool = others.filter(p => online.has(p.id)).length ? others.filter(p => online.has(p.id)) : others;
  let c = pool.filter(p => p.id !== b.lastPasser && (b.recv[p.id] || 0) < 2);
  if (!c.length) c = pool.filter(p => p.id !== b.lastPasser);
  if (!c.length) c = pool;
  return c.map(p => p.id);
}
function confirmHold(b) { P(b.holder).score += earned(b) * mult(); if (b.heldMs > 0) SX(b.holder).holds.push(b.heldMs); b.heldMs = 0; }
function saveAns(b) { b.lastAns[b.holder] = b.extra ? { q: b.extra.text, a: b.extraAns } : { q: b.q, a: b.ans }; }
function handTo(b, to, q, from) {
  if (b.holder) net.clearDraft(b.holder);
  b.holder = to; b.hseq = ++G.seq; b.q = q; b.qBy = from; b.ans = ''; b.extra = null; b.extraAns = ''; b.heldMs = 0; b.lastPasser = from; b.seal = null; b.sealKnown = false;
  b.recv[to] = (b.recv[to] || 0) + 1;
}
function sealGate(b, uid, c) {
  if (!b.seal || b.holder !== uid) return true;
  if (b.seal === 'real') { rm(P(uid), c); note(uid, `本物の封印でした。${CARDS[c].n}は効果なしで失われました。`); return false; }
  if (!b.sealKnown) note(uid, 'ニセ封印でした。カードはそのまま効きます。');
  b.sealKnown = true; return true;
}
function doPass(b, from, to, q, cards, own) {
  const st = SX(from); st.passes++; st.to[to] = (st.to[to] || 0) + 1; if (own) st.ownQ++;
  const eff = cards.filter(c => sealGate(b, from, c));
  confirmHold(b); saveAns(b);
  const p = P(from); handTo(b, to, q, from); log(`${nm(from)} → ${nm(to)}`);
  for (const c of eff) {
    if (!p.cards.includes(c)) continue; rm(p, c);
    if (c === 'tenka') { const cut = G.set.short ? 8000 : 15000; b.fuse = Math.max(2000, cut - b.age, b.fuse - cut); }
    if (c === 'fuuin') { b.seal = 'real'; log(`${nm(from)}が封印を使った`); flash('fuuin', from); }
    if (c === 'nisefuuin') { b.seal = 'fake'; log(`${nm(from)}が封印を使った`); flash('fuuin', from); }
  }
}
function doReturn(b, uid) {
  if (!b.lastPasser) return; rm(P(uid), 'uchikaeshi');
  const back = b.lastPasser, q = b.q; confirmHold(b); handTo(b, back, q, uid); log(`${nm(uid)}が打ち返しを使った`); flash('uchikaeshi', uid);
}
function useIdle(b, uid, c, arg) {
  const p = P(uid);
  if (!b || b.done || G.phase !== 'play' || b.idle >= 2 || b.holder === uid || !p.cards.includes(c)) return false;
  if (c === 'yogen') { if (!arg || arg === b.holder || !P(arg) || b.yogen[uid]) return false; b.proph.push({ by: uid, target: arg }); b.yogen[uid] = 1; }
  if (c === 'oishitsumon') { if (b.extra || !valid(arg)) return false; b.extra = { text: arg, by: uid }; b.extraAns = ''; log(`${nm(uid)}が追い質問を使った`); flash('oishitsumon', uid); }
  if (c === 'yokodori') { const from = b.holder, seal = b.seal; confirmHold(b); saveAns(b); handTo(b, uid, b.q, from); b.seal = seal; log(`${nm(uid)}が${nm(from)}から横取りした`); flash('yokodori', uid); }
  if (c === 'toushi') { if (!arg || !P(arg)) return false; G.seen[uid] = { id: arg, cards: P(arg).cards.slice(), until: now() + 8000 }; }
  rm(p, c); b.idle++; return true;
}
function autoPass(b) {
  const from = b.holder, opts = passTargets(b, from); if (!opts.length) return;
  const to = pick(opts); confirmHold(b); saveAns(b); handTo(b, to, randQ(b.q), from);
  log(`${nm(from)}の通信が切れたため、${nm(to)}へ移動`);
}
function explode(b) {
  G.phase = 'boom';
  G.boom = { b, victim: b.holder, cause: b.lastPasser, causer: b.lastPasser, stage: 1, drag: null, sub: null, left: 5000 };
  beep(70, .6, .3);
}
function boomOptions() {
  const B = G.boom, p = P(B.victim), o = []; if (!B.cause) return o;
  if (B.stage === 1 && p.cards.includes('migawari')) o.push('migawari');
  if (p.cards.includes('michizure')) o.push('michizure'); return o;
}
function useBoom(c, uid) {
  const B = G.boom; if (!B || G.phase !== 'boom' || uid !== B.victim || !boomOptions().includes(c)) return;
  if (B.stage === 1 && !sealGate(B.b, uid, c)) return;
  rm(P(uid), c);
  if (c === 'migawari') { log(`${nm(uid)}が身代わりを使った`); flash('migawari', uid); if (B.b.holder === uid) confirmHold(B.b);
    B.sub = uid; B.victim = B.cause; B.cause = uid; B.causer = uid; B.stage = 2; B.left = 5000; }
  if (c === 'michizure') { log(`${nm(uid)}が道連れを使った`); flash('michizure', uid); B.drag = B.cause; B.left = Math.min(B.left, 1500); }
}
function resolveBoom() {
  const B = G.boom, b = B.b, m = mult(), entries = [], others = [];
  const hit = [B.victim]; if (B.drag && !hit.includes(B.drag)) hit.push(B.drag);
  const burn = (bb, pid, tag) => {
    const isH = pid === bb.holder, cur = isH ? earned(bb) : 0, pts = []; SX(pid).boom++; if (isH && bb.heldMs > 0) SX(pid).holds.push(bb.heldMs);
    let r = isH ? (bb.extra ? { q: bb.extra.text, a: bb.extraAns } : { q: bb.q, a: bb.ans }) : bb.lastAns[pid];
    let d = -(3 + 2 * cur) * m;
    pts.push(cur ? `爆発 ${M}${(3 + 2 * cur) * m}(3+持っていた分${cur}×2${m > 1 ? '、2倍' : ''})` : `爆発 ${M}${3 * m}`);
    if (!r) r = { q: '', a: '', none: true };
    else if (!r.a || !r.a.trim()) { d -= m; pts.push(`答えられなかった ${M}${m}`); }
    P(pid).score += d; entries.push({ pid, q: r.q, a: r.a, none: !!r.none, tag, pts });
    if (!r.none) G.history.push({ name: nm(pid), q: r.q, a: r.a });
  };
  for (const pid of hit) burn(b, pid, pid === B.drag ? '道連れで爆発' : (B.sub && pid === B.victim ? '身代わりで爆発' : ''));
  b.heldMs = 0; b.done = true; net.clearDraft(b.holder);
  if (!B.drag && B.causer && !hit.includes(B.causer)) { P(B.causer).score += 2 * m; others.push(`${nm(B.causer)} 爆発させた +${2 * m}`); }
  for (const pr of b.proph) if (hit.includes(pr.target)) { P(pr.by).score += 3 * m; others.push(`${nm(pr.by)} 予言が的中 +${3 * m}`); }
  if (G.final) for (const o of G.bombs) if (!o.done && hit.includes(o.holder)) { burn(o, o.holder, '誘爆'); o.heldMs = 0; o.done = true; net.clearDraft(o.holder); }
  if (!G.final) hit.forEach(pid => deal(P(pid)));
  G.reveal = { entries, others }; G.boom = null; G.phase = 'reveal';
}
function diagnose() {
  const raw = G.players.map(p => {
    const s = SX(p.id), hs = s.holds.filter(x => x > 0);
    const hold = hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length / 1000 : 0;
    const off = OFF.reduce((a, c) => a + (s.cards[c] || 0), 0);
    const atk = (off + s.ownQ * .5) / Math.max(1, s.passes);
    const tv = Object.values(s.to), aim = s.passes ? Math.max(...tv) / s.passes : 0;
    const top = tv.length ? Object.keys(s.to).sort((a, b) => s.to[b] - s.to[a])[0] : null;
    return { id: p.id, hold, atk, aim, off, top, passes: s.passes, boom: s.boom, ownQ: s.ownQ };
  });
  const med = k => { const v = raw.map(r => r[k]).sort((a, b) => a - b); return v[Math.floor((v.length - 1) / 2)]; };
  const rng = k => { const v = raw.map(r => r[k]); return [Math.min(...v), Math.max(...v)]; };
  const m = { hold: med('hold'), atk: med('atk'), aim: med('aim') };
  return raw.map(r => {
    const hi = { hold: r.hold > m.hold, atk: r.atk > m.atk || (r.atk === m.atk && r.atk > 0 && r.off > 0), aim: r.aim > m.aim };
    const code = AX.map(a => hi[a.k] ? a.c[0] : a.c[1]).join('');
    const pos = {}; AX.forEach(a => { const [lo, hh] = rng(a.k); pos[a.k] = hh > lo ? (r[a.k] - lo) / (hh - lo) : .5; });
    return { id: r.id, code, pos, hold: +r.hold.toFixed(1), off: r.off, ownQ: r.ownQ, top: r.top, boom: r.boom, few: r.passes < 2 };
  });
}

/* ---------- 進行の指示(テレビのボタン、または幹事のスマホから) ---------- */
function hostCmd(a) {
  const ph = phase();
  if (a === 'start' && ph === 'lobby') { if (!startGame()) flashLobby('3人以上で始められます。'); }
  else if (a === 'abort' && ph === 'play') { G.bombs.forEach(b => { b.done = true; b.heldMs = 0; net.clearDraft(b.holder); }); G.boom = null; log('ホストが中止しました'); G.phase = G.final ? 'end' : 'score'; }
  else if (a === 'next' && ph === 'reveal') { G.reveal = null; snapPips(); G.phase = G.bombs.some(b => !b.done) ? 'play' : (G.final ? 'end' : 'score'); }
  else if (a === 'round' && ph === 'score') nextRound();
  else if (a === 'diag' && ph === 'end') { G.diag = diagnose(); G.phase = 'type'; }
  else if (a === 'back' && ph === 'type') G.phase = 'end';
  else if (a === 'again' && (ph === 'end' || ph === 'type')) { G.players.forEach(p => { p.score = 0; p.cards = []; deal(p); }); G.round = 0; G.history = []; G.diag = null; newStats(); nextRound(); }
  else if (a === 'lobby' && (ph === 'end' || ph === 'type')) { G = null; }
  hostKey = ''; lobbyKey = '';
}
function handleAct(a) {
  if (!a || !a.u) return;
  const u = a.u;
  if (a.t === 'host') { if (u === ctrlId()) hostCmd(a.a); return; }
  if (!G) return;
  const p = P(u); if (!p) return;
  const b = a.b ? G.bombs.find(x => x.id === a.b) : null;
  const txt = v => String(v || '').slice(0, 120);
  if (a.t === 'pass') {
    if (G.phase !== 'play' || !b || b.done || b.holder !== u || a.h !== b.hseq) return;
    b.ans = txt(a.ans); if (b.extra) b.extraAns = txt(a.ex);
    if (!valid(b.ans)) return note(u, '答えは5文字以上で書いてください。');
    if (b.extra && !valid(b.extraAns)) return note(u, '追い質問にも5文字以上で答えてください。');
    if (!passTargets(b, u).includes(a.to)) return note(u, 'その人には渡せません。もう一度選んでください。');
    const q = txt(a.q).slice(0, 80); if (!valid(q)) return note(u, '質問は5文字以上にしてください。');
    const cards = [...new Set(a.cards || [])].filter(c => CARDS[c] && CARDS[c].w === 'pass' && p.cards.includes(c)).slice(0, 2);
    if (!a.own) G.usedQ.push(q);
    doPass(b, u, a.to, q, cards, !!a.own);
  } else if (a.t === 'ret') {
    if (G.phase === 'play' && b && !b.done && b.holder === u && b.lastPasser && p.cards.includes('uchikaeshi') && b.heldMs < 11500 && sealGate(b, u, 'uchikaeshi')) doReturn(b, u);
  } else if (a.t === 'peek') {
    if (G.phase === 'play' && b && !b.done && b.holder === u && p.cards.includes('nozokimi') && sealGate(b, u, 'nozokimi')) { rm(p, 'nozokimi'); G.peek[u] = { b: b.id, until: now() + 3000 }; }
  } else if (a.t === 'steal') useIdle(b, u, 'yokodori');
  else if (a.t === 'yogen') { if (useIdle(b, u, 'yogen', a.target)) note(u, `${nm(a.target)}で爆発すると予言しました。`); }
  else if (a.t === 'oi') { if (!useIdle(b, u, 'oishitsumon', txt(a.q).slice(0, 80))) note(u, '追い質問を足せませんでした。'); }
  else if (a.t === 'toushi') useIdle(b, u, 'toushi', a.target);
  else if (a.t === 'boom') useBoom(a.c, u);
}

/* ---------- 配信(公開情報と、本人だけの情報) ---------- */
function buildPub() {
  const ph = phase();
  const base = { phase: ph, room, ctrl: ctrlId(), set: { ...set } };
  if (!G) return { ...base, players: lobbyList().map(p => ({ id: p.id, name: p.name, on: online.has(p.id) })) };
  return { ...base, set: { ...G.set }, round: G.round, final: G.final,
    players: G.players.map(p => ({ id: p.id, name: p.name, pips: G.pips[p.id] || 0, on: online.has(p.id) })),
    bombs: G.bombs.map(b => ({ id: b.id, holder: b.holder, hseq: b.hseq, q: b.q, qBy: b.qBy || null, extra: b.extra || null, seal: !!b.seal, idle: b.idle,
      hs: Math.floor(b.heldMs / 1000), lp: b.lastPasser || null, recv: b.recv, done: b.done })),
    boom: G.boom ? { victim: G.boom.victim, stage: G.boom.stage, left: Math.ceil(G.boom.left / 1000) } : null,
    scores: ['score', 'end', 'type'].includes(ph) ? Object.fromEntries(G.players.map(p => [p.id, p.score])) : null,
    diag: ph === 'type' ? G.diag : null };
}
function buildPriv(p) {
  const t = now(), s = G.seen[p.id], pk = G.peek[p.id];
  const pb = pk && t < pk.until ? G.bombs.find(b => b.id === pk.b) : null;
  return { cards: p.cards.slice(), note: G.notes[p.id] || null,
    seen: s && t < s.until ? { id: s.id, cards: s.cards } : null,
    peek: pb && !pb.done ? { b: pb.id, remain: Math.max(0, Math.ceil(pb.fuse / 1000)) } : null,
    yogen: G.bombs.filter(b => b.yogen[p.id]).map(b => b.id),
    sk: G.bombs.filter(b => b.holder === p.id && b.sealKnown).map(b => b.id),
    boomOpts: G.phase === 'boom' && G.boom.victim === p.id ? boomOptions() : [] };
}
function publish() {
  const pub = JSON.stringify(buildPub());
  if (pub !== lastPub) { lastPub = pub; net.setPub(JSON.parse(pub)); }
  if (!G) return;
  for (const p of G.players) {
    const v = JSON.stringify(buildPriv(p));
    if (v !== lastPriv[p.id]) { lastPriv[p.id] = v; net.setPriv(p.id, JSON.parse(v)); }
  }
}

/* ---------- 音(残り時間とは無関係に揺らす) ---------- */
function beep(f, len, vol) { if (!actx || !soundOn) return; try { const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = f; g.gain.value = vol; o.connect(g); g.connect(actx.destination); o.start(); g.gain.exponentialRampToValueAtTime(.0001, actx.currentTime + len); o.stop(actx.currentTime + len); } catch (e) { } }

/* ---------- ループ ---------- */
function loop() {
  const t = now(), dt = Math.min(500, t - lastT); lastT = t;
  if (G) {
    if (G.phase === 'intro' && t >= G.introUntil) G.phase = 'play';
    if (G.phase === 'play') {
      for (const b of G.bombs) {
        if (b.done) continue;
        b.fuse -= dt; b.age += dt; b.heldMs += dt; b.fakeP += (.9 - b.fakeP) * rnd(0, .014) * (dt / 200);
        if (b.fuse <= 0) { explode(b); break; }
        // 持っている人の通信が15秒切れたら、別の人へ移す
        if (!online.has(b.holder)) { offSince[b.holder] = offSince[b.holder] || t; if (t - offSince[b.holder] > 15000) { autoPass(b); delete offSince[b.holder]; } }
        else delete offSince[b.holder];
      }
      if (G.phase === 'play' && t >= nextTick) { beep(1700, .03, .05); nextTick = t + rnd(260, 950); }
    }
    if (G.phase === 'boom') { G.boom.left -= dt; if (G.boom.left <= 0) resolveBoom(); }
  }
  render(); publish();
}

/* ---------- テレビの描画 ---------- */
function fuseSVG(p) {
  const N = 64, pts = []; for (let i = 0; i <= N; i++) pts.push([20 + i * (780 / N), 100 + 14 * Math.sin(i * .5)]);
  const k = Math.round(Math.min(p, 1) * N), f = a => a.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ');
  const [sx, sy] = pts[k]; let sp = '';
  for (let i = 0; i < 6; i++) { const a = rnd(0, Math.PI * 2), r2 = rnd(16, 26); sp += `<line x1="${(sx + Math.cos(a) * 9).toFixed(1)}" y1="${(sy + Math.sin(a) * 9).toFixed(1)}" x2="${(sx + Math.cos(a) * r2).toFixed(1)}" y2="${(sy + Math.sin(a) * r2).toFixed(1)}" stroke="#e1411e" stroke-width="2.5" stroke-linecap="round"/>`; }
  return `<svg viewBox="0 0 1000 180" preserveAspectRatio="xMinYMid meet" aria-hidden="true">
 <polyline points="${f(pts.slice(0, k + 1))}" fill="none" stroke="#3a3733" stroke-width="3" stroke-dasharray="1 9" stroke-linecap="round"/>
 <polyline points="${f(pts.slice(k))}" fill="none" stroke="#c8b48b" stroke-width="4" stroke-linecap="round"/>
 <rect x="796" y="104" width="30" height="22" fill="#24221f" stroke="#c8b48b" stroke-width="2"/>
 <circle cx="892" cy="112" r="66" fill="#1d1b19" stroke="#c8b48b" stroke-width="2"/>
 <path d="M852 88a48 48 0 0 1 30-18" fill="none" stroke="#8a857b" stroke-width="4" stroke-linecap="round"/>
 <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="7" fill="#e1411e"/>${sp}</svg>`;
}
const qLabel = b => b.qBy ? `${esc(nm(b.qBy))}からの質問` : 'お題';
const curQ = b => b.extra ? b.extra.text : b.q;
function roster() {
  const hs = G.bombs.filter(b => !b.done).map(b => b.holder);
  return `<div class="roster">${G.players.map(p => `<span class="${hs.includes(p.id) ? 'on' : ''} ${online.has(p.id) ? '' : 'off'}">${esc(p.name)}${pipsHTML(G.pips[p.id] || 0)}</span>`).join('')}</div>`;
}
function table(one) {
  const s = G.players.slice().sort((a, b) => b.score - a.score);
  return `<div class="tbl ${one || s.length <= 5 ? 'one' : ''}">${s.map((p, i) => `<div class="tr"><span class="r">${i + 1}</span><span>${esc(p.name)}</span><span class="dg">${p.score < 0 ? M + (-p.score) : p.score}</span></div>`).join('')}</div>`;
}
function flashHTML() {
  const f = G.flash; if (!f || now() >= f.until) return '';
  return `<div class="flash">${icon(f.c, 'lg')}<div><p class="fw">${esc(nm(f.who))}が</p><p class="fn dg">${CARDS[f.c].n}</p><p class="fl">${TVLINE[f.c] || ''}</p></div></div>`;
}
function burstSVG() { return `<svg class="burst" viewBox="0 0 400 400" aria-hidden="true"><polygon points="${ST(200, 200, 190, 14, .62)}" fill="#0f0e0d"/><polygon points="${ST(200, 200, 118, 11, .6)}" fill="#eeebe5"/><circle cx="200" cy="200" r="46" fill="#0f0e0d"/><path d="M40 70l22 14M330 52l-14 24M360 300l-26-8M70 330l20-18" stroke="#0f0e0d" stroke-width="10" stroke-linecap="round"/></svg>`; }
function introSVG(n) {
  const one = (x, y, r) => `<path d="M${x + r * .62} ${y - r * .8}q${r * .25} -${r * .5} ${r * .62} -${r * .45}" fill="none" stroke="#c8b48b" stroke-width="6" stroke-linecap="round"/><rect x="${x + r * .42}" y="${y - r * .98}" width="${r * .3}" height="${r * .22}" fill="#24221f" stroke="#c8b48b" stroke-width="3" transform="rotate(38 ${x + r * .57} ${y - r * .87})"/><circle cx="${x}" cy="${y}" r="${r}" fill="#1d1b19" stroke="#c8b48b" stroke-width="3"/><path d="M${x - r * .55} ${y - r * .35}a${r * .66} ${r * .66} 0 0 1 ${r * .4} -${r * .3}" fill="none" stroke="#8a857b" stroke-width="7" stroke-linecap="round"/>`;
  return `<svg class="ill" viewBox="0 0 400 300" aria-hidden="true">${n > 1 ? one(150, 180, 82) + one(300, 200, 64) : one(220, 180, 96)}<circle cx="${n > 1 ? 250 : 310}" cy="${n > 1 ? 72 : 60}" r="9" fill="#e1411e"/></svg>`;
}
const joinURL = () => { const u = new URL('phone.html', location.href); u.searchParams.set('room', room); if (isLocal()) u.searchParams.set('local', ''); return u.href.replace('local=', 'local'); };
let lobbyMsg = '', lobbyMsgUntil = 0;
function flashLobby(t) { lobbyMsg = t; lobbyMsgUntil = now() + 4000; }
function renderLobby(el) {
  const list = lobbyList();
  const key = JSON.stringify([room, list, [...online], set, lobbyMsg && now() < lobbyMsgUntil ? lobbyMsg : '']);
  if (key === lobbyKey && el.querySelector('.lobby')) return; lobbyKey = key;
  const keepQR = el.querySelector('#qr');
  const seg = (k, opts) => `<div class="tseg">${opts.map(([v, l]) => `<button data-s="${k}" data-v="${v}" class="${String(set[k]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const html = `<div class="lobby">
   <div class="lb-l"><p class="k">スマホで参加</p><h1 class="dg">ばくだん暴露</h1><div class="qrw"><div id="qrslot"></div><div><p class="k">部屋コード</p><p class="code dg">${esc(room || '----')}</p><p class="url">${esc(joinURL())}</p></div></div></div>
   <div class="lb-r"><p class="k">参加者 ${list.length}人${list.length < 3 ? '(3人以上で開始)' : ''}</p>
    <div class="pl">${list.length ? list.map((p, i) => `<span class="${online.has(p.id) ? '' : 'off'}">${p.id === ctrlId() ? '<i class="ctrl">幹事</i>' : ''}${esc(p.name)}<button data-kick="${p.id}" aria-label="${esc(p.name)}を外す">×</button></span>`).join('') : '<em>まだ誰もいません</em>'}</div>
    <div class="sets"><p class="k">過激度</p>${seg('level', [[1, '1 ゆるめ'], [2, '2 ふつう'], [3, '3 きわどい']])}
    <p class="k">カード</p>${seg('extra', [[false, '基本 7種'], [true, '基本+追加 11種']])}
    <p class="k">ラウンド数</p>${seg('rounds', [[3, '3+最終'], [5, '5+最終'], [7, '7+最終']])}
    <p class="k">導火線</p>${seg('short', [[false, '本番 40〜120秒'], [true, '短め 20〜50秒']])}</div>
    <p class="lmsg">${lobbyMsg && now() < lobbyMsgUntil ? esc(lobbyMsg) : '幹事のスマホ、またはこの画面の「はじめる」で開始します。'}</p>
    <button class="tgo" data-h="start" ${list.length < 3 ? 'disabled' : ''}>はじめる</button></div></div>`;
  el.innerHTML = html;
  const slot = el.querySelector('#qrslot');
  if (keepQR) slot.replaceWith(keepQR);
  else { slot.id = 'qr'; if (window.QRCode) { try { new window.QRCode(slot, { text: joinURL(), width: 512, height: 512, colorDark: '#0f0e0d', colorLight: '#eeebe5', correctLevel: window.QRCode.CorrectLevel.M }); } catch (e) { slot.textContent = 'QRコードを作れませんでした'; } } else slot.innerHTML = '<span class="noqr">QRコードを読み込めませんでした。右のアドレスを入力してください。</span>'; }
}
function render() {
  const tv = $('#tv'), el = tv.querySelector('.in'); let h = '';
  tv.classList.toggle('red', phase() === 'boom');
  if (!G) { renderLobby(el); renderHost(); return; }
  const meta = `<div class="meta"><span>${G.final ? '最終ラウンド ・ 爆弾2個 ・ 点数2倍' : `第${G.round}ラウンド / 全${G.set.rounds}+最終`}</span><span>${esc(G.log[0] || '')}</span></div>`;
  if (G.phase === 'intro') {
    h = `${introSVG(G.final ? 2 : 1)}<div class="center"><span class="k">${G.final ? '爆弾2個 ・ 点数2倍' : 'まもなく点火'}</span><span class="h dg">${G.final ? '最終ラウンド' : `第${G.round}ラウンド`}</span></div>`;
  } else if (G.phase === 'play') {
    if (G.bombs.length === 1) {
      const b = G.bombs[0];
      h = meta + `<div class="who dg">${esc(nm(b.holder))}<small>が持っています</small></div><div class="qlab">${b.extra ? `${esc(nm(b.extra.by))}の追い質問` : qLabel(b)}</div><div class="qq">${esc(curQ(b))}</div><div class="fuse">${fuseSVG(b.fakeP)}</div>` + roster() + flashHTML();
    } else {
      h = meta + `<div class="duo">${G.bombs.map((b, i) => b.done ? `<div><div class="who dg gone">爆発済み</div></div>` : `<div><div class="who dg">${esc(nm(b.holder))}</div><div class="qlab">爆弾${i + 1} ・ ${b.extra ? '追い質問' : qLabel(b)}</div><div class="qq">${esc(curQ(b))}</div><div class="fuse">${fuseSVG(b.fakeP)}</div></div>`).join('')}</div>` + roster() + flashHTML();
    }
  } else if (G.phase === 'boom') {
    const B = G.boom, fl = G.flash && now() < G.flash.until ? G.flash : null;
    h = `${burstSVG()}<div class="center boom"><span class="k">${fl ? `${icon(fl.c, 'sm')}${esc(nm(fl.who))}が${CARDS[fl.c].n}を使った` : '&nbsp;'}</span><span class="h dg">爆発</span><span class="nm dg">${esc(nm(B.victim))}</span><span class="cd">最後の手段 あと${Math.max(0, Math.ceil(B.left / 1000))}秒</span></div>`;
  } else if (G.phase === 'reveal') {
    const R = G.reveal;
    h = meta + `<div class="rv ${R.entries.length > 1 ? 'two' : ''}">${R.entries.map(e => `<div><div><div class="nm dg">${esc(nm(e.pid))}</div><div class="tg">${e.tag ? esc(e.tag) : 'の答え'}</div><div class="rq">${e.none ? '' : esc(e.q)}</div></div><div><div class="ra ${e.none || !(e.a && e.a.trim()) ? 'none' : ''}">${e.none ? 'この爆弾では答えていません' : (e.a && e.a.trim() ? esc(e.a) : '答えられなかった')}</div><div class="pt">${e.pts.map(esc).join(' / ')}</div></div></div>`).join('')}</div>` + (R.others.length ? `<div class="foot">${R.others.map(x => `<b>${esc(x)}</b>`).join('  ・  ')}</div>` : '');
  } else if (G.phase === 'score') {
    h = meta + `<div class="ttl dg">第${G.round}ラウンド終了</div>${table()}`;
  } else if (G.phase === 'end') {
    const top = G.players.slice().sort((a, b) => b.score - a.score)[0], sum = G.history.slice(-6).reverse();
    h = `<div class="meta"><span>結果</span><span>質問と答えはどこにも保存していません</span></div><div class="ends"><div><div class="ttl dg" style="margin-top:0">${esc(top.name)}の勝ち</div>${table(1)}</div><div class="sum"><h3>今日の暴露</h3>${sum.length ? sum.map(s => `<p><b>${esc(s.name)}</b>${esc(s.q)}<span>${s.a && s.a.trim() ? esc(s.a) : '答えられなかった'}</span></p>`).join('') : '<p>今日は誰も暴露されませんでした。</p>'}</div></div>`;
  } else if (G.phase === 'type') {
    const D = G.diag;
    h = `<div class="meta"><span>今日のプレイスタイル</span><span>爆弾の持ち方 ・ カードの使い方 ・ 渡し方から判定</span></div><div class="tyg ${D.length > 6 ? 'many' : ''}">${D.map(d => `<div>${tyIll(d.code, 'tvi')}<div><p class="tn">${esc(nm(d.id))}</p><p class="tc dg">${d.code}</p><p class="tt">${TYPES[d.code].n}</p><p class="tl">${TYPES[d.code].t}</p></div></div>`).join('')}</div>`;
  }
  el.innerHTML = h; renderHost();
}
function renderHost() {
  const ph = phase(), k = ph + '|' + soundOn + '|' + (G ? G.round : 0) + '|' + room; if (k === hostKey) return; hostKey = k;
  const snd = `<button data-h="sound">音 ${soundOn ? 'オン' : 'オフ'}</button>`;
  const full = `<button data-h="full">全画面</button>`;
  const m = {
    lobby: `${full}<button data-h="close">部屋を閉じる</button>`,
    play: `<button data-h="abort">この爆弾を中止</button>${snd}${full}`, intro: snd + full, boom: snd + full,
    reveal: `<button class="main" data-h="next">次へ</button>${full}`,
    score: `<button class="main" data-h="round">${G && G.round >= G.set.rounds ? '最終ラウンドへ' : '次のラウンドへ'}</button>${full}`,
    end: `<button class="main" data-h="diag">性格診断を見る</button><button data-h="again">同じメンバーでもう一度</button><button data-h="lobby">待合に戻る</button>`,
    type: `<button data-h="back">結果に戻る</button><button class="main" data-h="again">同じメンバーでもう一度</button><button data-h="lobby">待合に戻る</button>`
  };
  $('#host').innerHTML = m[ph] || '';
}

/* ---------- 起動 ---------- */
document.addEventListener('click', async e => {
  const s = e.target.closest('[data-s]');
  if (s && !G) { const k = s.dataset.s, v = s.dataset.v; set[k] = k === 'level' || k === 'rounds' ? +v : v === 'true'; lobbyKey = ''; return; }
  const kick = e.target.closest('[data-kick]');
  if (kick && !G) { delete lobby[kick.dataset.kick]; net.removePlayer(kick.dataset.kick); lobbyKey = ''; return; }
  const h = e.target.closest('[data-h]'); if (!h) return;
  const a = h.dataset.h;
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); } catch (x) { }
  if (a === 'sound') { soundOn = !soundOn; hostKey = ''; return; }
  if (a === 'full') { try { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); } catch (x) { } return; }
  if (a === 'close') { await net.closeRoom(); location.href = 'index.html'; return; }
  hostCmd(a); loop();
});
(async () => {
  try { net = await createNet(); }
  catch (e) { $('#tv .in').innerHTML = `<div class="center"><span class="k">接続できませんでした</span><span class="h dg" style="font-size:4cqw">Firebaseの設定を確かめてください</span><span class="k">${esc(e.message || e)}</span></div>`; return; }
  if (net.mode === 'local') document.body.classList.add('local');
  room = await net.createRoom();
  net.onPlayers(v => { lobby = v || {}; lobbyKey = ''; });
  net.onOnline(list => { online = new Set(list); });
  net.onDrafts(d => {
    drafts = d || {};
    if (!G) return;
    for (const b of G.bombs) { if (b.done) continue; const x = drafts[b.holder];
      if (x && x.b === b.id && x.h === b.hseq) { b.ans = String(x.ans || '').slice(0, 120); if (b.extra) b.extraAns = String(x.ex || '').slice(0, 120); } }
  });
  net.onActions(handleAct);
  setInterval(loop, 200); loop();
})();
