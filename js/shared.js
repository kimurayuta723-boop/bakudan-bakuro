// ばくだん暴露:テレビとスマホで共通のデータと部品
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rnd=(a,b)=>a+Math.random()*(b-a);
const pick=a=>a[Math.floor(Math.random()*a.length)];
const shuffle=a=>{a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
const now=()=>performance.now();
const M='−';
const WHEN={recv:'受け取ってから10秒以内',boom:'爆発した瞬間',pass:'渡すとき',idle:'持っていないとき',hold:'持っている間'};
const CARDS={
 uchikaeshi:{n:'打ち返し',set:1,w:'recv',d:'答えずに、渡してきた人へ同じ質問のまま返す。返された人は、自分が選んだ質問に答えることになる。'},
 migawari:{n:'身代わり',set:1,w:'boom',d:'渡してきた人が代わりに爆発し、その人の答えが出る。自分の稼ぎは守られる。'},
 tenka:{n:'点火',set:1,w:'pass',d:'導火線の残り時間をこっそり縮める。使ったことは誰にも分からない。'},
 fuuin:{n:'封印',set:1,w:'pass',d:'受け取った人は、この爆弾ではカードを使えない。'},
 yokodori:{n:'横取り',set:1,w:'idle',d:'持っている人から爆弾を奪う。奪った爆弾が爆発すると、奪われた人に+2。'},
 yogen:{n:'予言',set:1,w:'idle',d:'この爆弾で爆発する人をこっそり予言する。当たれば+3。今持っている人は選べない。'},
 oishitsumon:{n:'追い質問',set:1,w:'idle',d:'持っている人に質問を足す。両方答えないと渡せず、爆発したら追い質問の答えが出る。'},
 nisefuuin:{n:'ニセ封印',set:2,w:'pass',d:'封印として表示されるが効果はない。本物かどうかは、受け取った人が試すまで分からない。'},
 michizure:{n:'道連れ',set:2,w:'boom',d:'爆発の原因になった相手も一緒に爆発させる。自分の減点は消えない。'},
 nozokimi:{n:'のぞき見',set:2,w:'hold',d:'残り時間を自分だけ3秒間見る。使ったことは誰にも分からない。'},
 toushi:{n:'透視',set:2,w:'idle',d:'1人を選び、手札の中身をこっそり見る。'}
};
const Q={
 1:['この中で一番、寝坊して約束に遅れそうなのは?','この中で一番、方向音痴なのは?','この中で一番、部屋が散らかっていそうなのは?','この中で一番、話が長いのは?','この中で一番、写真写りを気にしすぎるのは?','この中で一番、すぐ人に流されるのは?','この中で一番、財布を忘れてきそうなのは?','この中で一番、三日坊主なのは?','この中で一番、LINEの既読無視が多いのは?','この中で一番、自慢話が多いのは?','この中で一番、酔うと同じ話をくり返すのは?','この中で一番、店員さんに強気なのは?'],
 2:['この中で一番、秘密を守れなさそうなのは?','この中で一番、見栄を張っていそうなのは?','この中で一番、話を盛っていそうなのは?','この中で一番、人の話を聞いていないのは?','この中で一番、ドタキャンが多そうなのは?','この中で一番、モテると勘違いしていそうなのは?','この中で一番、お金にルーズそうなのは?','この中で一番、酔うと面倒なのは?','この中で一番、遅刻の言い訳がうまいのは?','この中で一番、SNSに盛った写真を載せていそうなのは?','この中で一番、割り勘で得をしようとしそうなのは?','この中で一番、怒らせると根に持つのは?'],
 3:['この中で一番、浮気をしそうなのは?','この中で一番、お金を貸したら返ってこなさそうなのは?','この中で一番、裏で悪口を言っていそうなのは?','この中で一番、平気で嘘をつきそうなのは?','この中で一番、元恋人を引きずっていそうなのは?','この中で一番、友達を裏切りそうなのは?','この中で一番、怪しい儲け話に乗りそうなのは?','この中で一番、結婚式のスピーチを頼みたくないのは?','この中で一番、二股をかけていそうなのは?','この中で一番、損得だけで人と付き合っていそうなのは?','この中で一番、いつか週刊誌に載りそうなのは?','この中で一番、恋人のスマホをこっそり見ていそうなのは?']
};
const STRONG={2:['見栄','盛っ','ルーズ','ドタキャン','嘘','根に持'],3:['浮気','二股','裏切','悪口','借金','元恋人','週刊誌','スマホを','儲け話'],4:['ブス','ハゲ','デブ','キモ','死ね','クズ']};
/* ---------- 絵柄(64×64の線画。朱は1か所だけ) ---------- */
const BM=(x,y,r,sp=true)=>`<circle cx="${x}" cy="${y}" r="${r}"/><path d="M${(x+r*.62).toFixed(1)} ${(y-r*.78).toFixed(1)}q3 -6 8 -6"/>${sp?`<circle class="a" cx="${(x+r*.62+8).toFixed(1)}" cy="${(y-r*.78-6).toFixed(1)}" r="2.4"/>`:''}`;
const HU=(x,y)=>`<circle cx="${x}" cy="${y}" r="5.5"/><path d="M${x-10} ${y+21}q0 -12 10 -12q10 0 10 12"/>`;
const ST=(cx,cy,r,n=8,k=.45)=>{let p=[];for(let i=0;i<n*2;i++){const a=i*Math.PI/n-Math.PI/2,rr=i%2?r*k:r;p.push((cx+Math.cos(a)*rr).toFixed(1)+','+(cy+Math.sin(a)*rr).toFixed(1))}return p.join(' ')};
const ICON={
 uchikaeshi:`${BM(17,45,10,false)}<path class="as" d="M14 20h28a9 9 0 0 1 0 18h-8"/><path class="as" d="M39 33l-5 5 5 5"/>`,
 migawari:`${HU(16,24)}${HU(48,24)}<path d="M42 56H22M27 51l-5 5 5 5"/><polygon class="a" points="${ST(16,9,6)}"/>`,
 tenka:`<path d="M14 52L40 26" stroke-width="4"/><path class="a" d="M45 25c-5 1-8-3-7-8 1-4 5-6 6-11 2 4 7 6 7 12 0 4-2 6-6 7z"/>`,
 fuuin:`${BM(30,38,15,false)}<path class="tp" d="M11 22l38 34M49 22L11 56"/>`,
 nisefuuin:`${BM(30,38,15,false)}<path class="tp" d="M11 22l38 34M49 22L11 56" stroke-dasharray="5 5"/><text class="at" x="50" y="18">?</text>`,
 yokodori:`${HU(13,24)}${BM(47,40,10,false)}<path class="as" d="M35 40H25M29 36l-4 4 4 4"/>`,
 yogen:`<circle cx="32" cy="28" r="17"/><path d="M19 54h26l-4-9H23z"/><polygon class="a" points="${ST(37,23,6)}"/>`,
 oishitsumon:`<path d="M6 10h28v18H18l-6 6v-6H6z"/><text class="kt" x="20" y="25">?</text><path d="M28 32h30v18h-5v6l-6-6H28z"/><path class="as" d="M43 36v10M38 41h10"/>`,
 michizure:`${HU(13,26)}${HU(51,26)}<ellipse class="as" cx="27" cy="40" rx="6" ry="3.5"/><ellipse class="as" cx="37" cy="40" rx="6" ry="3.5"/><path d="M21 40h-1M43 40h1"/>`,
 nozokimi:`<circle cx="32" cy="22" r="12"/><path d="M26 32l-6 22h24l-6-22"/><path class="as" d="M32 22v-6M32 22h5"/>`,
 toushi:`<rect x="10" y="26" width="20" height="28" rx="2" transform="rotate(-10 20 40)"/><rect x="34" y="26" width="20" height="28" rx="2" transform="rotate(10 44 40)"/><path d="M16 13q16-12 32 0q-16 12-32 0z"/><circle class="a" cx="32" cy="13" r="3.4"/>`
};
const icon=(c,cls='')=>`<svg class="ic ${cls}" viewBox="0 0 64 64" aria-hidden="true">${ICON[c]}</svg>`;
const TVLINE={uchikaeshi:'質問ごと、渡してきた人へ返した',fuuin:'受け取った人は、この爆弾でカードを使えない',yokodori:'持っている人から爆弾を奪った',oishitsumon:'持っている人に、質問をもう1つ追加した',migawari:'渡してきた人が、代わりに爆発する',michizure:'爆発の原因になった相手も、一緒に爆発する'};
const OFF=['tenka','fuuin','nisefuuin','oishitsumon','yokodori','uchikaeshi','michizure'];
const AX=[{k:'hold',l:['粘る','手放す'],c:['K','R']},{k:'atk',l:['仕掛ける','守る'],c:['A','G']},{k:'aim',l:['狙い撃ち','まんべんなく'],c:['F','S']}];
const TYPES={
 KAF:{n:'執念のスナイパー',t:'同じ人に何度も渡していました。',
  d:'爆弾を長めに持ち、決まった相手に渡すことが多い遊び方でした。点火や封印など、攻めのカードもよく使っていました。',
  s:'狙った相手を爆発させやすく、「爆発させた +2」を取りやすいタイプです。',
  w:'狙っている相手が周りに分かると、打ち返しや身代わりで返されやすくなります。ときどき別の人にも渡すと、狙いが読まれにくくなります。',good:'RGS',bad:'RAF'},
 KAS:{n:'場をかき回す興行師',t:'いろいろな人にカードを使っていました。',
  d:'爆弾を長めに持って稼ぎながら、攻めのカードを多く使い、いろいろな人に渡していました。',
  s:'持っている時間とカードの両方で点を取れるタイプです。',
  w:'多くの人から狙われやすくなります。手札がなくなると守る手段がないので、カードの使いどころを選びましょう。',good:'KGS',bad:'KGF'},
 KGF:{n:'根に持つ職人',t:'カードは残し、渡す相手は決まっていました。',
  d:'爆弾を長めに持ち、カードはあまり使っていません。一方で、渡す相手は同じ人に偏っていました。',
  s:'カードを残しているので、最終ラウンドなど点数が大きく動く場面で使えます。',
  w:'渡す相手が偏っていることは、周りにも伝わっています。その相手が身代わりを持っていると、自分が爆発することになります。',good:'RGF',bad:'KAS'},
 KGS:{n:'動じない大黒柱',t:'長く持ち、誰にでも渡していました。',
  d:'爆弾を長めに持ち、カードにはあまり頼らず、いろいろな人に渡していました。',
  s:'持っている時間が長いぶん、点を積み上げやすいタイプです。特定の人を狙わないので、仕返しも受けにくくなります。',
  w:'粘りすぎると、爆発したときの減点(3+持っていた分×2)が大きくなります。のぞき見があれば、渡す時期を決めるのに使えます。',good:'KAS',bad:'RAF'},
 RAF:{n:'速攻の刺客',t:'すぐに渡し、相手は決まっていました。',
  d:'受け取るとすぐに、決まった相手へ渡していました。渡すときには攻めのカードもよく使っていました。',
  s:'自分は爆発しにくく、相手を爆発させやすい遊び方です。',
  w:'持っている時間が短いので、稼ぎは少なめです。狙った人からの仕返しにも気をつけましょう。',good:'RGS',bad:'KAF'},
 RAS:{n:'いたずら好きの風来坊',t:'すぐに渡し、いろいろな人にカードを使っていました。',
  d:'持っている時間は短く、いろいろな人に渡しながら、攻めのカードも使っていました。',
  s:'狙いが読まれにくく、特定の人から狙われにくいタイプです。',
  w:'一人あたりへの攻めは少なめなので、点差をつけにくくなります。予言を組み合わせると、点につながりやすくなります。',good:'KGS',bad:'RAF'},
 RGF:{n:'頼りきりの甘え上手',t:'すぐに渡し、渡す相手は決まっていました。',
  d:'受け取るとすぐに渡し、その相手はいつも同じ人でした。カードはあまり使っていません。',
  s:'爆発しにくく、点数を大きく落としにくい遊び方です。',
  w:'同じ人に渡し続けると、打ち返しで返されることがあります。そのときは、自分が選んだ質問に自分で答えることになります。',good:'KGS',bad:'KAF'},
 RGS:{n:'平和主義の配達員',t:'すぐに渡し、誰も狙っていませんでした。',
  d:'受け取るとすぐに渡し、カードで誰かを狙うこともなく、いろいろな人に渡していました。',
  s:'特定の人から狙われにくく、大きく負けにくいタイプです。',
  w:'稼ぎが少なめなので、上位を狙うなら、もう少し長く持つ場面もつくりましょう。',good:'RAS',bad:'KAF'}
};
const TB=(x,y,r,sp=true,f=true)=>`<circle cx="${x}" cy="${y}" r="${r}" ${f?'class="fl"':''}/><path d="M${(x+r*.6).toFixed(1)} ${(y-r*.8).toFixed(1)}q${(r*.25).toFixed(1)} -${(r*.5).toFixed(1)} ${(r*.65).toFixed(1)} -${(r*.45).toFixed(1)}"/><path d="M${(x-r*.5).toFixed(1)} ${(y-r*.25).toFixed(1)}a${(r*.6).toFixed(1)} ${(r*.6).toFixed(1)} 0 0 1 ${(r*.35).toFixed(1)} -${(r*.3).toFixed(1)}" class="hl"/>${sp?`<circle class="a" cx="${(x+r*1.25).toFixed(1)}" cy="${(y-r*1.25).toFixed(1)}" r="${Math.max(3,r*.18).toFixed(1)}"/>`:''}`;
const TILL={
 KAF:`<circle cx="80" cy="84" r="52"/><circle cx="80" cy="84" r="30" class="th"/><path d="M80 22v24M80 122v24M18 84h24M118 84h24"/>${TB(80,86,16,false)}<circle class="a" cx="80" cy="84" r="4"/>`,
 KAS:`<path d="M48 120h64M56 120l6-30h36l6 30" class="fl"/><path d="M56 104h48" class="th"/><ellipse cx="80" cy="120" rx="44" ry="8"/><path d="M34 70q46-70 92 0" stroke-dasharray="2 9" class="th"/>${TB(34,70,11,false)}${TB(80,34,11)}${TB(126,70,11,false)}`,
 KGF:`<rect x="38" y="22" width="84" height="116" rx="4" class="fl"/><path d="M52 22v116" class="th"/><path d="M64 50h44M64 70h44M64 110h44"/><path d="M64 90h28" /><ellipse cx="80" cy="90" rx="26" ry="10" class="as"/><path d="M118 132l20-60 8 3-20 60-9 6z"/>`,
 KGS:`<path d="M22 54L80 22l58 32z" class="fl"/><path d="M30 54h100"/><rect x="66" y="54" width="28" height="82" class="fl"/><path d="M73 62v66M87 62v66" class="th"/><path d="M40 138h80"/>${TB(116,122,13)}`,
 RAF:`<circle cx="126" cy="80" r="24"/><circle cx="126" cy="80" r="12"/><circle class="a" cx="126" cy="80" r="4"/><path d="M18 64h30M10 80h36M18 96h30" class="th"/>${TB(70,82,15,false)}`,
 RAS:`<path d="M30 112q-6-40 34-46 30-4 34 18 3 18-16 20-14 1-14-12" class="th"/><path d="M22 120q50 14 110-10"/><path d="M58 40l22-14 22 14z" class="fl"/><path d="M46 40h68"/>${TB(122,52,9,false)}${TB(132,92,8)}${TB(100,128,7,false)}`,
 RGF:`<circle cx="56" cy="50" r="13" class="fl"/><path d="M28 138q0-56 28-56 24 0 28 30"/><circle cx="104" cy="58" r="13" class="fl" transform="rotate(-18 104 58)"/><path d="M80 138q2-50 24-50 26 0 28 50"/><path d="M84 112l-14 0"/>${TB(60,114,10,false)}<path class="a" d="M80 30c-4-6-14-2-10 6l10 10 10-10c4-8-6-12-10-6z"/>`,
 RGS:`<path d="M36 70l44-18 44 18v52l-44 18-44-18z" class="fl"/><path d="M36 70l44 18 44-18M80 88v52"/><path d="M58 61l44 18" class="th"/><path d="M92 54q6-18 22-20"/><circle class="a" cx="118" cy="32" r="4"/><path d="M14 92h14M8 106h20" class="th"/>`
};
const tyIll=(c,cls='')=>`<svg class="ti ${cls}" viewBox="0 0 160 160" aria-hidden="true">${TILL[c]}</svg>`;
const isWho=()=>true;
const QHEAD='この中で一番、',QTAIL='のは?';
const ownQ=v=>{let t=String(v||'').trim();if(!t.startsWith('この中で'))t=QHEAD+t;if(!/[?？]$/.test(t))t+='?';return t};
const valid=t=>{const s=(t||'').replace(/\s/g,'');return s.length>=5&&!/^(.)\1*$/.test(s)};
function strong(t,level){if(!t)return false;for(const l of [2,3,4])if(l>level)for(const w of STRONG[l])if(t.includes(w))return true;return false}
function qPool(level,not){let pool=[];for(let l=1;l<=level;l++)pool=pool.concat(Q[l].map(t=>({t,l})));return pool.filter(x=>x.t!==not)}
function choices(level,not,used=[]){let pool=qPool(level,not);const fresh=pool.filter(x=>!used.includes(x.t));if(fresh.length>=4)pool=fresh;const top=shuffle(pool.filter(x=>x.l===level)),rest=shuffle(pool.filter(x=>x.l!==level));return shuffle(top.slice(0,2).concat(rest,top.slice(2)).slice(0,4)).map(x=>x.t)}
const pipsHTML=n=>`<svg class="pv" viewBox="0 0 14 12" aria-hidden="true">${[0,1].map(i=>`<rect x="${.75+i*8}" y=".75" width="4.5" height="10.5" fill="${i<n?'currentColor':'none'}" stroke="currentColor" stroke-width="1.2"/>`).join('')}</svg>`;
export {QHEAD,QTAIL,ownQ,esc,rnd,pick,shuffle,now,M,WHEN,CARDS,Q,STRONG,BM,HU,ST,ICON,icon,TVLINE,OFF,AX,TYPES,TB,TILL,tyIll,isWho,valid,pipsHTML,strong,qPool,choices};
