import {MusicMixer} from './music.js?v=35';
import {defaults,route,applyChoice,episodeClock} from './engine.js';
import {replyTo} from './talk.js?v=40';
const $=s=>document.getElementById(s), safeRead=k=>{try{return localStorage.getItem(k)}catch{return null}}, safeWrite=(k,v)=>{try{localStorage.setItem(k,v)}catch{}};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// 字幕跟随系统语言：英文系统只显示英文，中文系统默认中英双语，可在菜单切换为仅英文。预览可在链接末尾加 #zh / #en 强制语言。
const HL=location.hash.slice(1);
const EN=HL==='en'?true:HL==='zh'?false:!/^zh/i.test((navigator.languages&&navigator.languages[0])||navigator.language||'');
const lang=EN?'en':'zh', T=(zh,en)=>EN?en:zh;
let subEn=EN;if(!EN)subEn=safeRead('mii40-sub')==='en';
function applyLang(){document.body.classList.toggle('en-only',EN);document.body.classList.toggle('sub-en',subEn);document.documentElement.lang=EN?'en':'zh-CN';document.title=T('今天不要上班，咪养你','A Day with Mii');const b=$('mSub');b.hidden=EN;$('mSubV').textContent=subEn?'仅英文':'中英双语';}
applyLang();
$('sayIn').placeholder=T('或者，用你自己的话对咪说…','Or tell Mii in your own words…');

let manifest=await fetch('manifest.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Manifest unavailable');return r.json()});
const plan=manifest.plan;let shots=manifest.shots;
let state={...defaults},ep=1,index=0,active=null,mode='start',serial=0,choiceLocked=false,path=[],checkpoint=null;
let saved;try{saved=JSON.parse(safeRead('mii27-complete-progress')||'null')}catch{}
const videos=new Map(),cleanupLimit=24;let waitVideo=null;
const score=new MusicMixer();
const MODES=['start','loading','playing','paused','choosing','qte','carding','ended'];
function setMode(m){mode=m;document.body.classList.remove(...MODES);document.body.classList.add(m);if(m==='paused')document.body.classList.add('playing');$('headQte').hidden=m!=='qte';$('paused').hidden=m!=='paused';if(m!=='choosing')closeSheet();}

const items=()=>route(plan.episodes[ep-1],state),current=()=>items()[index];
const epTitle=n=>T(plan.episodes[n-1].zh,plan.episodes[n-1].en);
const pad=n=>String(n).padStart(2,'0'),timeText=x=>{const v=Math.max(0,Math.round(x||0));return Math.floor(v/60)+':'+pad(v%60)};
const epLen=n=>episodeClock(route(plan.episodes[n-1],defaults),shots,0).total;
function labels(){if(mode==='start'){$('epName').textContent=T('和咪过一天','A Day with Mii');return;}$('epName').textContent=T(`第 ${ep} 集 · ${epTitle(ep)}`,`EP ${pad(ep)} · ${epTitle(ep)}`);$('chap').textContent=`EP${pad(ep)}`;}

// music
function scoreFor(s){return s?.bgm==='phone-dance-diegetic'?'phone-dance':s?.bgm==='night'?'night':['chores','kitchen'].includes(s?.bgm)?'chores':'home';}
function prepareScore(s){if(s?.bgmBaked){score.pause();return;}const key=scoreFor(s);score.select(key,manifest.music?.[key],{restart:s?.id==='E07-replay'});score.setRate(rate);score.play();}
function stopWaiting(){if(!waitVideo)return;waitVideo.pause();if(waitVideo._waitRestart)waitVideo.removeEventListener('ended',waitVideo._waitRestart);delete waitVideo._waitRestart;waitVideo=null;}
function startWaiting(){
 // 选择时继续播放已解码的画面，循环末尾 3.2 秒；对白静音，只留配乐。
 stopWaiting();const v=active,shot=shots[v?.dataset.shot];if(!v||!shot)return;
 waitVideo=v;v.muted=true;v.playbackRate=rate;
 const key=scoreFor(shot);score.select(key,manifest.music?.[key]);score.setRate(rate);score.play();
 const loopStart=Math.max(0,(v.duration||shot.duration)-3.2);
 const restart=()=>{if(waitVideo!==v||!['choosing','qte'].includes(mode))return;v.currentTime=loopStart;v.play().catch(()=>{});};
 v._waitRestart=restart;v.addEventListener('ended',restart);
 if(v.ended||v.currentTime>=(v.duration||shot.duration)-.08)v.currentTime=loopStart;
 v.play().catch(()=>{});
}

// video
// 视频按需加载：当前镜头优先，后面的镜头排队，一次只预取一段，避免线上带宽被同时摊薄。
const srcOf=v=>v.dataset.src;
function startLoad(v){if(!v.getAttribute('src')){v.preload='auto';v.src=srcOf(v);v.load();}}
const bufferedTo=v=>v.buffered.length?v.buffered.end(v.buffered.length-1):0;
const loaded=v=>!!v.getAttribute('src')&&(v.readyState>=4&&bufferedTo(v)>=(v.duration||Infinity)-.3);
let warmQueue=[];
function pump(){
 // 正在播的镜头缓冲不足 6 秒：停掉其他半截预取，带宽全给它
 if(active&&!loaded(active)&&bufferedTo(active)-active.currentTime<6){for(const v of videos.values())if(v!==active&&v.getAttribute('src')&&!loaded(v)){v.removeAttribute('src');v.load();}return;}
 const pending=warmQueue.map(id=>videos.get(id)).filter(Boolean);
 if(pending.some(v=>v.getAttribute('src')&&!loaded(v)))return;
 const next=pending.find(v=>!v.getAttribute('src'));if(next)startLoad(next);
}
setInterval(pump,500);
function getVideo(id){
 if(videos.has(id))return videos.get(id);const s=shots[id];if(!s?.ready)return null;
 const v=document.createElement('video');v.preload='none';v.playsInline=true;v.setAttribute('playsinline','');v.setAttribute('webkit-playsinline','');v.dataset.src=s.src;v.poster=s.poster;v.muted=true;v.dataset.shot=id;v.disablePictureInPicture=true;
 v.addEventListener('ended',()=>{if(v===active&&mode==='playing'){index++;save();advance();}});
 v.addEventListener('error',()=>{if(v===active)showError(T('这段视频暂时未能加载。','This clip could not load.'));});
 v.addEventListener('play',()=>{if(v===active)$('playIco').innerHTML='<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>';});
 v.addEventListener('pause',()=>{if(v===active&&!v.ended)$('playIco').innerHTML='<path d="M8 5.5v13l10.5-6.5z"/>';});
 $('films').append(v);videos.set(id,v);
 while(videos.size>cleanupLimit){const found=[...videos.keys()].find(k=>videos.get(k)!==active&&k!==id);if(!found)break;const old=videos.get(found);old.pause();old.removeAttribute('src');old.load();old.remove();videos.delete(found);}
 return v;
}
function preload(){
 // 排队顺序：接下来的镜头；遇到选择点时，先排每个选项的第一镜，再排各自的第二镜。
 const r=items(),want=[];
 const add=id=>{if(id&&!want.includes(id)&&getVideo(id))want.push(id);};
 const warmBranches=(node,j)=>{const paths=node.options.map(o=>route(plan.episodes[ep-1],applyChoice(state,node,o.value)).slice(j+1).filter(n=>n.id||n.choice));for(let k=0;k<2;k++)for(const p of paths){if(p[k]?.choice)continue;if(p.slice(0,k).some(n=>n.choice))continue;add(p[k]?.id);}};
 if(r[index]?.choice)warmBranches(r[index],index);
 for(let j=index+1;j<Math.min(r.length,index+4);j++){if(r[j].id)add(r[j].id);if(r[j].qte)continue;if(r[j].choice){warmBranches(r[j],j);break;}}
 // 已经不在路线上的半截下载直接中止，把带宽让给需要的镜头
 for(const [id,v] of videos)if(v!==active&&!want.includes(id)&&v.getAttribute('src')&&!loaded(v)){v.removeAttribute('src');v.load();}
 warmQueue=want;pump();
}
function showError(message){$('loading').hidden=false;$('loadingText').textContent=message;$('retry').hidden=false;$('loading').querySelector('.spinner').hidden=true;active?.pause();score.pause();}
async function refresh(){try{const next=await fetch('manifest.json?t='+Date.now(),{cache:'no-store'}).then(r=>r.json());manifest=next;shots=next.shots;}catch{}}
async function playShot(id,offset=0,{paused=false}={}){
 stopWaiting();const ticket=++serial;choiceLocked=false;let s=shots[id];
 if(!s?.ready){await refresh();s=shots[id];if(ticket!==serial)return;}
 const seamless=videos.get(id)?.readyState>=2;
 $('loading').hidden=seamless;$('loadingText').textContent=T('稍等一下…','A little moment…');$('retry').hidden=true;$('loading').querySelector('.spinner').hidden=false;
 if(!s?.ready){showError(T('这一幕仍在制作中，进度已保留。','This scene is still being prepared. Your place is saved.'));save();return;}
 const v=getVideo(id);startLoad(v);active?.pause();for(const o of videos.values())if(o!==v){o.pause();o.muted=true;}
 active=v;v.playbackRate=rate;v.muted=false;v.volume=1;
 try{
  await new Promise((ok,bad)=>{if(v.readyState>=2)return ok();const to=setTimeout(()=>bad(Error('load timeout')),20000);v.addEventListener('loadeddata',()=>{clearTimeout(to);ok();},{once:true});v.addEventListener('error',()=>{clearTimeout(to);bad(Error('video error'));},{once:true});if(v.networkState===HTMLMediaElement.NETWORK_EMPTY)v.load();});
  if(ticket!==serial)return;
  v.currentTime=Math.min(offset,Math.max(0,(v.duration||s.duration)-.1));
  if(!paused)await v.play();
  if(ticket!==serial){v.pause();return;}
  for(const o of videos.values())o.classList.toggle('active',o===v);
  $('stage').style.backgroundImage=`url("${s.poster}")`;
  $('loading').hidden=true;setMode(paused?'paused':'playing');labels();if(!paused)prepareScore({...s,id});preload();save();
 }catch(e){if(ticket===serial){v.pause();showError(T('点击重试这一幕。','Tap to retry this scene.'));}}
}
function advance(){
 const node=current();
 if(!node){active?.pause();stopWaiting();return episodeEnd();}
 if(node.qte){setMode('qte');startWaiting();renderQte(node);preload();save();return;}
 if(node.choice){active?.pause();openChoice(node);preload();save();return;}
 playShot(node.id);
}

// head-pat QTE
function renderQte(node){
 const b=$('headQte');b.disabled=false;b.setAttribute('aria-label',T(node.labelZh||'摸摸咪的头',node.label||'Give Mii a head pat'));positionQte(node);
 b.onclick=()=>{if(choiceLocked||mode!=='qte')return;choiceLocked=true;b.disabled=true;b.hidden=true;stopWaiting();index++;save();advance();};
}
function positionQte(node){
 // 画面用 cover 铺满舞台，所以按 cover 的缩放换算锚点。
 const box=$('stage').getBoundingClientRect(),vw=active?.videoWidth||720,vh=active?.videoHeight||1280;
 const scale=Math.max(box.width/vw,box.height/vh),w=vw*scale,h=vh*scale;
 let x=node.x||.5,y=node.y||.25;const track=node.anchors?.[active?.dataset.shot];
 if(track?.length){const t=active?.currentTime||0;let a=track[0],b=track.at(-1);for(let i=1;i<track.length;i++){if(t<=track[i][0]){a=track[i-1];b=track[i];break;}}const u=Math.max(0,Math.min(1,(t-a[0])/(b[0]-a[0]||1)));x=a[1]+(b[1]-a[1])*u;y=a[2]+(b[2]-a[2])*u;}
 const el=$('headQte');el.style.left=((box.width-w)/2+w*x)+'px';el.style.top=((box.height-h)/2+h*y)+'px';
}
window.addEventListener('resize',()=>{if(mode==='qte')positionQte(current());});

// choices
const optHTML=o=>`<span class="zh">${esc(o.zh)}</span><span class="en">${esc(o.en)}</span>`;
function cueFor(node){return node.choice==='I07'?{zh:'咪只会出石头，你出什么？',en:'Mii only throws rock. What’s yours?'}:{zh:'你想怎么选？',en:'What would you like?'};}
function openChoice(node){
 checkpoint={state:{...state},ep,index,path:path.slice()};
 setMode('choosing');startWaiting();sayLine=null;
 const c=cueFor(node);$('cue').innerHTML=EN?`<span class="en">${esc(c.en)}</span>`:`${esc(c.zh)}<span class="en">${esc(c.en)}</span>`;
 const root=$('opts');root.replaceChildren();
 for(const o of node.options){const b=document.createElement('button');b.className='opt';b.dataset.value=o.value;b.innerHTML=optHTML(o);b.onclick=()=>choose(node,o.value);root.append(b);}
 $('sayIn').value='';$('sayBtn').disabled=false;
 setTimeout(()=>{if(mode!=='choosing')return;$('sheet').classList.add('show');$('subs').style.bottom=($('sheet').offsetHeight+24)+'px';},150);
}
function closeSheet(){$('sheet').classList.remove('show');$('subs').style.bottom='';sayLine=null;}
function choose(node,value){
 if(choiceLocked||mode!=='choosing')return;choiceLocked=true;
 $('opts').querySelectorAll('button').forEach(x=>x.disabled=true);
 const o=node.options.find(x=>x.value===value);path.push({zh:o.zh,en:o.en});
 stopWaiting();closeSheet();state=applyChoice(state,node,value);index++;save();advance();
}

// 自由输入：现在用本地关键词匹配做占位（talk.js），之后换成 realtime 模型时只改 talk.js 的 replyTo。
let sayLine=null;
$('say').addEventListener('submit',async e=>{
 e.preventDefault();const node=current(),raw=$('sayIn').value.trim();if(!raw||mode!=='choosing'||!node?.choice)return;
 $('sayIn').value='';$('sayBtn').disabled=true;
 sayLine=EN?{en:raw,k:'her'}:{zh:raw,k:'her'};
 const ctx={text:raw,lang,episode:ep,choice:node.choice,key:node.key,options:node.options,state:{...state},prompt:cueFor(node)};
 // 先让用户自己的话在字幕上停一会儿，再显示咪的回应
 let r=null;try{[r]=await Promise.all([replyTo(ctx),new Promise(ok=>setTimeout(ok,450))]);}catch(err){console.warn('[mii] reply failed',err);}
 document.dispatchEvent(new CustomEvent('mii:say',{detail:{...ctx,reply:r}}));
 if(mode!=='choosing'||current()!==node){$('sayBtn').disabled=false;return;}
 $('opts').querySelectorAll('.opt').forEach(b=>b.classList.toggle('hint',b.dataset.value===r?.suggest));
 if(r?.reply)sayLine={zh:r.reply.zh,en:r.reply.en,who:'Mii'};
 $('sayBtn').disabled=false;
 if(r?.choose&&node.options.some(o=>o.value===r.choose))setTimeout(()=>choose(node,r.choose),r.reply?1600:300);
});

// episode end
function episodeEnd(){
 score.pause();save();
 if(ep===plan.episodes.length)return showFinal();
 setMode('carding');
 $('epDone').textContent=T(`第 ${ep} 集 · 完`,`End of Episode ${ep}`);
 $('epNum').textContent=`EPISODE ${ep+1}`;$('epT').textContent=EN?epTitle(ep+1):`第 ${ep+1} 集 · ${plan.episodes[ep].zh}`;$('epTe').textContent=EN?'':plan.episodes[ep].en;
 $('epCard').hidden=false;
 // 不自动跳集：用户在 V32 明确要求片尾停住、点按钮进入下一集。
 $('epGo').onclick=()=>{$('epCard').hidden=true;ep++;index=0;labels();advance();};
}
function showFinal(){
 setMode('ended');
 $('endPath').innerHTML=path.map((p,i)=>`<li><b>${pad(i+1)}</b><span>${esc(T(p.zh,p.en))}</span></li>`).join('');
 $('endCard').hidden=false;
}
function hideCards(){['startCard','epCard','endCard'].forEach(x=>$(x).hidden=true);}
function backToChoice(){
 hideCards();serial++;active?.pause();stopWaiting();
 if(!checkpoint){index=0;labels();return advance();}
 state={...checkpoint.state};ep=checkpoint.ep;index=checkpoint.index;path=checkpoint.path.slice();labels();advance();
}
function restart(){hideCards();serial++;active?.pause();stopWaiting();score.pause();state={...defaults};ep=1;index=0;path=[];checkpoint=null;labels();advance();}
function jumpTo(n){hideCards();serial++;active?.pause();stopWaiting();ep=n;index=0;labels();advance();}
$('endRestart').onclick=restart;$('endBack').onclick=backToChoice;$('endEps').onclick=()=>openMenu(true);

// start
function startMeta(){
 const total=plan.episodes.reduce((a,_,i)=>a+epLen(i+1),0);let choices=0;
 const count=steps=>steps.forEach(s=>{if(s.choice)choices++;if(s.branch)count(Object.values(s.cases)[0]||[]);});plan.episodes.forEach(e=>count(e.steps));
 $('meta').innerHTML=[T(`${plan.episodes.length} 集`,`${plan.episodes.length} episodes`),T(`${choices} 个选择`,`${choices} choices`),T(`约 ${Math.round(total/60)} 分钟`,`≈${Math.round(total/60)} min`),T('请打开声音','Sound on')].map(x=>`<span>${x}</span>`).join('');
}
$('stage').style.backgroundImage='url(cover.jpg)';startMeta();$('continueBtn').hidden=!saved;
$('startBtn').onclick=restart;
$('continueBtn').onclick=()=>{
 if(!saved)return restart();hideCards();
 state={...defaults,...saved.state};ep=Math.min(plan.episodes.length,Math.max(1,saved.ep||1));path=saved.path||[];index=restoredIndex(saved,ep);labels();
 const n=current();n?.id?playShot(n.id,saved.time||0):advance();
};
function save(){if(mode==='start')return;safeWrite('mii27-complete-progress',JSON.stringify({state,ep,index,time:active?.currentTime||0,version:39,nodeKey:current()?.id||current()?.qte||current()?.choice,path}));}
function restoredIndex(saved,episode){
 // 沿用 V39 的进度：同一 plan，按节点名找回位置。更旧的存档从本集开头开始。
 const next=route(plan.episodes[episode-1],{...defaults,...saved.state}),key=n=>n?.id||n?.qte||n?.choice;
 if(saved.version!==39)return 0;
 const hit=next.findIndex(n=>key(n)===saved.nodeKey);return hit>=0?hit:Math.min(saved.index||0,next.length);
}

// pause & progress
function pause(){if(mode!=='playing')return;active?.pause();score.pause();setMode('paused');save();}
async function resume(){if(mode!=='paused')return;try{await active?.play();prepareScore({...shots[active?.dataset.shot],id:active?.dataset.shot});setMode('playing');}catch{showError(T('点击继续播放。','Tap to resume.'));}}
const togglePause=()=>mode==='playing'?pause():resume();
$('stage').addEventListener('click',e=>{if(e.target.closest('button,#sheet,#bar,#menu,.card,#top,#loading'))return;togglePause();});
$('playBtn').onclick=togglePause;
$('retry').onclick=async()=>{await refresh();const n=current();if(n?.id)playShot(n.id,active?.currentTime||0);};
const track=$('track');let dragging=false,dragTarget=0,swallow=false;
function setBar(p){const pc=Math.max(0,Math.min(100,p*100));$('fill').style.width=pc+'%';$('knob').style.left=pc+'%';track.setAttribute('aria-valuenow',Math.round(pc));}
function clock(){return episodeClock(items(),shots,index,active?.currentTime||0);}
function dragAt(x){const r=track.querySelector('i').getBoundingClientRect();const p=Math.max(0,Math.min(1,(x-r.left)/r.width));setBar(p);dragTarget=p*clock().total;}
async function seekEpisode(target){
 // 按本集当前分支路线，把总时间换算到具体镜头和镜头内时间。
 const rr=items(),wasPaused=mode==='paused';let pos=0;
 for(let i=0;i<rr.length;i++){if(!rr[i].id)continue;const d=shots[rr[i].id]?.duration||0;if(target<pos+d||i===rr.length-1){if(i>index&&rr.slice(index+1,i).some(n=>n.choice))return;index=i;return playShot(rr[i].id,Math.max(0,target-pos),{paused:wasPaused});}pos+=d;}
}
track.addEventListener('pointerdown',e=>{if(!active)return;dragging=true;track.classList.add('drag');track.setPointerCapture(e.pointerId);dragAt(e.clientX);e.preventDefault();});
track.addEventListener('pointermove',e=>{if(dragging)dragAt(e.clientX);});
const endDrag=()=>{if(!dragging)return;dragging=false;track.classList.remove('drag');seekEpisode(dragTarget);};
track.addEventListener('pointerup',endDrag);track.addEventListener('pointercancel',endDrag);
track.addEventListener('keydown',e=>{if(!active)return;const c=clock();if(e.key==='ArrowRight')seekEpisode(Math.min(c.total-.1,c.elapsed+5));if(e.key==='ArrowLeft')seekEpisode(Math.max(0,c.elapsed-5));});

// speed
const RATES=[0.75,1,1.25,1.5,2];let rate=1;{const r=+safeRead('mii40-rate');if(RATES.includes(r))rate=r;}
const fmtRate=r=>(r%1?String(r):r.toFixed(1))+'x';
function applyRate(){for(const v of videos.values()){v.defaultPlaybackRate=rate;v.playbackRate=rate;}score.setRate(rate);$('speedBtn').textContent=fmtRate(rate);$('speedMenu').querySelectorAll('button').forEach(b=>b.classList.toggle('on',+b.dataset.r===rate));}
$('speedMenu').innerHTML=RATES.slice().reverse().map(r=>`<button data-r="${r}">${fmtRate(r)}</button>`).join('');
function closeSpeed(){$('speedMenu').hidden=true;$('speedBtn').setAttribute('aria-expanded','false');}
$('speedBtn').onclick=e=>{e.stopPropagation();const m=$('speedMenu');m.hidden=!m.hidden;$('speedBtn').setAttribute('aria-expanded',String(!m.hidden));};
$('speedMenu').querySelectorAll('button').forEach(b=>b.onclick=e=>{e.stopPropagation();rate=+b.dataset.r;safeWrite('mii40-rate',String(rate));applyRate();closeSpeed();});
applyRate();

// subtitles & frame loop
let lastKey='';
function showSub(c){const el=$('subs');if(!c){el.innerHTML='';el.className='';return;}el.className=c.k==='her'?'her':'';const who=c.k==='her'?T('你','You'):c.who||'';el.innerHTML=(who?`<div class="who">${esc(who)}</div>`:'')+(c.zh&&!EN?`<div class="zh">${esc(c.zh)}</div>`:'')+(c.en?`<div class="en">${esc(c.en)}</div>`:'');}
function renderSubs(){
 let c=null,key='';
 if(['playing','paused'].includes(mode)){const s=shots[active?.dataset.shot],t=active?.currentTime||0;c=s?.captions?.find(q=>t>=q.start&&t<q.end)||null;key=(active?.dataset.shot||'')+(c?c.start:'');}
 else if(mode==='choosing'&&sayLine){c=sayLine;key='say'+JSON.stringify(sayLine);}
 if(key!==lastKey){lastKey=key;showSub(c);}
}
function renderExtras(now){
 const s=shots[active?.dataset.shot],time=active?.currentTime||0,visible=['playing','paused'].includes(mode);
 $('thought').hidden=true;
 const p=s?.pip;$('phonePip').hidden=!p?.src||!visible||time<p.start||time>=p.end;
 if(p?.src&&$('pipImage').getAttribute('src')!==p.src)$('pipImage').src=p.src;
 const spoken=mode==='playing'&&s?.captions?.some(c=>time>=c.start-.15&&time<c.end+.2);
 let target=!['playing','choosing','qte'].includes(mode)?0:spoken?.055:s?.bgm==='phone-dance-diegetic'?.4:.32;
 if(s?.bgm===null||['E01-alarm','E01-greeting','E04-fail-R','E04-fail-P'].includes(active?.dataset.shot))target=0;
 if(s?.musicWindow&&(time<s.musicWindow.start||time>=s.musicWindow.end))target=0;
 score.tick(now,s?.bgmBaked&&!['choosing','qte'].includes(mode)?0:target);
}
function frame(now){
 if(mode==='qte')positionQte(current());
 renderSubs();renderExtras(now);
 if(['playing','paused'].includes(mode)&&!dragging){const c=clock();setBar(c.total?c.elapsed/c.total:0);}
 if(mode==='playing'){const r=items(),s=shots[active?.dataset.shot];if(r[index+1]?.choice&&s?.decisionAt!==undefined&&active.currentTime>=s.decisionAt){active.pause();index++;advance();}}
 requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// menu
function renderEps(){
 $('epList').innerHTML=plan.episodes.map(e=>`<button class="ep${e.id===ep&&mode!=='start'?' current':''}" data-ep="${e.id}"><span><b>EP${e.id}</b>${esc(T(e.zh,e.en))}</span><small>${timeText(epLen(e.id))}</small></button>`).join('');
 $('epList').querySelectorAll('.ep').forEach(b=>b.onclick=()=>{closeMenu();jumpTo(+b.dataset.ep);});
}
let menuPaused=false;
function closeMenu(){$('menu').hidden=true;$('menuBtn').setAttribute('aria-expanded','false');if(menuPaused&&mode==='paused')resume();menuPaused=false;}
function openMenu(force){const m=$('menu');if(!force&&!m.hidden)return closeMenu();renderEps();m.hidden=false;$('menuBtn').setAttribute('aria-expanded','true');if(mode==='playing'){pause();menuPaused=true;}}
$('menuBtn').onclick=()=>openMenu();
$('mSub').onclick=()=>{subEn=!subEn;safeWrite('mii40-sub',subEn?'en':'zh');applyLang();lastKey='';};
$('mBack').onclick=()=>{menuPaused=false;closeMenu();backToChoice();};
$('mRestart').onclick=()=>{menuPaused=false;closeMenu();restart();};
document.addEventListener('pointerdown',e=>{swallow=false;if(!$('speedMenu').hidden&&!e.target.closest('#speedWrap')){closeSpeed();swallow=true;}if($('menu').hidden||e.target.closest('#menu,#menuBtn'))return;closeMenu();swallow=true;},true);
document.addEventListener('click',e=>{if(swallow&&!e.target.closest('#menu,#menuBtn,#speedWrap')){e.stopPropagation();e.preventDefault();swallow=false;}},true);
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeSpeed();if(!$('menu').hidden)closeMenu();}if(e.code==='Space'&&!['BUTTON','INPUT'].includes(document.activeElement.tagName)){e.preventDefault();togglePause();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){pause();score.pause();waitVideo?.pause();save();}else if(['choosing','qte'].includes(mode)){waitVideo?.play().catch(()=>{});score.play();}});
window.addEventListener('pagehide',save);

setMode('start');labels();startLoad(getVideo('E01-alarm'));
$('startBtn').disabled=false;$('continueBtn').disabled=false;
window.__mii={get state(){return state},get episode(){return ep},get index(){return index},get mode(){return mode},get active(){return active},get items(){return items()},get manifest(){return manifest},get path(){return path}};
