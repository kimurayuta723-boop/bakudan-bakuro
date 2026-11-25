// 通信部分。Firebase Realtime Database か、1台のパソコンの中だけで動く試験モード(BroadcastChannel)のどちらかを使う。
// テレビ(進行役)が状態を書き込み、スマホは自分の操作だけを送る。
import { FIREBASE_CONFIG } from './config.js';

const FB = '10.12.2';
const CODE_CHARS = 'ACDEFHJKLMNPRTUVWXY'; // 読み間違えやすい文字を除く

export const isLocal = () => new URLSearchParams(location.search).has('local') || !FIREBASE_CONFIG.apiKey;
const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

export async function createNet() { return isLocal() ? localNet() : firebaseNet(); }

/* ---------------- 試験モード ---------------- */
function localNet() {
  let uid = sessionStorage.getItem('bk-uid');
  if (!uid) { uid = 'u' + Math.random().toString(36).slice(2, 9); sessionStorage.setItem('bk-uid', uid); }
  const ch = new BroadcastChannel('bakudan-local');
  const post = m => ch.postMessage(m);
  let code = null, isHost = false;
  const cb = {};
  // 進行役の持ち物
  const players = {}, seen = {}, drafts = {}, privs = {};
  let lastPub = null;
  ch.onmessage = ({ data: m }) => {
    if (!code || m.room !== code) return;
    if (isHost) {
      if (m.k === 'join') { if (!players[m.u]) players[m.u] = { name: m.name, t: Date.now() }; else players[m.u].name = m.name; seen[m.u] = Date.now(); cb.players && cb.players({ ...players }); post({ room: code, k: 'joined', u: m.u }); }
      if (m.k === 'hello') { if (lastPub) post({ room: code, k: 'pub', v: lastPub }); if (privs[m.u]) post({ room: code, k: 'priv', u: m.u, v: privs[m.u] }); }
      if (m.k === 'act') cb.act && cb.act(m.a);
      if (m.k === 'draft') { drafts[m.u] = m.d; cb.drafts && cb.drafts({ ...drafts }); }
      if (m.k === 'ping') seen[m.u] = Date.now();
    } else {
      if (m.k === 'pub') cb.pub && cb.pub(m.v);
      if (m.k === 'priv' && m.u === uid) cb.priv && cb.priv(m.v);
      if (m.k === 'joined' && m.u === uid && cb.joined) cb.joined();
      if (m.k === 'closed') cb.pub && cb.pub(null);
    }
  };
  return {
    mode: 'local', uid,
    async createRoom() { code = newCode(); isHost = true;
      setInterval(() => { const t = Date.now(); cb.online && cb.online(Object.keys(seen).filter(u => t - seen[u] < 6000)); }, 1000);
      addEventListener('beforeunload', () => post({ room: code, k: 'closed' }));
      return code; },
    setPub(v) { lastPub = v; post({ room: code, k: 'pub', v }); },
    setPriv(u, v) { privs[u] = v; post({ room: code, k: 'priv', u, v }); },
    clearDraft(u) { delete drafts[u]; },
    onPlayers(f) { cb.players = f; }, onActions(f) { cb.act = f; }, onDrafts(f) { cb.drafts = f; }, onOnline(f) { cb.online = f; },
    removePlayer(u) { delete players[u]; delete seen[u]; cb.players && cb.players({ ...players }); },
    async closeRoom() { post({ room: code, k: 'closed' }); },
    join(c, name) {
      code = c;
      return new Promise(res => {
        const to = setTimeout(() => { cb.joined = null; res({ ok: false, err: '部屋が見つかりません。コードを確かめてください。' }); }, 2500);
        cb.joined = () => { clearTimeout(to); cb.joined = null;
          setInterval(() => post({ room: code, k: 'ping', u: uid }), 2000);
          post({ room: code, k: 'hello', u: uid }); res({ ok: true }); };
        post({ room: code, k: 'join', u: uid, name });
      });
    },
    onPub(f) { cb.pub = f; if (code) post({ room: code, k: 'hello', u: uid }); },
    onPriv(f) { cb.priv = f; },
    send(a) { post({ room: code, k: 'act', a: { ...a, u: uid } }); },
    setDraft(d) { post({ room: code, k: 'draft', u: uid, d }); }
  };
}

/* ---------------- Firebase ---------------- */
async function firebaseNet() {
  const base = `https://www.gstatic.com/firebasejs/${FB}/`;
  const [{ initializeApp }, { getAuth, signInAnonymously }, D] = await Promise.all([
    import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-database.js')]);
  const app = initializeApp(FIREBASE_CONFIG);
  const auth = getAuth(app);
  await signInAnonymously(auth);
  const uid = auth.currentUser.uid;
  const db = D.getDatabase(app);
  let code = null;
  const R = p => D.ref(db, `rooms/${code}${p ? '/' + p : ''}`);
  return {
    mode: 'firebase', uid,
    async createRoom() {
      for (let i = 0; i < 20; i++) {
        code = newCode();
        const s = await D.get(R('meta'));
        if (!s.exists()) break;
      }
      await D.set(R('meta'), { host: uid, created: D.serverTimestamp() });
      // テレビの接続が切れたら、部屋ごと(質問・下書きを含めて)消す
      D.onDisconnect(R()).remove();
      return code;
    },
    setPub(v) { return D.set(R('pub'), v); },
    setPriv(u, v) { return D.set(R('priv/' + u), v); },
    clearDraft(u) { return D.remove(R('draft/' + u)); },
    onPlayers(f) { D.onValue(R('players'), s => f(s.val() || {})); },
    onActions(f) { D.onChildAdded(R('act'), s => { f(s.val()); D.remove(s.ref); }); },
    onDrafts(f) { D.onValue(R('draft'), s => f(s.val() || {})); },
    onOnline(f) { D.onValue(R('online'), s => f(Object.keys(s.val() || {}))); },
    removePlayer(u) { return D.remove(R('players/' + u)); },
    async closeRoom() { await D.remove(R()); },
    async join(c, name) {
      code = c;
      const m = await D.get(R('meta'));
      if (!m.exists()) return { ok: false, err: '部屋が見つかりません。コードを確かめてください。' };
      await D.set(R('players/' + uid), { name, t: D.serverTimestamp() });
      const on = R('online/' + uid);
      D.onValue(D.ref(db, '.info/connected'), s => { if (s.val()) { D.onDisconnect(on).remove(); D.set(on, true); } });
      return { ok: true };
    },
    onPub(f) { D.onValue(R('pub'), s => f(s.val())); },
    onPriv(f) { D.onValue(R('priv/' + uid), s => f(s.val() || {})); },
    send(a) { return D.push(R('act'), { ...a, u: uid }); },
    setDraft(d) { return D.set(R('draft/' + uid), d); }
  };
}
