// スマホ。テレビから届いた公開情報(S)と、自分だけの情報(V)で画面を組み立て、操作をテレビへ送る。
import { esc, now, M, WHEN, CARDS, icon, AX, TYPES, tyIll, isWho, valid, strong, choices, pipsHTML } from './shared.js';
import { createNet } from './net.js';
import { buzz } from './sound.js';

const $ = s => document.querySelector(s);
const params = new URLSearchParams(location.search);
let net, uid, S = null, V = {}, pubAt = 0, joined = false, closed = false;
const ui = {}; let composing = false, noteSeen = 0, noteShow = null, noteUntil = 0, draftTimer = null;
const sending = {};

/* ---------- 共通 ---------- */
const P = id => (S && S.players || []).find(p => p.id === id);
const nm = id => P(id) ? P(id).name : '';
const mult = () => S.final ? 2 : 1;
const live = () => (S.bombs || []).filter(b => !b.done);
const hsLive = b => b.hs + (S.phase === 'play' ? Math.floor((now() - pubAt) / 1000) : 0);
const earned = b => Math.floor(hsLive(b) / 5);
const myCards = () => V.cards || [];
const level = () => (S && S.set && S.set.level) || 2;
const send = a => net.send(a);
function passTargets(b, from) {
  const others = S.players.filter(p => p.id !== from);
  const pool = others.filter(p => p.on).length ? others.filter(p => p.on) : others;
  const recv = b.recv || {};
  let c = pool.filter(p => p.id !== b.lp && (recv[p.id] || 0) < 2);
  if (!c.length) c = pool.filter(p => p.id !== b.lp);
  if (!c.length) c = pool;
  return c.map(p => p.id);
}
const qLabel = b => b.qBy ? `${esc(nm(b.qBy))}からの質問` : 'お題';

/* ---------- 部分描画(入力中の欄は作り直さない) ---------- */
function composingIn(el) { return composing && el.contains(document.activeElement); }
function patch(el, key, html) {
  if (!el || el.dataset.key === key || composingIn(el)) return false;
  const a = document.activeElement, fk = a && el.contains(a) && a.dataset ? a.dataset.k : null; let sel = null;
  try { if (fk && a.selectionStart != null) sel = [a.selectionStart, a.selectionEnd]; } catch (e) { }
  el.innerHTML = html; el.dataset.key = key;
  el.querySelectorAll('textarea[data-k],input[data-k]').forEach(t => { const v = ui[t.dataset.k]; if (v != null) t.value = v; warn(t); });
  if (fk) { const t = el.querySelector(`[data-k="${fk}"]`); if (t) { t.focus(); if (sel) try { t.setSelectionRange(sel[0], sel[1]); } catch (e) { } } }
  return true;
}
function warn(el) { const w = document.querySelector(`[data-w="${el.dataset.k}"]`); if (w) w.textContent = S && strong(el.value, level()) ? '強めの表現が含まれています。このまま送れます。' : ''; }
function choiceList(key, list, act, bid) {
  const v = ui[key];
  return list.map((t, i) => `<button class="ch ${v === String(i) ? 'on' : ''}" data-act="${act}" data-b="${bid}" data-i="${i}"><i class="dot"></i><span>${esc(t)}</span></button>`).join('') +
    `<button class="ch ${v === 'own' ? 'on' : ''}" data-act="${act}" data-b="${bid}" data-i="own"><i class="dot"></i><span>自分で書く</span></button>`;
}
const nameChips = (bid, field) => `<div class="chips">${S.players.filter(p => p.id !== uid).map(p => `<button class="chip" data-act="ins" data-b="${bid}" data-f="${field}" data-v="${esc(p.name)}">${esc(p.name)}</button>`).join('')}</div>`;
const hk = b => b.id + '-' + b.hseq;

/* ---------- 持っているとき ---------- */
function holdHTML(b) {
  const id = b.id, k = hk(b);
  if (!ui['qo-' + k]) ui['qo-' + k] = choices(level(), b.q);
  const opts = passTargets(b, uid);
  return `<div class="band"><div><p>あなたが持っています</p><p class="bs" data-live="risk"></p></div><b data-live="earn">+0</b></div>
 <p class="peek" data-live="peek"></p><div data-sub="ctl"></div>
 <div class="blk"><p class="h"><span>答える</span><span>${qLabel(b)}</span></p><p class="qt">${esc(b.q)}</p>
 <textarea rows="3" maxlength="120" data-k="ans-${k}" data-f="ans" data-b="${id}" placeholder="5文字以上で答える"></textarea>${isWho(b.q) ? nameChips(id, 'ans') : ''}<p class="warn" data-w="ans-${k}"></p></div>
 <div data-sub="extra"></div>
 <div class="blk"><p class="h"><span>渡す相手</span><span>右の印は手札の枚数(ラウンド開始時)</span></p><div class="grid2">${opts.map(o => `<button class="opt ${ui['to-' + k] === o ? 'on' : ''}" data-act="to" data-b="${id}" data-v="${o}"><span>${esc(nm(o))}</span>${pipsHTML(P(o).pips || 0)}</button>`).join('')}</div></div>
 <div class="blk"><p class="h"><span>その人への質問</span><span>選ぶか、自分で書く</span></p>${choiceList('qc-' + k, ui['qo-' + k], 'qc', id)}
 <div class="own" data-own="${k}" ${ui['qc-' + k] === 'own' ? '' : 'hidden'}><textarea rows="2" maxlength="80" data-k="nq-${k}" placeholder="5文字以上"></textarea><p class="warn" data-w="nq-${k}"></p></div></div>
 <div data-sub="pc"></div><p class="err" data-err="${id}"></p>
 <div data-sub="go"></div>`;
}
function holdSubs(s, b) {
  const id = b.id, k = hk(b), cards = myCards(), sk = (V.sk || []).includes(id);
  const canRet = cards.includes('uchikaeshi') && b.lp && hsLive(b) < 10, canPeek = cards.includes('nozokimi');
  patch(s.querySelector('[data-sub="ctl"]'), JSON.stringify([b.seal, sk, canRet, canPeek]),
    (b.seal ? `<p class="seal"><b>封印</b> この爆弾ではカードが使えません。${sk ? 'ニセ封印と分かりました。' : '試しに使うと、本物なら効果なしで失われます。'}</p>` : '') +
    (canRet || canPeek ? `<div class="row">${canRet ? `<button class="ol" data-act="ret" data-b="${id}">${icon('uchikaeshi')}打ち返し(${esc(nm(b.lp))}へ返す)</button>` : ''}${canPeek ? `<button class="ol" data-act="peek" data-b="${id}">${icon('nozokimi')}のぞき見</button>` : ''}</div>` : ''));
  patch(s.querySelector('[data-sub="extra"]'), b.extra ? b.extra.text : '', b.extra ? `<div class="blk"><p class="h"><span>追い質問にも答える</span><span>${esc(nm(b.extra.by))}から</span></p><p class="qt">${esc(b.extra.text)}</p><textarea rows="2" maxlength="120" data-k="ex-${k}" data-f="ex" data-b="${id}" placeholder="爆発したらこちらが出ます"></textarea>${isWho(b.extra.text) ? nameChips(id, 'ex') : ''}<p class="warn" data-w="ex-${k}"></p></div>` : '');
  const pcs = [...new Set(cards.filter(c => CARDS[c].w === 'pass'))];
  patch(s.querySelector('[data-sub="pc"]'), pcs.join(), pcs.length ? `<div class="blk"><p class="h"><span>渡すときに使うカード</span><span>2枚まで</span></p><div class="grid2">${pcs.map(c => `<button class="opt ${ui[`pc-${k}-${c}`] ? 'on' : ''}" data-act="pcard" data-b="${id}" data-v="${c}"><span class="wi">${icon(c)}${CARDS[c].n}</span></button>`).join('')}</div></div>` : '');
  const busy = !!sending[k];
  patch(s.querySelector('[data-sub="go"]'), String(busy), `<button class="go" data-act="pass" data-b="${id}" ${busy ? 'disabled' : ''}>${busy ? '送信中' : '渡す'}</button>`);
  const m = mult(), e = earned(b);
  s.querySelector('[data-live="earn"]').textContent = '+' + e * m;
  s.querySelector('[data-live="risk"]').textContent = `いま爆発すると ${M}${(3 + 2 * e) * m}`;
  const pk = V.peek && V.peek.b === id ? V.peek : null;
  s.querySelector('[data-live="peek"]').textContent = pk ? `のぞき見:残り ${pk.remain}秒` : '';
}

/* ---------- 持っていないとき ---------- */
function idleTarget() { const l = live().filter(b => b.holder !== uid); if (!l.length) return null; return l.find(b => b.id === ui.ib) || l[0]; }
const idleHTML = b => `<p class="st dg">${esc(nm(b.holder))}が<br>持っています</p><p class="mu">ほかの人のカード あと${2 - b.idle}回</p>`;
const idleListHTML = l => `<div class="ibl">${l.map(b => `<p><span>爆弾${S.bombs.findIndex(x => x.id === b.id) + 1}</span><b>${esc(nm(b.holder))}</b>が持っています<em>カード あと${2 - b.idle}回</em></p>`).join('')}</div>`;
function handHTML() {
  const cards = myCards(), tb = S.phase === 'play' ? idleTarget() : null, l = live().filter(b => b.holder !== uid);
  const sw = l.length > 1 ? `<span class="sw">${l.map(b => `<button class="${tb && tb.id === b.id ? 'on' : ''}" data-act="ib" data-v="${b.id}">爆弾${S.bombs.findIndex(x => x.id === b.id) + 1}</button>`).join('')}</span>` : '';
  if (!cards.length) return `<div class="hand"><div class="h"><span>手札</span></div><p class="empty">手札はありません。爆発するともらえます(最終ラウンドを除く)。</p></div>`;
  const others = S.players.filter(p => p.id !== uid);
  const act = c => {
    const holding = live().some(b => b.holder === uid);
    if (CARDS[c].w !== 'idle') return `<p class="x">${c === 'migawari' || c === 'michizure' ? '爆発したときに画面に出ます。' : holding ? '上の画面から使えます。' : '爆弾を持っているときに使えます。'}</p>`;
    if (holding && l.length === 0) return `<p class="x">ほかの人が爆弾を持っているときに使えます。</p>`;
    if (!tb) return `<p class="x">ほかの人が爆弾を持っているときに使えます。</p>`;
    if (tb.idle >= 2) return `<p class="x">この爆弾では、もう使えません(2回まで)。</p>`;
    const id = tb.id;
    if (c === 'yokodori') return `<div class="row"><button class="ol" data-act="steal" data-b="${id}">${esc(nm(tb.holder))}から奪う</button></div>`;
    if (c === 'yogen') {
      if ((V.yogen || []).includes(id)) return `<p class="x">この爆弾では予言済みです。</p>`;
      return `<div class="chips">${others.filter(p => p.id !== tb.holder).map(p => `<button class="chip ${ui['yg-' + id] === p.id ? 'on' : ''}" data-act="pickc" data-k="yg-${id}" data-v="${p.id}">${esc(p.name)}</button>`).join('')}</div><div class="row"><button class="ol" data-act="yogen" data-b="${id}">予言する</button></div>`;
    }
    if (c === 'oishitsumon') {
      if (tb.extra) return `<p class="x">この爆弾には、もう追い質問が付いています。</p>`;
      if (!ui['oo-' + id]) ui['oo-' + id] = choices(level(), tb.q);
      return `<div style="margin-top:6px">${choiceList('oc-' + id, ui['oo-' + id], 'oc', id)}</div><div class="own" data-own="o${id}" ${ui['oc-' + id] === 'own' ? '' : 'hidden'}><textarea rows="2" maxlength="80" data-k="on-${id}" placeholder="5文字以上"></textarea><p class="warn" data-w="on-${id}"></p></div><div class="row"><button class="ol" data-act="oi" data-b="${id}">${esc(nm(tb.holder))}に足す</button></div>`;
    }
    if (c === 'toushi') return `<div class="chips">${others.map(p => `<button class="chip ${ui['ts-' + id] === p.id ? 'on' : ''}" data-act="pickc" data-k="ts-${id}" data-v="${p.id}">${esc(p.name)}</button>`).join('')}</div><div class="row"><button class="ol" data-act="toushi" data-b="${id}">手札を見る</button></div>`;
    return '';
  };
  return `<div class="hand"><div class="h"><span>手札</span>${sw}</div>${cards.map(c => `<div class="fd"><span class="tag">${icon(c)}<span class="vn">${CARDS[c].n}</span></span><div><p class="w">${WHEN[CARDS[c].w]}</p><p class="d">${CARDS[c].d}</p>${S.phase === 'play' ? act(c) : ''}</div></div>`).join('')}</div>`;
}

/* ---------- 画面全体 ---------- */
function rank() { const s = Object.entries(S.scores || {}).sort((a, b) => b[1] - a[1]); return s.findIndex(x => x[0] === uid) + 1; }
function typeHTML() {
  const d = (S.diag || []).find(x => x.id === uid); if (!d) return `<p class="st dg">診断の対象外です</p>`;
  const T = TYPES[d.code];
  const ax = AX.map(a => `<div class="axr"><div class="axl"><span class="${d.code.includes(a.c[0]) ? 'on' : ''}">${a.l[0]}</span><span class="${d.code.includes(a.c[1]) ? 'on' : ''}">${a.l[1]}</span></div><div class="axb"><i style="left:${(d.code.includes(a.c[0]) ? 50 * (1 - d.pos[a.k]) : 50 + 50 * (1 - d.pos[a.k])).toFixed(0)}%"></i></div></div>`).join('');
  return `<p class="mu" style="margin-top:24px">あなたの遊び方</p><div class="tyh">${tyIll(d.code, 'ph')}<div><p class="tyc dg">${d.code}</p><p class="tyn dg">${T.n}</p></div></div><div class="axs">${ax}</div><section class="tyx"><h4>遊び方</h4><p>${T.d}</p><h4>強み</h4><p>${T.s}</p><h4>気をつけたいこと</h4><p>${T.w}</p><h4>相性</h4><div class="pair"><div>${tyIll(T.good, 'sm')}<p><span>よい</span>${TYPES[T.good].n}</p></div><div>${tyIll(T.bad, 'sm')}<p><span>手ごわい</span>${TYPES[T.bad].n}</p></div></div></section>
   <dl class="tys"><div><dt>1回に持っていた時間</dt><dd>平均 ${d.hold}秒</dd></div><div><dt>攻めのカード</dt><dd>${d.off}回</dd></div><div><dt>自分で書いた質問</dt><dd>${d.ownQ}回</dd></div><div><dt>いちばん多く渡した相手</dt><dd>${d.top ? esc(nm(d.top)) : 'なし'}</dd></div><div><dt>爆発</dt><dd>${d.boom}回</dd></div></dl>${d.few ? '<p class="mu">渡した回数が少ないため、参考程度の結果です。</p>' : ''}`;
}
function ctlHTML() {
  if (!S || S.ctrl !== uid) return '';
  const b = (a, l, main) => `<button class="${main ? 'cg' : 'cs'}" data-host="${a}">${l}</button>`;
  return ({
    lobby: b('start', S.players.length < 3 ? '3人以上で開始できます' : 'はじめる', S.players.length >= 3),
    play: `<button class="ab" data-abort>この爆弾を中止</button>`,
    reveal: b('next', '次へ', 1),
    score: b('round', S.round >= S.set.rounds ? '最終ラウンドへ' : '次のラウンドへ', 1),
    end: b('again', 'もう一度') + b('diag', '性格診断を見る', 1),
    type: b('lobby', window.BK_SOLO ? '設定に戻る' : '待合に戻る') + b('again', 'もう一度', 1)
  })[S.phase] || '';
}
function render() {
  if (!joined) return;
  const body = document.body;
  if (closed || !S) { patch($('#pm'), 'closed', `<p class="st dg">部屋が閉じられました</p><p class="mu">テレビの画面が閉じられたか、通信が切れています。</p><p class="mu" style="margin-top:20px"><a href="${window.BK_SOLO ? 'solo.html' : 'phone.html' + location.search}">${window.BK_SOLO ? '最初の画面に戻る' : '参加画面に戻る'}</a></p>`); ['#pn', '#pc', '#pctl'].forEach(s => patch($(s), '', '')); return; }
  const me = P(uid), t = now();
  const victim = S.phase === 'boom' && S.boom && S.boom.victim === uid; if (victim && !body.classList.contains('red')) buzz([300, 80, 300]); body.classList.toggle('red', victim);
  patch($('#sb'), JSON.stringify([me && me.name, S.round, S.final, S.room]), `<b>${esc(me ? me.name : '')}</b><span>${window.BK_SOLO ? 'スマホだけで試す' : `部屋 ${esc(S.room)}`}${S.round ? ` ・ ${S.final ? '最終ラウンド' : `第${S.round}ラウンド`}` : ''}</span>`);
  // お知らせ
  if (V.note && V.note.id !== noteSeen) { noteSeen = V.note.id; noteShow = V.note.text; noteUntil = t + 5000; Object.keys(sending).forEach(k => delete sending[k]); }
  const notes = []; if (t < noteUntil) notes.push(`<p class="note">${esc(noteShow)}</p>`);
  if (V.seen) notes.push(`<p class="note"><b>透視</b>${esc(nm(V.seen.id))}の手札は ${V.seen.cards && V.seen.cards.length ? V.seen.cards.map(c => CARDS[c].n).join('、') : 'なし'}</p>`);
  patch($('#pn'), notes.join(), notes.join(''));
  const pm = $('#pm');
  if (!me && S.phase !== 'lobby') { patch(pm, 'out', `<p class="st dg">ゲーム中です</p><p class="mu">いまのゲームが終わって待合に戻ると、参加できます。</p>`); patch($('#pc'), '', ''); patch($('#pctl'), '', ''); return; }
  if (S.phase === 'play') {
    const l = live(), mk = 'play' + l.map(b => b.id + ':' + (b.holder === uid ? 'H' + b.hseq : 'I')).join(',');
    const mine = l.filter(b => b.holder === uid), idle = l.filter(b => b.holder !== uid);
    const mk2 = mk + (idle.length ? '|idle' : '');
    if (pm.dataset.key !== mk2 && !composingIn(pm)) { pm.innerHTML = mine.map(b => `<section data-sec="${b.id}"></section>`).join('') + (idle.length ? '<section data-sec="idle"></section>' : ''); pm.dataset.key = mk2; }
    for (const b of mine) { const s = pm.querySelector(`[data-sec="${b.id}"]`); if (!s) continue; if (patch(s, 'H' + hk(b), holdHTML(b))) buzz(180); holdSubs(s, b); }
    const si = pm.querySelector('[data-sec="idle"]');
    if (si) patch(si, 'I' + idle.map(b => b.id + b.holder + b.idle).join(','), S.bombs.length > 1 ? (mine.length ? '' : '<p class="st dg">最終ラウンド</p>') + idleListHTML(idle) : idleHTML(idle[0]));
  } else {
    let k = S.phase, h = '';
    if (S.phase === 'lobby') { k += JSON.stringify(S.players);
      h = `<p class="st dg">参加しました</p><p class="mu">テレビで開始されるのを待っています。</p><div class="lobbyp"><p class="h">参加者 ${S.players.length}人</p>${S.players.map(p => `<span class="${p.on ? '' : 'off'}">${esc(p.name)}${p.id === S.ctrl ? '<i>幹事</i>' : ''}</span>`).join('')}</div>${S.ctrl === uid ? '<p class="mu">あなたは幹事です。下のボタンで、ゲームの開始や進行ができます。</p>' : ''}`; }
    else if (S.phase === 'intro') h = `<p class="st dg">まもなく点火</p><p class="mu">テレビを見てください。</p>`;
    else if (S.phase === 'boom') {
      const B = S.boom; k += B.victim + B.stage + JSON.stringify(V.boomOpts);
      if (victim) { const o = V.boomOpts || []; h = `<p class="st dg">あなたの手元で爆発</p>${o.length ? `<p class="cdn" data-live="boom">5</p><p class="mu" style="color:#fff">秒以内なら、最後の手段が使えます</p><div class="bo">${o.map(c => `<button data-act="boom" data-v="${c}"><span class="wi">${icon(c)}${CARDS[c].n}を使う</span></button><p>${CARDS[c].d}</p>`).join('')}</div>` : '<p class="mu" style="color:#fff;margin-top:14px">使えるカードはありません。テレビを見てください。</p>'}`; }
      else h = `<p class="st dg">${esc(nm(B.victim))}の<br>手元で爆発</p><p class="mu">最後の手段を待っています。</p>`;
    } else if (S.phase === 'reveal') h = `<p class="st dg">暴露中</p><p class="mu">テレビを見てください。</p>`;
    else if (S.phase === 'type') { k += 't'; h = typeHTML(); }
    else { const sc = (S.scores || {})[uid] || 0; k += sc; h = `<p class="mu" style="margin-top:24px">あなたの合計</p><p class="big">${sc < 0 ? M + (-sc) : sc}<small style="font-size:18px;margin-left:4px">点</small></p><p class="mu">${S.players.length}人中 ${rank()}位</p>`; }
    patch(pm, k, h);
    const bc = pm.querySelector('[data-live="boom"]'); if (bc && S.boom) bc.textContent = Math.max(0, S.boom.left - Math.floor((now() - pubAt) / 1000));
  }
  const tb = S.phase === 'play' ? idleTarget() : null, hideHand = victim || ['type', 'lobby', 'end'].includes(S.phase);
  patch($('#pc'), hideHand ? 'none' : JSON.stringify([S.phase, myCards(), tb && [tb.id, tb.holder, tb.idle, !!tb.extra, (V.yogen || []).includes(tb.id)], live().filter(b => b.holder !== uid).length]), hideHand ? '' : handHTML());
  patch($('#pctl'), JSON.stringify([S.phase, S.ctrl === uid, S.players.length, S.round]), ctlHTML());
}

/* ---------- 操作 ---------- */
function setChoice(t, key, ownSel) {
  const v = t.dataset.i; ui[key] = v;
  t.parentElement.querySelectorAll(`[data-act="${t.dataset.act}"]`).forEach(x => x.classList.toggle('on', x === t));
  const own = document.querySelector(ownSel); if (own) { own.hidden = v !== 'own'; if (v === 'own') { const ta = own.querySelector('textarea'); if (ta) ta.focus(); } }
}
function sendDraft(b) {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => { const k = hk(b); net.setDraft({ b: b.id, h: b.hseq, ans: ui['ans-' + k] || '', ex: ui['ex-' + k] || '' }); }, 400);
}
document.addEventListener('compositionstart', () => composing = true);
document.addEventListener('compositionend', () => composing = false);
document.addEventListener('input', e => {
  const el = e.target; if (!el.dataset || !el.dataset.k) return; ui[el.dataset.k] = el.value; warn(el);
  if (el.dataset.f && S) { const b = live().find(x => x.id === el.dataset.b); if (b && b.holder === uid) sendDraft(b); }
});
let abortArm = 0;
document.addEventListener('click', e => {
  const ab = e.target.closest('[data-abort]');
  if (ab) { if (now() - abortArm < 3000) { send({ t: 'host', a: 'abort' }); abortArm = 0; ab.textContent = 'この爆弾を中止'; ab.classList.remove('armed'); } else { abortArm = now(); ab.textContent = 'もう一度押すと中止します'; ab.classList.add('armed'); setTimeout(() => { if (now() - abortArm >= 2900) { ab.textContent = 'この爆弾を中止'; ab.classList.remove('armed'); } }, 3000); } return; }
  const h = e.target.closest('[data-host]'); if (h) { send({ t: 'host', a: h.dataset.host }); h.disabled = true; setTimeout(() => { h.disabled = false; }, 1500); return; }
  const t = e.target.closest('[data-act]'); if (!t || !S) return;
  const act = t.dataset.act, b = (S.bombs || []).find(x => x.id === t.dataset.b), cards = myCards();
  if (act === 'boom') { send({ t: 'boom', c: t.dataset.v }); t.disabled = true; return; }
  if (act === 'ib') { ui.ib = t.dataset.v; render(); return; }
  if (act === 'pickc') { ui[t.dataset.k] = t.dataset.v; t.parentElement.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === t)); return; }
  if (S.phase !== 'play' || !b || b.done) return;
  const k = hk(b);
  const err = m => { const el = document.querySelector(`[data-err="${b.id}"]`); if (el) el.textContent = m; };
  if (act === 'to') { ui['to-' + k] = t.dataset.v; t.parentElement.querySelectorAll('.opt').forEach(x => x.classList.toggle('on', x === t)); return; }
  if (act === 'qc') { setChoice(t, 'qc-' + k, `[data-own="${k}"]`); return; }
  if (act === 'oc') { setChoice(t, 'oc-' + b.id, `[data-own="o${b.id}"]`); return; }
  if (act === 'pcard') { const kk = `pc-${k}-${t.dataset.v}`; ui[kk] = !ui[kk]; t.classList.toggle('on', !!ui[kk]); return; }
  if (act === 'ins') {
    const kk = (t.dataset.f === 'ans' ? 'ans-' : 'ex-') + k, ta = document.querySelector(`[data-k="${kk}"]`); if (!ta) return;
    const s = ta.selectionStart ?? ta.value.length, v = (ta.value.slice(0, s) + t.dataset.v + ta.value.slice(ta.selectionEnd ?? s)).slice(0, 120);
    ta.value = v; ui[kk] = v; ta.focus(); const p = s + t.dataset.v.length; try { ta.setSelectionRange(p, p); } catch (x) { } warn(ta); sendDraft(b); return;
  }
  if (act === 'pass' && b.holder === uid) {
    const ans = ui['ans-' + k] || '', ex = ui['ex-' + k] || '', to = ui['to-' + k], qc = ui['qc-' + k];
    const q = qc === 'own' ? (ui['nq-' + k] || '') : (qc != null ? ui['qo-' + k][+qc] : '');
    const pc = Object.keys(CARDS).filter(c => ui[`pc-${k}-${c}`] && cards.includes(c));
    if (!valid(ans)) return err('答えは5文字以上で書いてください。同じ文字だけの答えは送れません。');
    if (b.extra && !valid(ex)) return err('追い質問にも5文字以上で答えてください。');
    if (!to || !passTargets(b, uid).includes(to)) return err('渡す相手を選んでください。');
    if (qc == null) return err('その人への質問を選んでください。');
    if (!valid(q)) return err('自分で書く質問は5文字以上にしてください。');
    if (pc.length > 2) return err('一度に使えるカードは2枚までです。');
    sending[k] = true; send({ t: 'pass', b: b.id, h: b.hseq, to, q, own: qc === 'own', cards: pc, ans, ex }); render(); return;
  }
  if (act === 'ret') { send({ t: 'ret', b: b.id }); t.disabled = true; return; }
  if (act === 'peek') { send({ t: 'peek', b: b.id }); t.disabled = true; return; }
  if (act === 'steal') { send({ t: 'steal', b: b.id }); t.disabled = true; return; }
  if (act === 'yogen') { const v = ui['yg-' + b.id]; if (!v) { noteShow = '予言する相手を選んでください。'; noteUntil = now() + 4000; render(); return; } send({ t: 'yogen', b: b.id, target: v }); t.disabled = true; return; }
  if (act === 'oi') {
    const oc = ui['oc-' + b.id]; if (oc == null) { noteShow = '追い質問を選んでください。'; noteUntil = now() + 4000; render(); return; }
    const v = oc === 'own' ? (ui['on-' + b.id] || '') : ui['oo-' + b.id][+oc];
    if (!valid(v)) { noteShow = '自分で書く追い質問は5文字以上にしてください。'; noteUntil = now() + 4000; render(); return; }
    send({ t: 'oi', b: b.id, q: v }); t.disabled = true; return;
  }
  if (act === 'toushi') { const v = ui['ts-' + b.id]; if (!v) { noteShow = '見る相手を選んでください。'; noteUntil = now() + 4000; render(); return; } send({ t: 'toushi', b: b.id, target: v }); t.disabled = true; }
});

/* ---------- 参加 ---------- */
function joinForm(msg) {
  const saved = (() => { try { return JSON.parse(localStorage.getItem('bk-join') || '{}'); } catch (e) { return {}; } })();
  $('#pm').innerHTML = `<h1 class="dg jt">ばくだん暴露</h1><p class="mu">テレビに出ている部屋コードと、あなたの名前を入れてください。</p>
   <form id="jf" class="jf" novalidate><label><span>部屋コード</span><input name="code" maxlength="4" autocomplete="off" autocapitalize="characters" value="${esc(params.get('room') || saved.code || '')}"></label>
   <label><span>名前(8文字まで)</span><input name="name" maxlength="8" autocomplete="nickname" value="${esc(saved.name || '')}"></label>
   <p class="err">${esc(msg || '')}</p><button class="go" type="submit">参加する</button></form>`;
  $('#jf').addEventListener('submit', async e => {
    e.preventDefault(); const f = e.target, code = f.code.value.trim().toUpperCase(), name = f.name.value.trim().slice(0, 8);
    if (code.length !== 4) return joinForm('部屋コードは4文字です。');
    if (!name) return joinForm('名前を入れてください。');
    f.querySelector('button').disabled = true; f.querySelector('button').textContent = '接続中';
    const r = await doJoin(code, name);
    if (!r.ok) return joinForm(r.err);
  });
}
async function doJoin(code, name) {
  const r = await net.join(code, name);
  if (!r.ok) return r;
  try { localStorage.setItem('bk-join', JSON.stringify({ code, name })); } catch (x) { }
  joined = true; $('#pm').innerHTML = ''; delete $('#pm').dataset.key;
  net.onPub(v => { if (v == null) { if (S) closed = true; S = null; } else { S = v; S.players = S.players || []; S.bombs = S.bombs || []; pubAt = now(); closed = false; } render(); });
  net.onPriv(v => { V = v || {}; render(); });
  return r;
}
(async () => {
  try { net = await createNet(); }
  catch (e) { $('#pm').innerHTML = `<p class="st dg">接続できませんでした</p><p class="mu">${esc(e.message || e)}</p>`; return; }
  uid = net.uid;
  if (net.mode === 'local') document.body.classList.add('local');
  if (window.BK_SOLO) { while (!window.BK_ROOM) await new Promise(r => setTimeout(r, 50)); await doJoin(window.BK_ROOM, window.BK_SOLO.name); }
  else joinForm();
  setInterval(render, 250);
})();
