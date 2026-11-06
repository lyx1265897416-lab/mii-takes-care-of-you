/* realtime 互动剧：顶部历史进度条（2026-11-05，参考 nl-video-harness 0.4.38 播放器顶部的 story bar）。
   开场和每一幕各一格（一幕的第 1、2 段合成一格），看过的填满、正在播的按进度走、正在生成的那一格流光；点任意一格回看那一幕（带字幕），
   回看时画面上有「回到现在」，看完自动回到现在；新的一幕生成好要开播时，回看自动关掉。
   不改各页面的 rt-player.js：在它后面加载，包住 RT.begin / part / done / clear 记下每一幕的片段地址和台词。
   页面可选地在 RT.begin 里多传 hist：{r: 这一轮中转返回的对象（用它的 line_times / lines / zh / segs.flip 出字幕和镜像）, her: 她这一轮说的话, cues: 开场字幕 [{s,e,en,zh,who}]}。
   V2（11-05 晚，Vicky：回看前面的幕一直黑屏加载不出来）：回看原来新建播放器、重新从视频 CDN 下载，她的网络到 Vivix 首包 14–17 秒、速度只够实时，
   黑屏很久。改成：一幕播完后，在她选选项、等生成的空档里，用不进画面的“留存播放器”静音慢放把这一幕下完（正在下载直播段时让路），
   回看直接用留存播放器（已缓冲，立刻出画面）；最近 KEEP 幕留存，更早的释放。没下完的回看先显示“加载中 xx%”，缓冲够了再播，不黑屏干等。
   用法：<script src="rt-player.js"></script><script src="rt-history.js"></script> */
(function () {
  const RT = window.RT; if (!RT || RT._hist) return; RT._hist = 1;
  const css = `
#rhBar{position:fixed;top:2px;left:10px;width:300px;z-index:60;display:flex;gap:4px}
#rhBar[hidden]{display:none}
#rhBar button{flex:1;min-width:0;height:12px;display:grid;align-items:center;background:none;border:0;padding:0;margin:0;cursor:pointer}
#rhBar button::before,#rhBar button i{grid-area:1/1;height:2.5px;border-radius:2px}
#rhBar button::before{content:"";background:rgba(255,255,255,.32)}
#rhBar button i{display:block;width:0;background:#fff;box-shadow:0 0 2px rgba(0,0,0,.45)}
#rhBar button.pend{cursor:default}
#rhBar button.pend::before{background:linear-gradient(90deg,rgba(255,255,255,.2) 0%,rgba(255,255,255,.2) 30%,rgba(255,255,255,.75) 50%,rgba(255,255,255,.2) 70%,rgba(255,255,255,.2) 100%);background-size:250% 100%;animation:rhFlow 2.2s linear infinite}
@keyframes rhFlow{from{background-position:100% 0}to{background-position:-150% 0}}
#rhView{position:absolute;inset:0;z-index:58;background:#000;overflow:hidden}
#rhView video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0}
#rhView video.on{opacity:1}
#rhTop{position:absolute;top:calc(env(safe-area-inset-top,0px) + 24px);left:10px;right:10px;z-index:3;display:flex;align-items:center;justify-content:space-between;gap:8px}
#rhTop span{font:12px/1.35 -apple-system,system-ui,sans-serif;color:#eee;background:rgba(0,0,0,.5);padding:4px 10px;border-radius:999px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#rhTop button{flex:none;font:12px -apple-system,system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.3);border-radius:999px;padding:5px 12px;cursor:pointer}
#rhSub{position:absolute;left:7%;right:7%;bottom:calc(env(safe-area-inset-bottom,0px) + 56px);z-index:3;text-align:center;color:#fff;text-shadow:0 1px 3px #000,0 0 8px rgba(0,0,0,.6);font:16px/1.4 -apple-system,system-ui,sans-serif;pointer-events:none}
#rhSub .who{font-size:11px;letter-spacing:.08em;opacity:.75;text-transform:uppercase}
#rhSub .zh{font-size:14px;opacity:.92;margin-top:2px}
#rhPause{position:absolute;inset:0;z-index:2;display:grid;place-items:center;pointer-events:none}
#rhPause[hidden]{display:none}
#rhLoad{position:absolute;inset:0;z-index:2;display:grid;place-items:center;pointer-events:none;font:13px -apple-system,system-ui,sans-serif;color:#ddd}
#rhLoad[hidden]{display:none}
#rhLoad div{display:flex;flex-direction:column;align-items:center;gap:10px}
#rhLoad i{width:28px;height:28px;border-radius:50%;border:2.5px solid rgba(255,255,255,.25);border-top-color:#fff;animation:rhSpin .9s linear infinite}
@keyframes rhSpin{to{transform:rotate(360deg)}}
#rhPause div{width:62px;height:62px;border-radius:50%;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.25);display:grid;place-items:center;color:#fff;font-size:22px}`;
  let zh = () => /^zh/i.test(navigator.language || ''), stage = null, bar = null, view = null, rev = null;
  const T = (en, z) => zh() ? z : en;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const H = [];            // 每一格：{key, label, her, urls, durs, cues, flips, done}
  let curKey = null, curParts = null, curI = 0;
  const srcOf = v => v ? (v.dataset.src || v.currentSrc || v.src || '') : '';
  const find = k => H.find(e => e.key === k);
  function capture(e, parts) {
    if (!e || !parts) return;
    parts.forEach((p, i) => { const u = srcOf(p.v); if (u && !/^blob:|^data:/.test(u) && (i >= e.urls.length || !e.urls[i] || e.live)) e.urls[i] = u;
      const d = p.v && isFinite(p.v.duration) && p.v.duration > 0 ? p.v.duration : p.d; if (d) e.durs[i] = d; });
  }
  function cuesOf(r, n) {  // 每段的字幕：中转给了逐句时间就用；没有就把这段的台词平均铺开
    const out = [];
    for (let i = 0; i < n; i++) {
      const k = 'seg' + (i + 1), LT = r && r.line_times && r.line_times[k];
      if (LT && LT.length) { out.push(LT.map(c => ({ s: c.s, e: c.e, en: c.en || c.text || '', zh: c.zh || '', who: c.who || '' }))); continue; }
      const L = r && r.lines && !Array.isArray(r.lines) ? (r.lines[k] || []).filter(Boolean) : [], Z = r && r.zh ? (r.zh[k] || []).filter(Boolean) : [];
      out.push(L.map((t, j) => ({ rel: [j / L.length, (j + 1) / L.length], en: t, zh: Z[j] || '', who: '' })));
    }
    return out;
  }
  function onBegin(o) {
    if (!o || !o.key || !/^(OPEN|round:)/.test(o.key)) return;
    if (view && !o.free) closeReview(false);   // 新的一幕要开播了：回看让位
    let e = find(o.key);
    if (!e) {
      const hi = o.hist || {};
      e = { key: o.key, label: o.key === 'OPEN' ? T('Opening', '开场') : (o.label || ''), her: hi.her || '', urls: [], durs: [], done: false, live: true,
            cues: o.key === 'OPEN' ? [hi.cues || []] : cuesOf(hi.r, (o.parts || []).length), flips: hi.r && hi.r.segs ? hi.r.segs.map(s => s.flip || null) : [] };
      H.push(e);
    }
    curKey = o.key; curParts = o.parts || null; curI = 0; capture(e, curParts); paint();
  }
  const ob = RT.begin, op = RT.part, od = RT.done, oc = RT.clear, oi = RT.init;
  RT.begin = function (o) { try { onBegin(o); } catch (err) {} return ob.apply(RT, arguments); };
  RT.part = function (i) { try { curI = i; capture(find(curKey), curParts); } catch (err) {} return op.apply(RT, arguments); };
  RT.done = function (k) { try { const e = find(k || curKey); if (e) { capture(e, curParts); e.done = true; e.live = false; if (e.key !== 'OPEN') setTimeout(() => e.urls.filter(Boolean).forEach(keepOf), 1500); } } catch (err) {} return od.apply(RT, arguments); };
  RT.clear = function () { try { const e = find(curKey); if (e) { capture(e, curParts); e.live = false; } curKey = null; curParts = null; } catch (err) {} return oc.apply(RT, arguments); };
  let drama = null;
  RT.init = function (o) { const r = oi.apply(RT, arguments); try { if (o && o.zh) zh = o.zh; if (o && o.drama && o.drama !== drama) { drama = o.drama; H.length = 0; curKey = null; } closeReview(false); mount(document.querySelector((o && o.stage) || '#stage')); } catch (err) {} return r; };   // 换了一部剧（APP 里）就清空历史
  RT.history = () => H.map(e => ({ key: e.key, label: e.label, her: e.her, urls: e.urls.slice() }));
  // ---------- 留存（V2）：播完的幕在空档里下完，回看直接用 ----------
  const KEEP = /iPhone|iPad|Android/i.test(navigator.userAgent) ? 3 : 5, K = new Map();   // url → 不进画面的 video
  const full = v => v && v.duration > 0 && v.buffered.length && v.buffered.end(v.buffered.length - 1) >= v.duration - 0.3;
  function keepOf(u) {
    let v = K.get(u); if (v) return v;
    v = document.createElement('video'); v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'auto'; v.src = u; v._kept = 1; K.set(u, v);
    const urls = [...new Set(H.filter(e => e.done && e.key !== 'OPEN').slice(-KEEP).flatMap(e => e.urls.filter(Boolean)))];   // 只留最近 KEEP 幕
    [...K.keys()].forEach(x => { if (!urls.includes(x) && x !== u && !(rev && rev.parts.some(p => p.v === K.get(x)))) { const o = K.get(x); o.pause(); o.removeAttribute('src'); o.load(); K.delete(x); } });
    return v;
  }
  const liveBusy = () => [...document.querySelectorAll('video')].some(v => !v._kept && !(view && view.contains(v)) && v.currentSrc && !v.loop && !/OPEN|IDLE/.test(v.currentSrc) && v.readyState >= 1 && !full(v) && v.networkState === 2);
  function tend() {   // 每秒：没有直播段在下载时，让没下完的留存播放器静音慢放（浏览器才会一直下到结尾）；直播段在下载时让路
    const busy = liveBusy();
    K.forEach(v => { if (view && view.contains(v)) return;
      if (full(v) || busy) { if (!v.paused) v.pause(); return; }
      if (v.paused && v.readyState >= 1) { try { v.playbackRate = 0.0625; } catch (e) {} v.play().catch(() => {}); } });
  }
  setInterval(tend, 1000);


  function mount(st) {
    if (!st) return; stage = st;
    if (!document.getElementById('rhStyle')) { const s = document.createElement('style'); s.id = 'rhStyle'; s.textContent = css; document.head.appendChild(s); }
    if (bar) bar.remove(); bar = document.createElement('div'); bar.id = 'rhBar'; bar.hidden = true; stage.appendChild(bar);
    bar.addEventListener('click', ev => { ev.stopPropagation(); const b = ev.target.closest('button'); if (!b || b.classList.contains('pend')) return; openReview(+b.dataset.i); });
    ['pointerdown', 'touchstart'].forEach(t => bar.addEventListener(t, ev => ev.stopPropagation(), { passive: true }));
  }
  const waiting = () => document.body.classList.contains('waiting') || (stage && stage.classList.contains('waiting'));
  const started = () => !document.body.classList.contains('start');
  const ready = e => e.urls.length && e.urls[0];
  function fracOf(parts, i, durs) {
    if (!parts) return 0; let tot = 0, at = 0;
    parts.forEach((p, j) => { const d = (p.v && isFinite(p.v.duration) && p.v.duration > 0 ? p.v.duration : (durs[j] || p.d || 0)); tot += d; if (j < i) at += d; if (j === i) at += (p.v && p.v.currentTime) || 0; });
    return tot ? Math.min(1, at / tot) : 0;
  }
  let was = '';
  function paint() {
    if (!bar) return;
    const list = H.filter(ready), pend = waiting() && !view;
    if (!list.length || !started()) { if (!bar.hidden) bar.hidden = true; was = ''; return; }
    let act = -1, frac = 0;
    if (view && rev) { act = list.indexOf(rev.e); frac = fracOf(rev.parts, rev.i, rev.e.durs); }
    else if (curKey) { const e = find(curKey); act = list.indexOf(e); frac = fracOf(curParts, curI, e ? e.durs : []); }
    const w = list.map((e, i) => act < 0 ? 100 : i < act ? 100 : i === act ? Math.round(frac * 1000) / 10 : 0);
    const sig = w.join(',') + '|' + pend;
    if (bar.hidden) bar.hidden = false;
    const sr = stage.getBoundingClientRect(), pos = `${Math.round(sr.left + 10)},${Math.round(Math.max(0, sr.top) + 2)},${Math.round(sr.width - 20)}`;   // 按播放区实际位置摆（各页面的版式、平移不一样）
    if (bar.dataset.pos !== pos) { const [l, t, w2] = pos.split(','); bar.dataset.pos = pos; bar.style.left = l + 'px'; bar.style.top = `calc(${t}px + env(safe-area-inset-top,0px))`; bar.style.width = w2 + 'px'; }
    if (sig === was) return; was = sig;
    const shape = list.length + (pend ? 'p' : '');
    if (bar.dataset.shape !== shape) { bar.dataset.shape = shape;
      bar.innerHTML = list.map((e, i) => `<button data-i="${i}" aria-label="${esc(T('Watch again: ', '回看：') + e.label)}"><i></i></button>`).join('') + (pend ? `<button class="pend" aria-label="${T('Generating', '生成中')}"><i></i></button>` : ''); }
    list.forEach((e, i) => { const b = bar.children[i]; if (b) b.firstChild.style.width = w[i] + '%'; });
  }
  setInterval(paint, 200);

  // ---------- 回看 ----------
  function openReview(i) {
    const e = H.filter(ready)[i]; if (!e || !stage) return;
    closeReview(false);
    const held = [...document.querySelectorAll('video,audio')].filter(m => !m.paused && !(view && view.contains(m)));
    held.forEach(m => m.pause());
    view = document.createElement('div'); view.id = 'rhView';
    view.innerHTML = '<div id="rhTop"><span></span><button type="button"></button></div><div id="rhSub"></div><div id="rhPause" hidden><div>▶</div></div>';
    view.querySelector('#rhTop span').textContent = e.label + (e.her ? ' · ' + T('You: ', '你：') + e.her : '');
    view.querySelector('#rhTop button').textContent = T('Back to now ✕', '回到现在 ✕');
    view.insertAdjacentHTML('beforeend', '<div id="rhLoad" hidden><div><i></i><span></span></div></div>');
    const parts = e.urls.filter(Boolean).map((u, k) => {
      const v = e.key === 'OPEN' ? document.createElement('video') : keepOf(u);   // V2：用留存播放器（多半已经下完）
      if (!v._kept) { v.preload = 'auto'; v.src = u; }
      v.playsInline = true; v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); v.pause(); try { v.playbackRate = 1; } catch (err) {}
      view.insertBefore(v, view.firstChild); if (e.flips[k] && RT.flip) RT.flip(v, e.flips[k]); return { v, d: e.durs[k] };
    });
    stage.appendChild(view); stage.appendChild(bar);   // 进度条留在回看画面上面
    rev = { e, parts, i: 0, held };
    const sub = view.querySelector('#rhSub'), pauseEl = view.querySelector('#rhPause');
    const showSub = c => { sub.innerHTML = c ? (c.who && !/^(你|她|you|her)$/i.test(c.who) ? `<div class="who">${esc(c.who)}</div>` : '') + (c.en ? `<div>${esc(c.en)}</div>` : '') + (c.zh && zh() ? `<div class="zh">${esc(c.zh)}</div>` : '') : ''; };
    const play = k => {
      if (!rev || k >= parts.length) { closeReview(true); return; }
      rev.i = k; const v = parts[k].v, cs = e.cues[k] || [];
      parts.forEach((p, j) => p.v.classList.toggle('on', j === k));
      v.currentTime = 0; v.muted = false;
      v.ontimeupdate = () => { const d = v.duration || parts[k].d || 1, t = v.currentTime;
        const c = cs.find(q => q.rel ? t >= q.rel[0] * d && t < q.rel[1] * d : t >= q.s && t <= q.e); showSub(c || null); };
      v.onended = () => { v.ontimeupdate = null; showSub(null); play(k + 1); };
      const load = view.querySelector('#rhLoad'), lab = load.querySelector('span');
      const ahead = () => { const b = v.buffered; for (let j = 0; j < b.length; j++) if (b.start(j) <= v.currentTime + 0.2 && b.end(j) > v.currentTime) return b.end(j) - v.currentTime; return 0; };
      let warming = false;
      const go = () => { load.hidden = true; if (warming) { warming = false; v.pause(); v.currentTime = 0; } try { v.playbackRate = 1; } catch (err) {} v.muted = false;
        v.play().catch(() => { v.muted = true; v.play().catch(() => {}); }); };
      const ok = () => full(v) || ahead() >= Math.min(8, (v.duration || 15) - v.currentTime - 0.2);
      if (ok()) go();
      else { load.hidden = false; const t0 = Date.now();
        const tick = () => { if (!rev || rev.parts[k].v !== v || rev.i !== k) return;
          const d = v.duration || parts[k].d || 15; lab.textContent = T('Loading ', '加载中 ') + Math.min(99, Math.round(ahead() / d * 100)) + '%';
          if (ok() || Date.now() - t0 > 45000) { go(); return; }
          if (v.paused && v.readyState >= 1) { warming = true; v.muted = true; try { v.playbackRate = 0.0625; } catch (err) {} v.play().catch(() => {}); }   // 暂停的视频浏览器只缓冲一小段：静音慢放让它一直下
          setTimeout(tick, 400); };
        tick(); }
      v.onwaiting = () => { if (rev && rev.parts[k].v === v) { load.hidden = false; lab.textContent = T('Loading…', '加载中…'); } };
      v.onplaying = () => { load.hidden = true; };
    };
    view.querySelector('#rhTop button').onclick = ev => { ev.stopPropagation(); closeReview(true); };
    view.addEventListener('click', ev => { ev.stopPropagation(); if (ev.target.closest('#rhTop')) return; const v = parts[rev.i].v; if (v.paused) { v.play().catch(() => {}); pauseEl.hidden = true; } else { v.pause(); pauseEl.hidden = false; } });
    ['pointerdown', 'touchstart'].forEach(t => view.addEventListener(t, ev => ev.stopPropagation(), { passive: true }));
    play(0); was = ''; paint();
  }
  function closeReview(resume) {
    if (!view) return;
    const r = rev; view.querySelectorAll('video').forEach(v => { v.ontimeupdate = v.onended = v.onwaiting = v.onplaying = null; v.pause(); if (v._kept) { v.muted = true; v.classList.remove('on'); v.remove(); return; } v.removeAttribute('src'); v.load(); });   // 留存播放器拿出来留着，下次回看还用
    view.remove(); view = null; rev = null; was = ''; paint();
    if (resume && r) r.held.forEach(m => { if (m.isConnected) m.play().catch(() => {}); });
  }
})();
