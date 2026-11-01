/* realtime 互动剧通用播放控件（2026-11-01）：进度条、时长、倍速，单击画面暂停和播放。
   第一次看某段内容时进度条只显示不能拖；这段看完过一次，再看时可以随意拖（记在本机 localStorage）。
   用法：页面放一个 #stage，里面正在播的 <video> 带 class="on"，<body> 播放时带 class="playing"。
     RT.init({drama: '剧集id', zh: () => 是否中文, stage: '#stage', isPlaying: () => 正在播});
     RT.begin({key: '这段内容的唯一名字', parts: [{v: video元素, d: 秒数}, ...], label: '第 1 幕', jump: (i, t) => {...}, free: false});
     RT.part(i)  多段连播时切到第 i 段；RT.done(key) 这段看完了；RT.setVoices(fn) 另外同步暂停和变速的配音 <audio>，fn 返回元素列表。
   没调 begin 也能用：会把正在播的那个 video 当成一段。 */
(function () {
  const css = `
#rtBar{position:absolute;left:0;right:0;bottom:0;z-index:5;display:flex;align-items:center;gap:8px;padding:6px max(10px,env(safe-area-inset-right,0px)) calc(10px + env(safe-area-inset-bottom,0px)) max(10px,env(safe-area-inset-left,0px));background:linear-gradient(to top,rgba(0,0,0,.55),transparent);color:#f2f0ea;font-size:12px;font-variant-numeric:tabular-nums;-webkit-user-select:none;user-select:none}
#rtBar[hidden]{display:none}
#rtBar button{background:none;border:0;color:inherit;font:inherit;cursor:pointer;display:grid;place-items:center;min-width:32px;height:32px;padding:0 4px;border-radius:8px;flex:none}
#rtBar button:focus-visible{outline:2px solid #e7b350;outline-offset:1px}
#rtBar svg{width:16px;height:16px;display:block}
#rtTime{white-space:nowrap;flex:none}
#rtTrack{flex:1;min-width:30px;height:28px;display:flex;align-items:center;touch-action:none;cursor:default}
#rtTrack.free{cursor:pointer}
#rtTrack i{display:block;position:relative;width:100%;height:3px;border-radius:3px;background:rgba(255,255,255,.28)}
#rtTrack b{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:3px;background:#e7b350}
#rtTrack u{display:none;position:absolute;top:50%;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.5)}
#rtTrack.free u{display:block}
#rtLabel{white-space:nowrap;flex:none;color:#c9c6be;max-width:64px;overflow:hidden;text-overflow:ellipsis}
#rtMenu{position:absolute;right:max(10px,env(safe-area-inset-right,0px));bottom:calc(52px + env(safe-area-inset-bottom,0px));z-index:9;display:flex;flex-direction:column;background:rgba(14,16,20,.96);border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:4px;color:#f2f0ea;font-size:13px}
#rtMenu[hidden]{display:none}
#rtMenu button{background:none;border:0;color:inherit;font:inherit;cursor:pointer;padding:9px 18px;border-radius:8px}
#rtMenu button.on{color:#e7b350}
#rtPaused{position:absolute;inset:0;z-index:3;display:grid;place-items:center;pointer-events:none}
#rtPaused[hidden]{display:none}
#rtPaused div{width:66px;height:66px;border-radius:50%;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.25);display:grid;place-items:center}
#rtPaused svg{width:26px;height:26px;margin-left:3px}
#rtHint{position:absolute;left:50%;top:calc(120px + env(safe-area-inset-top,0px));white-space:nowrap;transform:translateX(-50%);z-index:9;max-width:88%;text-align:center;background:rgba(0,0,0,.78);border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:7px 13px;color:#f2f0ea;font-size:12px}
#rtHint[hidden]{display:none}`;
  const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>';
  const PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4.5h4v15H6zM14 4.5h4v15h-4z"/></svg>';
  const RATES = [0.75, 1, 1.25, 1.5, 2];
  let drama = 'rt', zh = () => /^zh/i.test(navigator.language || ''), voices = () => [];
  let cur = null, rate = 1, dragging = false, stage, bar, track, fill, knob, timeEl, labelEl, ppBtn, speedBtn, menu, pausedEl, hintEl, hintT;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  const seenKey = () => 'rt-seen:' + drama;
  const seenAll = () => { try { return JSON.parse(store.get(seenKey()) || '{}'); } catch (e) { return {}; } };
  const seen = k => !!seenAll()[k];
  const fmt = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const T = (en, z) => zh() ? z : en;
  const hint = t => { hintEl.textContent = t; hintEl.hidden = false; clearTimeout(hintT); hintT = setTimeout(() => { hintEl.hidden = true; }, 2200); };
  let isPlaying = () => document.body.classList.contains('playing'), once = false, ignoreSel = '';
  const playing = () => isPlaying();
  const active = () => cur && cur.parts[cur.i] ? cur.parts[cur.i].v : stage.querySelector('video.on');
  const durOf = p => (p.v && isFinite(p.v.duration) && p.v.duration > 0 && p.v.dataset.rtSrc === p.v.currentSrc) ? p.v.duration : (p.d || (p.v && isFinite(p.v.duration) ? p.v.duration : 0));
  const total = () => cur ? cur.parts.reduce((a, p) => a + durOf(p), 0) : 0;
  const before = i => cur.parts.slice(0, i).reduce((a, p) => a + durOf(p), 0);
  const nowT = () => cur ? before(cur.i) + ((cur.parts[cur.i].v && cur.parts[cur.i].v.currentTime) || 0) : 0;
  function applyRate() {
    stage.querySelectorAll('video').forEach(v => { v.defaultPlaybackRate = rate; v.playbackRate = rate; });
    (voices() || []).forEach(a => { if (a) { a.defaultPlaybackRate = rate; a.playbackRate = rate; } });
    speedBtn.textContent = rate === 1 ? '1x' : rate + 'x';
    menu.querySelectorAll('button').forEach(b => b.classList.toggle('on', Number(b.dataset.r) === rate));
  }
  function toggle() {
    const v = active(); if (!v) return;
    const list = (voices() || []).filter(Boolean);
    if (v.paused) { v.play().catch(() => {}); list.forEach(a => { if (a.dataset.rtPaused) { delete a.dataset.rtPaused; a.play().catch(() => {}); } }); }
    else { v.pause(); list.forEach(a => { if (!a.paused) { a.dataset.rtPaused = 1; a.pause(); } }); }
    paint();
  }
  function seekTo(T0) {
    if (!cur) return;
    const D = total(); T0 = Math.max(0, Math.min(D - 0.05, T0));
    let i = 0, left = T0;
    while (i < cur.parts.length - 1 && left >= durOf(cur.parts[i])) { left -= durOf(cur.parts[i]); i++; }
    if (i === cur.i) { cur.parts[i].v.currentTime = left; }
    else if (cur.jump) { cur.i = i; cur.jump(i, left); }
    else { cur.parts[cur.i].v.currentTime = left; }
    paint();
  }
  function trackAt(e) { const r = track.getBoundingClientRect(); return total() * Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); }
  function paint() {
    const v = active();
    if (!cur && v && !v.loop) RT.begin({ key: 'clip:' + (v.currentSrc || v.src).split('?')[0], parts: [{ v, d: v.duration }] });
    const on = playing() && !!cur;
    bar.hidden = !on;
    if (!on) { pausedEl.hidden = true; menu.hidden = true; return; }
    const paused = !!(v && v.paused && !v.ended && v.readyState >= 2);
    ppBtn.innerHTML = paused ? PLAY : PAUSE; ppBtn.setAttribute('aria-label', paused ? 'Play' : 'Pause');
    pausedEl.hidden = !paused || dragging;
    const D = total(), t = Math.min(nowT(), D), f = D ? t / D * 100 : 0;
    fill.style.width = f + '%'; knob.style.left = f + '%';
    timeEl.textContent = fmt(t) + ' / ' + fmt(D);
    labelEl.textContent = cur.label || ''; labelEl.hidden = !cur.label;
    track.classList.toggle('free', !!cur.free);
  }
  const RT = window.RT = {
    init(o) {
      o = o || {}; drama = o.drama || drama; if (o.zh) zh = o.zh; if (o.isPlaying) isPlaying = o.isPlaying; ignoreSel = o.ignore || ''; RT.destroy();
      stage = document.querySelector(o.stage || '#stage');
      if (!document.getElementById('rtStyle')) { const st = document.createElement('style'); st.id = 'rtStyle'; st.textContent = css; document.head.appendChild(st); }
      bar = document.createElement('div'); bar.id = 'rtBar'; bar.hidden = true;
      bar.innerHTML = '<button id="rtPP" aria-label="Pause"></button><span id="rtTime">0:00 / 0:00</span><div id="rtTrack" role="slider" aria-label="Progress"><i><b></b><u></u></i></div><span id="rtLabel"></span><button id="rtSpeed" aria-label="Playback speed" aria-haspopup="true">1x</button>';
      menu = document.createElement('div'); menu.id = 'rtMenu'; menu.hidden = true;
      menu.innerHTML = RATES.slice().reverse().map(r => `<button data-r="${r}">${r}x</button>`).join('');
      pausedEl = document.createElement('div'); pausedEl.id = 'rtPaused'; pausedEl.hidden = true; pausedEl.innerHTML = '<div>' + PLAY + '</div>';
      hintEl = document.createElement('div'); hintEl.id = 'rtHint'; hintEl.hidden = true;
      [pausedEl, bar, menu, hintEl].forEach(x => stage.appendChild(x));
      ppBtn = bar.querySelector('#rtPP'); timeEl = bar.querySelector('#rtTime'); track = bar.querySelector('#rtTrack'); fill = track.querySelector('b'); knob = track.querySelector('u'); labelEl = bar.querySelector('#rtLabel'); speedBtn = bar.querySelector('#rtSpeed');
      const saved = Number(store.get('rt-rate')); if (RATES.includes(saved)) rate = saved;
      ppBtn.onclick = e => { e.stopPropagation(); toggle(); };
      speedBtn.onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; };
      menu.onclick = e => { e.stopPropagation(); const r = Number(e.target.dataset.r); if (r) { rate = r; store.set('rt-rate', String(r)); applyRate(); menu.hidden = true; } };
      track.addEventListener('pointerdown', e => {
        e.stopPropagation();
        if (!cur) return;
        if (!cur.free) { hint(T('Scrubbing unlocks after you have watched this once', '第一次体验不能拖动，看完一遍后就能随意拖了')); return; }
        dragging = true; track.setPointerCapture(e.pointerId); seekTo(trackAt(e));
      });
      track.addEventListener('pointermove', e => { if (dragging) seekTo(trackAt(e)); });
      const stop = () => { dragging = false; };
      track.addEventListener('pointerup', stop); track.addEventListener('pointercancel', stop);
      bar.addEventListener('click', e => e.stopPropagation());
      if (!once) { document.addEventListener('click', () => { if (menu) menu.hidden = true; }); }
      stage.addEventListener('click', e => {
        if (!playing() || !cur) return;
        if (e.target.closest('button,input,textarea,select,a,form,label,#sheet,#menu,#liveWait,.card,#rtMenu' + (ignoreSel ? ',' + ignoreSel : ''))) return;
        if (!menu.hidden) { menu.hidden = true; return; }
        toggle();
      });
      if (!once) document.addEventListener('keydown', e => { if (stage && e.code === 'Space' && playing() && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); toggle(); } });
      once = true;
      stage.addEventListener('play', () => applyRate(), true);
      stage.addEventListener('loadedmetadata', e => { e.target.dataset.rtSrc = e.target.currentSrc; e.target.playbackRate = rate; paint(); }, true);
      applyRate();
      const me = (RT._loop = (RT._loop || 0) + 1);
      (function loop() { if (me !== RT._loop) return; try { paint(); } catch (e) {} requestAnimationFrame(loop); })();
      return RT;
    },
    begin(o) {
      cur = { key: o.key, parts: o.parts, i: 0, label: o.label || '', jump: o.jump || null, free: !!o.free || seen(o.key) };
      applyRate(); return RT;
    },
    part(i) { if (cur) cur.i = i; applyRate(); },
    done(k) { const key = k || (cur && cur.key); if (!key) return; const a = seenAll(); a[key] = 1; store.set(seenKey(), JSON.stringify(a)); if (cur && cur.key === key) cur.free = true; },
    clear() { cur = null; },
    destroy() { RT._loop = (RT._loop || 0) + 1; cur = null; [pausedEl, bar, menu, hintEl].forEach(x => x && x.remove()); stage = null; bar = null; menu = null; },
    setVoices(fn) { voices = fn; },
    seen,
  };
})();
