// 効果音。音源ファイルは使わず、ブラウザの中でその場で合成する。
// 導火線のパチパチ音は、残り時間とは無関係な間隔で鳴らす(残り時間の手がかりにならないように)。
export function createSound(opts = {}) {
  let ctx = null, master = null, verb = null, noise = null, on = true;
  const vol = opts.volume ?? 0.8;
  const rnd = (a, b) => a + Math.random() * (b - a);

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return false; }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = .004; comp.release.value = .2;
    master = ctx.createGain(); master.gain.value = vol;
    master.connect(comp); comp.connect(ctx.destination);
    // ノイズ(2秒分)
    const len = ctx.sampleRate * 2, nb = ctx.createBuffer(1, len, ctx.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noise = nb;
    // 残響(部屋鳴り)。減衰するノイズを畳み込みに使う
    const il = Math.floor(ctx.sampleRate * 1.8), ib = ctx.createBuffer(2, il, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const x = ib.getChannelData(c); for (let i = 0; i < il; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / il, 3.2); }
    verb = ctx.createConvolver(); verb.buffer = ib;
    const vg = ctx.createGain(); vg.gain.value = .32; verb.connect(vg); vg.connect(master);
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }
  const ready = () => on && ctx && ctx.state === 'running';
  const T = () => ctx.currentTime + .005;
  function env(g, t, a, peak, d) {
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, .0002), t + a);
    g.gain.exponentialRampToValueAtTime(.0001, t + a + d);
  }
  function src(t, dur) { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; s.start(t, Math.random() * 1.5); s.stop(t + dur + .05); return s; }
  function out(node, wet = 0) { node.connect(master); if (wet) { const w = ctx.createGain(); w.gain.value = wet; node.connect(w); w.connect(verb); } }
  function filt(type, f, q = .7) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  function drive(k = 18) {
    const ws = ctx.createWaveShaper(), n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; c[i] = (1 + k) * x / (1 + k * Math.abs(x)); }
    ws.curve = c; ws.oversample = '2x'; return ws;
  }

  // 導火線のパチパチ。1回分の小さな破裂音
  function sizzle() {
    if (!ready()) return;
    const t = T(), pop = Math.random() < .14;
    const n = src(t, .09), f = filt('bandpass', pop ? rnd(1200, 2200) : rnd(3200, 7000), pop ? 1.4 : .9), g = ctx.createGain();
    env(g, t, .002, pop ? rnd(.10, .16) : rnd(.025, .06), pop ? .045 : rnd(.015, .05));
    n.connect(f); f.connect(g); out(g, pop ? .15 : 0);
  }
  // マッチを擦って火が付く音(ラウンド開始)
  function ignite() {
    if (!ready()) return;
    const t = T();
    const n = src(t, .32), f = filt('bandpass', 900, 1.1), g = ctx.createGain();
    f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(4200, t + .14);
    env(g, t, .01, .32, .2); n.connect(f); f.connect(g); out(g, .1);
    const n2 = src(t + .12, .9), f2 = filt('lowpass', 2400, .5), g2 = ctx.createGain();
    f2.frequency.setValueAtTime(2400, t + .12); f2.frequency.exponentialRampToValueAtTime(600, t + .9);
    env(g2, t + .12, .04, .22, .7); n2.connect(f2); f2.connect(g2); out(g2, .3);
  }
  // 爆弾を渡したときの風切り音
  function pass() {
    if (!ready()) return;
    const t = T(), n = src(t, .4), f = filt('bandpass', 500, 1.3), g = ctx.createGain();
    f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(2600, t + .16); f.frequency.exponentialRampToValueAtTime(900, t + .36);
    env(g, t, .12, .24, .22); n.connect(f); f.connect(g); out(g, .12);
  }
  // カードが使われたときの金属的な一打
  function card() {
    if (!ready()) return;
    const t = T();
    [[784, .14], [1176, .09], [2093, .05], [2637, .03]].forEach(([fr, pk]) => {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = fr * rnd(.997, 1.003);
      env(g, t, .003, pk, rnd(.7, 1.1)); o.connect(g); out(g, .45); o.start(t); o.stop(t + 1.3);
    });
    const n = src(t, .04), f = filt('highpass', 3000), g = ctx.createGain(); env(g, t, .001, .12, .03); n.connect(f); f.connect(g); out(g);
  }
  // 爆発:低い衝撃+歪んだ轟音+破片+部屋の残響
  function boom(scale = 1) {
    if (!ready()) return;
    const t = T();
    const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(30, t + .9);
    env(og, t, .004, .95 * scale, 1.1); o.connect(og); out(og); o.start(t); o.stop(t + 1.3);
    const n = src(t, 2.4), lp = filt('lowpass', 4000, .3), dr = drive(22), g = ctx.createGain();
    lp.frequency.setValueAtTime(4000, t); lp.frequency.exponentialRampToValueAtTime(140, t + 1.7);
    env(g, t, .008, .7 * scale, 2.0); n.connect(lp); lp.connect(dr); dr.connect(g); out(g, .55);
    const c = src(t, .06), hp = filt('highpass', 1800), cg = ctx.createGain(); env(cg, t, .001, .5 * scale, .05); c.connect(hp); hp.connect(cg); out(cg, .2);
    for (let i = 0; i < 7; i++) {
      const tt = t + rnd(.15, 1.1), d = src(tt, .05), bp = filt('bandpass', rnd(1500, 5000), 2), dg = ctx.createGain();
      env(dg, tt, .001, rnd(.03, .08) * scale, rnd(.02, .05)); d.connect(bp); bp.connect(dg); out(dg, .3);
    }
  }
  // 暴露の「ドン」
  function reveal() {
    if (!ready()) return;
    const t = T(), o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(62, t + .35);
    env(g, t, .003, .7, .5); o.connect(g); out(g, .35); o.start(t); o.stop(t + .7);
    const n = src(t, .08), f = filt('bandpass', 1800, .8), ng = ctx.createGain(); env(ng, t, .001, .22, .07); n.connect(f); f.connect(ng); out(ng, .3);
  }
  // 結果発表の和音
  function fanfare() {
    if (!ready()) return;
    const t = T();
    [523.25, 659.25, 783.99, 1046.5].forEach((fr, i) => {
      const o = ctx.createOscillator(), lp = filt('lowpass', 2400, .5), g = ctx.createGain(); o.type = 'triangle'; o.frequency.value = fr;
      env(g, t + i * .11, .01, .16, 1.4 - i * .1); o.connect(lp); lp.connect(g); out(g, .5); o.start(t + i * .11); o.stop(t + 2);
    });
  }
  // 画面のボタンを押したときの小さな音
  function tap() {
    if (!ready()) return;
    const t = T(), o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(1400, t); o.frequency.exponentialRampToValueAtTime(900, t + .05);
    env(g, t, .002, .06, .05); o.connect(g); out(g); o.start(t); o.stop(t + .1);
  }
  return {
    init, sizzle, ignite, pass, card, boom, reveal, fanfare, tap,
    get on() { return on; }, set on(v) { on = !!v; },
    get unlocked() { return !!ctx && ctx.state === 'running'; }
  };
}
export const buzz = p => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { } };
