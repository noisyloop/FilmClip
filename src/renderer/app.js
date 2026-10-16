/* FilmClip renderer: library, player, inspector, timeline and export UI. */
'use strict';

const RP = window.RenderPlan;
/* global api — exposed by preload.js via contextBridge */
const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------------------------------------------------------------- state
const state = {
  project: newProject(),
  filePath: null,
  selected: null, // { track, id }
  time: 0,
  playing: false,
  pps: 60, // timeline pixels per second
  undo: [],
  redo: []
};

function newProject() {
  return { version: 1, settings: { width: 1920, height: 1080, fps: 30 }, media: [], tracks: { video: [], text: [], audio: [] } };
}
const P = () => state.project;
const mediaById = (id) => P().media.find((m) => m.id === id);
const findClip = (track, id) => P().tracks[track].find((c) => c.id === id);
const selectedClip = () => (state.selected ? findClip(state.selected.track, state.selected.id) : null);

function snapshot() { return JSON.stringify({ tracks: P().tracks, settings: P().settings }); }
function pushHistory() {
  state.undo.push(snapshot());
  if (state.undo.length > 100) state.undo.shift();
  state.redo = [];
}
function restore(snap) {
  const s = JSON.parse(snap);
  P().tracks = s.tracks;
  P().settings = s.settings;
  if (state.selected && !selectedClip()) state.selected = null;
  refreshAll();
}
function undo() { if (!state.undo.length) return; state.redo.push(snapshot()); restore(state.undo.pop()); }
function redo() { if (!state.redo.length) return; state.undo.push(snapshot()); restore(state.redo.pop()); }

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2400);
}

function timecode(t) {
  t = Math.max(0, t);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60), cs = Math.floor((t * 100) % 100);
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':') + '.' + String(cs).padStart(2, '0');
}
const shortTime = (t) => (t >= 60 ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : `${t.toFixed(1)}s`);

// ---------------------------------------------------------------- presets
const TITLE_PRESETS = [
  { name: 'Basic Title', props: { text: 'Your Title', size: 96, color: '#ffffff', bold: true, x: 0.5, y: 0.5, shadow: true } },
  { name: 'Subtitle', props: { text: 'Subtitle text', size: 48, color: '#ffffff', x: 0.5, y: 0.88, box: true, boxColor: '#000000' } },
  { name: 'Lower Third', props: { text: 'Name Surname\nTitle or role', size: 44, color: '#ffffff', x: 0.24, y: 0.82, box: true, boxColor: '#19d3c5', align: 'left' } },
  { name: 'Big Bold', props: { text: 'BIG NEWS', size: 180, color: '#ffd23f', bold: true, x: 0.5, y: 0.5, outline: true, font: 'Impact' } },
  { name: 'Neon', props: { text: 'Neon Glow', size: 120, color: '#ff4fd8', bold: true, x: 0.5, y: 0.5, glow: true } },
  { name: 'Elegant', props: { text: 'A Story', size: 110, color: '#ffffff', italic: true, x: 0.5, y: 0.45, font: 'Georgia', shadow: true } },
  { name: 'Typewriter', props: { text: 'Chapter One', size: 64, color: '#f2f2f2', x: 0.5, y: 0.5, font: 'Courier New' } },
  { name: 'Credits', props: { text: 'Directed by\nYOU', size: 60, color: '#ffffff', x: 0.5, y: 0.5, font: 'Helvetica' } }
];
const TRANSITION_PRESETS = [
  { name: 'Fade In', icon: '◐', apply: (c) => { c.fadeIn = 1; c.fadeColor = 'black'; } },
  { name: 'Fade Out', icon: '◑', apply: (c) => { c.fadeOut = 1; c.fadeColor = 'black'; } },
  { name: 'Fade In & Out', icon: '◒', apply: (c) => { c.fadeIn = 1; c.fadeOut = 1; c.fadeColor = 'black'; } },
  { name: 'Dip to White', icon: '○', apply: (c) => { c.fadeIn = 0.5; c.fadeOut = 0.5; c.fadeColor = 'white'; } },
  { name: 'Quick Fade', icon: '◔', apply: (c) => { c.fadeIn = 0.3; c.fadeOut = 0.3; c.fadeColor = 'black'; } },
  { name: 'None', icon: '∅', apply: (c) => { c.fadeIn = 0; c.fadeOut = 0; } }
];
const EFFECT_PRESETS = [
  { name: 'Black & White', fx: { grayscale: true }, css: 'grayscale(1)' },
  { name: 'Sepia', fx: { sepia: true }, css: 'sepia(1)' },
  { name: 'Vivid', fx: { saturation: 1.6, contrast: 1.12 }, css: 'saturate(1.6) contrast(1.12)' },
  { name: 'Faded', fx: { saturation: 0.65, contrast: 0.85, brightness: 1.08 }, css: 'saturate(.65) contrast(.85) brightness(1.08)' },
  { name: 'Moody', fx: { brightness: 0.85, contrast: 1.25, saturation: 0.8 }, css: 'brightness(.85) contrast(1.25) saturate(.8)' },
  { name: 'Bright', fx: { brightness: 1.25 }, css: 'brightness(1.25)' },
  { name: 'Blur', fx: { blur: 8 }, css: 'blur(3px)' },
  { name: 'Vignette', fx: { vignette: true }, css: 'brightness(.8)' },
  { name: 'Invert', fx: { invert: true }, css: 'invert(1)' },
  { name: 'Mirror', fx: { flipH: true }, css: 'none', flip: true },
  { name: 'Reset', fx: null, css: 'none' }
];

// ---------------------------------------------------------------- media import
async function importPaths(paths) {
  if (!paths.length) return;
  toast(`Importing ${paths.length} file(s)…`);
  const infos = await api.probe(paths);
  for (const info of infos) {
    if (!info) continue;
    if (P().media.some((m) => m.path === info.path)) continue;
    const m = Object.assign({ id: uid(), previewPath: null, thumb: null }, info);
    P().media.push(m);
    await prepareMedia(m);
  }
  renderLibrary();
}

function mediaSrc(m) { return api.fileUrl(m.previewPath || m.path); }

/** Load the media element for preview (creating a proxy if needed) and grab a thumbnail. */
async function prepareMedia(m) {
  if (m.type === 'image') {
    const img = await loadImage(mediaSrc(m)).catch(() => null);
    if (img) { m.width = m.width || img.naturalWidth; m.height = m.height || img.naturalHeight; m.thumb = thumbFrom(img, img.naturalWidth, img.naturalHeight); }
    return;
  }
  if (m.type === 'audio') return;
  let v = await loadVideo(mediaSrc(m)).catch(() => null);
  if (!v) {
    toast(`Creating preview for ${m.name}…`);
    try { m.previewPath = await api.makeProxy(m.path); v = await loadVideo(mediaSrc(m)); } catch (_) { toast(`Can't preview ${m.name} (export still works)`); return; }
  }
  if (!m.duration) m.duration = v.duration;
  await seekVideo(v, Math.min(1, v.duration / 3));
  m.thumb = thumbFrom(v, v.videoWidth, v.videoHeight);
  preview.videos.set(m.id, v);
}

function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
function loadVideo(src) {
  return new Promise((res, rej) => {
    const v = document.createElement('video');
    v.preload = 'auto'; v.playsInline = true; v.crossOrigin = 'anonymous';
    v.onloadeddata = () => (v.videoWidth ? res(v) : rej(new Error('no video')));
    v.onerror = () => rej(new Error('decode error'));
    v.src = src;
  });
}
function seekVideo(v, t) {
  return new Promise((res) => {
    if (Math.abs(v.currentTime - t) < 0.01 && v.readyState >= 2) return res();
    const done = () => { v.removeEventListener('seeked', done); res(); };
    v.addEventListener('seeked', done);
    v.currentTime = t;
    setTimeout(done, 1500);
  });
}
function thumbFrom(source, w, h) {
  const c = document.createElement('canvas');
  c.width = 192; c.height = 108;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 192, 108);
  const s = Math.min(192 / w, 108 / h);
  g.drawImage(source, (192 - w * s) / 2, (108 - h * s) / 2, w * s, h * s);
  try { return c.toDataURL('image/jpeg', 0.7); } catch (_) { return null; }
}

// ---------------------------------------------------------------- library UI
function mediaTile(m) {
  const t = el('div', 'tile');
  t.draggable = true;
  const icon = m.type === 'audio' ? '♪' : m.type === 'image' ? '🖼' : '🎞';
  const dur = m.type === 'image' ? '' : `<span class="dur">${shortTime(m.duration || 0)}</span>`;
  t.innerHTML = `<div class="thumb" style="${m.thumb ? `background-image:url(${m.thumb})` : ''}">${m.thumb ? '' : icon}${dur}<button class="add" title="Add to timeline">＋</button></div>
    <div class="meta"><div class="name" title="${esc(m.path)}">${esc(m.name)}</div><div class="size">${RP.formatBytes(m.size)}${m.width ? ` · ${m.width}×${m.height}` : ''}</div></div>`;
  t.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-media', m.id); e.dataTransfer.effectAllowed = 'copy'; });
  t.querySelector('.add').addEventListener('click', (e) => { e.stopPropagation(); addMediaToTimeline(m); });
  t.addEventListener('dblclick', () => addMediaToTimeline(m));
  return t;
}

function renderLibrary() {
  const grid = $('#mediaGrid');
  grid.innerHTML = '';
  const visual = P().media;
  visual.forEach((m) => grid.appendChild(mediaTile(m)));
  $('#mediaEmpty').style.display = visual.length ? 'none' : '';
  const total = P().media.reduce((s, m) => s + (m.size || 0), 0);
  $('#libraryTotal').textContent = P().media.length ? `${P().media.length} items · ${RP.formatBytes(total)}` : '';
  const ag = $('#audioGrid');
  ag.innerHTML = '';
  P().media.filter((m) => m.type === 'audio' || (m.type === 'video' && m.hasAudio)).forEach((m) => {
    const t = mediaTile(m);
    t.querySelector('.add').onclick = (e) => { e.stopPropagation(); addAudioClip(m, state.time); };
    t.ondblclick = () => addAudioClip(m, state.time);
    t.addEventListener('dragstart', (e) => e.dataTransfer.setData('application/x-audio', m.id));
    ag.appendChild(t);
  });
  if (!ag.children.length) ag.innerHTML = '<p class="muted">No audio imported yet.</p>';
}

function renderPresets() {
  const tg = $('#titleGrid');
  TITLE_PRESETS.forEach((p, i) => {
    const t = el('div', 'tile fx');
    t.draggable = true;
    const c = document.createElement('canvas');
    c.width = 192; c.height = 108;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 192, 108);
    grad.addColorStop(0, '#2b2f45'); grad.addColorStop(1, '#14151c');
    g.fillStyle = grad; g.fillRect(0, 0, 192, 108);
    drawTitle(g, Object.assign(defaultTitle(), p.props), 192, 108);
    t.innerHTML = `<div class="thumb" style="background-image:url(${c.toDataURL()})"><button class="add">＋</button></div><div class="meta"><div class="name">${p.name}</div></div>`;
    t.addEventListener('dragstart', (e) => e.dataTransfer.setData('application/x-title', String(i)));
    t.querySelector('.add').onclick = () => addTitle(p, state.time);
    t.ondblclick = () => addTitle(p, state.time);
    tg.appendChild(t);
  });
  const trg = $('#transitionGrid');
  TRANSITION_PRESETS.forEach((p) => {
    const t = el('div', 'tile fx', `<div class="thumb" style="background:linear-gradient(90deg,#3a6ff7,#000 50%,#23b26d)"><span style="font-size:28px">${p.icon}</span></div><div class="meta"><div class="name">${p.name}</div></div>`);
    t.onclick = () => applyToSelectedVisual((c) => p.apply(c), p.name);
    trg.appendChild(t);
  });
  const eg = $('#effectGrid');
  EFFECT_PRESETS.forEach((p) => {
    const t = el('div', 'tile fx', `<div class="thumb" style="background:linear-gradient(135deg,#f7a23a,#3a6ff7 60%,#23b26d);filter:${p.css};${p.flip ? 'transform:scaleX(-1)' : ''}"><span style="${p.flip ? 'transform:scaleX(-1)' : ''}">${p.name}</span></div><div class="meta"><div class="name">${p.name}</div></div>`);
    t.onclick = () => applyToSelectedVisual((c) => { c.effects = p.fx ? Object.assign({}, c.effects, p.fx) : Object.assign({}, RP.DEFAULT_EFFECTS); }, p.name);
    eg.appendChild(t);
  });
}

function applyToSelectedVisual(fn, label) {
  const c = selectedClip();
  if (!c || state.selected.track !== 'video') return toast('Select a video or photo clip in the timeline first');
  pushHistory();
  fn(c);
  refreshAll();
  toast(`${label} applied`);
}

// ---------------------------------------------------------------- timeline model ops
function defaultTitle() {
  return { text: 'Title', size: 96, color: '#ffffff', font: 'Helvetica', bold: false, italic: false, x: 0.5, y: 0.5, align: 'center',
    box: false, boxColor: '#000000', shadow: false, outline: false, glow: false, fade: 0.3 };
}

function addMediaToTimeline(m, index) {
  if (m.type === 'audio') return addAudioClip(m, state.time);
  pushHistory();
  const clip = {
    id: uid(), mediaId: m.id, in: 0, out: m.type === 'image' ? 5 : m.duration || 5, speed: 1, volume: 1, muted: false,
    fadeIn: 0, fadeOut: 0, fadeColor: 'black', effects: Object.assign({}, RP.DEFAULT_EFFECTS)
  };
  const v = P().tracks.video;
  if (index == null || index > v.length) v.push(clip); else v.splice(index, 0, clip);
  if (P().tracks.video.length === 1 && m.width && m.height) matchAspect(m);
  state.selected = { track: 'video', id: clip.id };
  refreshAll();
}

function matchAspect(m) {
  const r = m.width / m.height;
  const opts = [['1920x1080', 16 / 9], ['1080x1920', 9 / 16], ['1080x1080', 1], ['1440x1080', 4 / 3]];
  let best = opts[0];
  for (const o of opts) if (Math.abs(o[1] - r) < Math.abs(best[1] - r)) best = o;
  setAspect(best[0]);
}

function addAudioClip(m, start) {
  pushHistory();
  const clip = { id: uid(), mediaId: m.id, start: Math.max(0, start), in: 0, out: m.duration || 5, volume: 1, muted: false, fadeIn: 0, fadeOut: 0 };
  P().tracks.audio.push(clip);
  state.selected = { track: 'audio', id: clip.id };
  refreshAll();
}

function addTitle(preset, start) {
  pushHistory();
  const clip = Object.assign({ id: uid(), start: Math.max(0, start), duration: 4 }, defaultTitle(), preset ? preset.props : {});
  P().tracks.text.push(clip);
  state.selected = { track: 'text', id: clip.id };
  refreshAll();
}

function videoStarts() {
  let t = 0;
  return P().tracks.video.map((c) => { const s = t; t += RP.clipDuration(c); return s; });
}

function deleteSelected() {
  if (!state.selected) return;
  pushHistory();
  const list = P().tracks[state.selected.track];
  const i = list.findIndex((c) => c.id === state.selected.id);
  if (i >= 0) list.splice(i, 1);
  state.selected = null;
  refreshAll();
}

function splitAtPlayhead() {
  const t = state.time;
  const sel = state.selected;
  const tryTrack = (track) => {
    const list = P().tracks[track];
    const starts = track === 'video' ? videoStarts() : list.map((c) => c.start);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (sel && sel.track === track && sel.id !== c.id) continue;
      const len = track === 'text' ? c.duration : RP.clipDuration(c);
      const local = t - starts[i];
      if (local > 0.05 && local < len - 0.05) {
        pushHistory();
        const b = JSON.parse(JSON.stringify(c));
        b.id = uid();
        if (track === 'text') { c.duration = local; b.start = t; b.duration = len - local; }
        else {
          const cut = c.in + local * (c.speed || 1);
          c.out = cut; b.in = cut;
          if (track === 'audio') b.start = t;
          c.fadeOut = 0; b.fadeIn = 0;
        }
        list.splice(i + 1, 0, b);
        state.selected = { track, id: b.id };
        return true;
      }
    }
    return false;
  };
  const order = sel ? [sel.track] : ['video', 'text', 'audio'];
  if (!order.some(tryTrack)) return toast('Move the playhead over a clip to split it');
  refreshAll();
}

// ---------------------------------------------------------------- timeline UI
const tracksEl = $('#tracks');
const scrollEl = $('#tracksScroll');

function renderTimeline() {
  const dur = RP.projectDuration(P());
  const width = Math.max(scrollEl.clientWidth, (dur + 20) * state.pps);
  tracksEl.style.width = width + 'px';

  // Ruler
  const ruler = $('#ruler');
  ruler.innerHTML = '';
  const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * state.pps >= 60) || 600;
  for (let k = 0; (k * step) / 5 * state.pps < width; k++) {
    const s = (k * step) / 5;
    const major = k % 5 === 0;
    const tick = el('div', 'tick' + (major ? ' major' : ''));
    tick.style.left = s * state.pps + 'px';
    if (major) tick.innerHTML = `<span>${step < 1 ? s.toFixed(1) + 's' : timecode(Math.round(s)).slice(3, 8)}</span>`;
    ruler.appendChild(tick);
  }

  const starts = videoStarts();
  const tv = $('#trackVideo'); tv.innerHTML = '';
  P().tracks.video.forEach((c, i) => {
    const m = mediaById(c.mediaId);
    const d = clipEl(c, 'video', starts[i], RP.clipDuration(c), (m ? m.name : 'Missing') + (c.speed !== 1 ? `  ${c.speed}×` : ''));
    if (m && m.thumb) d.style.backgroundImage = `url(${m.thumb})`;
    const fx = c.effects || {};
    const badges = [];
    if (c.fadeIn || c.fadeOut) badges.push('◐');
    if (fx.grayscale || fx.sepia || fx.invert || fx.vignette || fx.blur || fx.brightness !== 1 || fx.contrast !== 1 || fx.saturation !== 1 || fx.flipH || fx.flipV) badges.push('✦');
    if (badges.length) d.appendChild(el('span', 'fx-badge', badges.join(' ')));
    tv.appendChild(d);
  });
  const tt = $('#trackText'); tt.innerHTML = '';
  P().tracks.text.forEach((c) => tt.appendChild(clipEl(c, 'text', c.start, c.duration, 'T  ' + c.text.split('\n')[0])));
  const ta = $('#trackAudio'); ta.innerHTML = '';
  P().tracks.audio.forEach((c) => { const m = mediaById(c.mediaId); ta.appendChild(clipEl(c, 'audio', c.start, RP.clipDuration(c), '♪  ' + (m ? m.name : 'Missing'))); });
  updatePlayhead();
}

function clipEl(c, track, start, len, label) {
  const d = el('div', `clip ${track}` + (state.selected && state.selected.id === c.id ? ' selected' : ''));
  d.style.left = start * state.pps + 'px';
  d.style.width = Math.max(4, len * state.pps) + 'px';
  d.dataset.id = c.id;
  d.dataset.track = track;
  d.innerHTML = `<div class="handle l"></div><span class="label">${esc(label)}</span><div class="handle r"></div>`;
  d.addEventListener('pointerdown', (e) => startClipDrag(e, c, track, d));
  return d;
}

function startClipDrag(e, clip, track, node) {
  e.stopPropagation();
  state.selected = { track, id: clip.id };
  document.querySelectorAll('.clip.selected').forEach((n) => n.classList.remove('selected'));
  node.classList.add('selected');
  renderInspector();
  const mode = e.target.classList.contains('l') ? 'left' : e.target.classList.contains('r') ? 'right' : 'move';
  const x0 = e.clientX;
  const orig = JSON.parse(JSON.stringify(clip));
  const m = mediaById(clip.mediaId);
  const maxOut = m && m.type !== 'image' ? m.duration || orig.out : 3600;
  let changed = false;
  node.setPointerCapture(e.pointerId);

  const onMove = (ev) => {
    const dt = (ev.clientX - x0) / state.pps;
    if (!changed && Math.abs(ev.clientX - x0) < 3) return;
    if (!changed) { pushHistory(); changed = true; }
    const speed = clip.speed || 1;
    if (track === 'text') {
      if (mode === 'move') clip.start = Math.max(0, orig.start + dt);
      else if (mode === 'right') clip.duration = Math.max(0.2, orig.duration + dt);
      else { const ns = clamp(orig.start + dt, 0, orig.start + orig.duration - 0.2); clip.duration = orig.duration - (ns - orig.start); clip.start = ns; }
    } else if (mode === 'right') {
      clip.out = clamp(orig.out + dt * speed, orig.in + 0.1, maxOut);
    } else if (mode === 'left') {
      const nin = clamp(orig.in + dt * speed, 0, orig.out - 0.1);
      if (track === 'audio') clip.start = Math.max(0, orig.start + (nin - orig.in) / speed);
      clip.in = nin;
    } else if (track === 'audio') {
      clip.start = Math.max(0, orig.start + dt);
    } else {
      node.style.transform = `translateX(${ev.clientX - x0}px)`;
      node.style.zIndex = 4;
      return;
    }
    renderTimeline();
    renderPreviewFrame();
  };
  const onUp = (ev) => {
    node.removeEventListener('pointermove', onMove);
    node.removeEventListener('pointerup', onUp);
    if (changed && track === 'video' && mode === 'move') {
      const list = P().tracks.video;
      const from = list.indexOf(clip);
      const starts = videoStarts();
      const center = starts[from] + RP.clipDuration(clip) / 2 + (ev.clientX - x0) / state.pps;
      list.splice(from, 1);
      let to = 0;
      let acc = 0;
      for (const c of list) { if (center > acc + RP.clipDuration(c) / 2) to++; acc += RP.clipDuration(c); }
      list.splice(to, 0, clip);
    }
    if (!changed) {
      // plain click: move playhead too
      const rect = tracksEl.getBoundingClientRect();
      setTime((ev.clientX - rect.left) / state.pps);
    }
    refreshAll();
  };
  node.addEventListener('pointermove', onMove);
  node.addEventListener('pointerup', onUp);
}

function updatePlayhead() {
  $('#playhead').style.left = state.time * state.pps + 'px';
  $('#curTime').textContent = timecode(state.time);
  $('#totalTime').textContent = timecode(RP.projectDuration(P()));
}

function setupTimelineEvents() {
  const scrub = (e) => {
    const rect = tracksEl.getBoundingClientRect();
    setTime((e.clientX - rect.left) / state.pps);
  };
  const startScrub = (e) => {
    if (e.target.closest('.clip')) return;
    if (e.target.closest('.track')) { state.selected = null; renderTimeline(); renderInspector(); }
    pause();
    scrub(e);
    const mv = (ev) => scrub(ev);
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };
  tracksEl.addEventListener('pointerdown', startScrub);
  $('.playhead .knob').addEventListener('pointerdown', startScrub);

  $('#zoom').addEventListener('input', (e) => { state.pps = Number(e.target.value); renderTimeline(); });
  scrollEl.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); state.pps = clamp(state.pps * (e.deltaY < 0 ? 1.1 : 0.9), 10, 300); $('#zoom').value = state.pps; renderTimeline(); }
  }, { passive: false });

  // Drops from the library
  for (const tr of document.querySelectorAll('.track')) {
    tr.addEventListener('dragover', (e) => { e.preventDefault(); tr.classList.add('drop'); });
    tr.addEventListener('dragleave', () => tr.classList.remove('drop'));
    tr.addEventListener('drop', (e) => {
      e.preventDefault();
      tr.classList.remove('drop');
      const rect = tracksEl.getBoundingClientRect();
      const t = Math.max(0, (e.clientX - rect.left) / state.pps);
      const mid = e.dataTransfer.getData('application/x-media') || e.dataTransfer.getData('application/x-audio');
      const title = e.dataTransfer.getData('application/x-title');
      const kind = tr.dataset.track;
      if (title !== '') return addTitle(TITLE_PRESETS[Number(title)], t);
      const m = mid && mediaById(mid);
      if (!m) return;
      if (kind === 'audio' || m.type === 'audio') {
        if (m.type === 'image') return toast('Photos go on the video track');
        return addAudioClip(m, t);
      }
      if (kind === 'video') {
        let idx = 0, acc = 0;
        for (const c of P().tracks.video) { if (t > acc + RP.clipDuration(c) / 2) idx++; acc += RP.clipDuration(c); }
        return addMediaToTimeline(m, idx);
      }
      addMediaToTimeline(m);
    });
  }
}

// ---------------------------------------------------------------- inspector
function renderInspector() {
  const body = $('#inspectorBody');
  body.innerHTML = '';
  const c = selectedClip();
  $('#inspectorEmpty').style.display = c ? 'none' : '';
  if (!c) return;
  const track = state.selected.track;
  const m = c.mediaId ? mediaById(c.mediaId) : null;
  const section = (title) => { const s = el('div', 'insp-section', `<h4>${title}</h4>`); body.appendChild(s); return s; };
  let dirty = false;
  const commit = () => { renderTimeline(); renderPreviewFrame(); };
  const slider = (parent, label, obj, key, min, max, step, fmtv = (v) => v) => {
    const r = el('div', 'row', `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}"><output></output>`);
    const inp = r.querySelector('input'), out = r.querySelector('output');
    inp.value = obj[key] ?? 0; out.textContent = fmtv(Number(inp.value));
    inp.addEventListener('input', () => { if (!dirty) { pushHistory(); dirty = true; } obj[key] = Number(inp.value); out.textContent = fmtv(obj[key]); commit(); });
    inp.addEventListener('change', () => { dirty = false; });
    inp.addEventListener('dblclick', () => { pushHistory(); obj[key] = key === 'blur' ? 0 : 1; renderInspector(); commit(); });
    parent.appendChild(r);
  };
  const check = (parent, label, obj, key) => {
    const l = el('label', '', `<input type="checkbox"> ${label}`);
    const i = l.querySelector('input'); i.checked = !!obj[key];
    i.addEventListener('change', () => { pushHistory(); obj[key] = i.checked; commit(); });
    parent.appendChild(l);
  };
  const pct = (v) => Math.round(v * 100) + '%';
  const secs = (v) => v.toFixed(1) + 's';

  if (track === 'text') {
    body.appendChild(el('div', 'insp-title', 'Title'));
    const s = section('Text');
    const r = el('div', 'row full', '<span>Text</span><textarea rows="3"></textarea>');
    const ta = r.querySelector('textarea'); ta.value = c.text;
    ta.addEventListener('focus', () => pushHistory());
    ta.addEventListener('input', () => { c.text = ta.value; commit(); });
    s.appendChild(r);
    const fr = el('div', 'row full', '<span>Font</span><select></select>');
    const fs = fr.querySelector('select');
    ['Helvetica', 'Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Impact', 'Futura', 'Avenir', 'Menlo'].forEach((f) => fs.add(new Option(f, f, false, f === c.font)));
    fs.onchange = () => { pushHistory(); c.font = fs.value; commit(); };
    s.appendChild(fr);
    const cr = el('div', 'row full', '<span>Color</span><input type="color">');
    const ci = cr.querySelector('input'); ci.value = c.color;
    ci.oninput = () => { c.color = ci.value; commit(); }; ci.onfocus = () => pushHistory();
    s.appendChild(cr);
    slider(s, 'Size', c, 'size', 12, 300, 1, (v) => v + 'px');
    const ck = el('div', 'checks'); s.appendChild(ck);
    check(ck, 'Bold', c, 'bold'); check(ck, 'Italic', c, 'italic'); check(ck, 'Shadow', c, 'shadow'); check(ck, 'Outline', c, 'outline'); check(ck, 'Glow', c, 'glow'); check(ck, 'Background', c, 'box');
    const br = el('div', 'row full', '<span>Box color</span><input type="color">');
    const bi = br.querySelector('input'); bi.value = c.boxColor || '#000000';
    bi.oninput = () => { c.boxColor = bi.value; commit(); }; bi.onfocus = () => pushHistory();
    s.appendChild(br);
    const p = section('Position & Timing');
    slider(p, 'X', c, 'x', 0, 1, 0.01, pct);
    slider(p, 'Y', c, 'y', 0, 1, 0.01, pct);
    slider(p, 'Duration', c, 'duration', 0.5, 30, 0.1, secs);
    slider(p, 'Fade', c, 'fade', 0, 2, 0.1, secs);
    return;
  }

  body.appendChild(el('div', 'insp-title', esc(m ? m.name : 'Clip')));
  if (m) {
    const info = section('Info');
    info.appendChild(el('div', 'muted', `${m.type} · ${RP.formatBytes(m.size)}${m.width ? ` · ${m.width}×${m.height}` : ''}<br>Length on timeline: ${secs(RP.clipDuration(c))}`));
  }
  if (track === 'audio') {
    const a = section('Audio');
    slider(a, 'Volume', c, 'volume', 0, 2, 0.01, pct);
    slider(a, 'Fade in', c, 'fadeIn', 0, 5, 0.1, secs);
    slider(a, 'Fade out', c, 'fadeOut', 0, 5, 0.1, secs);
    const ck = el('div', 'checks'); a.appendChild(ck); check(ck, 'Mute', c, 'muted');
    return;
  }
  const isImage = m && m.type === 'image';
  const b = section('Basic');
  if (isImage) {
    const tmp = { d: c.out - c.in };
    slider(b, 'Duration', tmp, 'd', 0.5, 30, 0.1, secs);
    b.lastChild.querySelector('input').addEventListener('input', () => { c.out = c.in + tmp.d; commit(); });
  } else {
    slider(b, 'Speed', c, 'speed', 0.25, 4, 0.05, (v) => v.toFixed(2) + '×');
    slider(b, 'Volume', c, 'volume', 0, 2, 0.01, pct);
    const ck = el('div', 'checks'); b.appendChild(ck); check(ck, 'Mute', c, 'muted');
  }
  const fx = c.effects;
  const col = section('Color');
  slider(col, 'Brightness', fx, 'brightness', 0, 2, 0.01, pct);
  slider(col, 'Contrast', fx, 'contrast', 0, 2, 0.01, pct);
  slider(col, 'Saturation', fx, 'saturation', 0, 3, 0.01, pct);
  slider(col, 'Blur', fx, 'blur', 0, 40, 0.5, (v) => v.toFixed(1));
  const f = section('Effects');
  const ck = el('div', 'checks'); f.appendChild(ck);
  check(ck, 'B&amp;W', fx, 'grayscale'); check(ck, 'Sepia', fx, 'sepia'); check(ck, 'Invert', fx, 'invert'); check(ck, 'Vignette', fx, 'vignette'); check(ck, 'Flip H', fx, 'flipH'); check(ck, 'Flip V', fx, 'flipV');
  const t = section('Transition');
  slider(t, 'Fade in', c, 'fadeIn', 0, 3, 0.1, secs);
  slider(t, 'Fade out', c, 'fadeOut', 0, 3, 0.1, secs);
  const fc = el('div', 'row full', '<span>Fade color</span><select><option value="black">Black</option><option value="white">White</option></select>');
  const fcs = fc.querySelector('select'); fcs.value = c.fadeColor || 'black';
  fcs.onchange = () => { pushHistory(); c.fadeColor = fcs.value; commit(); };
  t.appendChild(fc);
  const reset = el('button', 'btn', 'Reset all effects');
  reset.style.margin = '12px';
  reset.onclick = () => { pushHistory(); c.effects = Object.assign({}, RP.DEFAULT_EFFECTS); c.fadeIn = c.fadeOut = 0; renderInspector(); commit(); };
  body.appendChild(reset);
}

// ---------------------------------------------------------------- titles rendering (shared by preview + export)
function drawTitle(g, t, W, H, alpha = 1) {
  if (!t.text) return;
  const scale = H / 1080;
  const size = Math.max(4, t.size * scale);
  g.save();
  g.globalAlpha = alpha;
  g.font = `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${size}px "${t.font || 'Helvetica'}", Helvetica, Arial, sans-serif`;
  g.textAlign = t.align || 'center';
  g.textBaseline = 'middle';
  const lines = t.text.split('\n');
  const lh = size * 1.2;
  const x = t.x * W;
  const y0 = t.y * H - ((lines.length - 1) * lh) / 2;
  if (t.box) {
    const widths = lines.map((l) => g.measureText(l).width);
    const bw = Math.max(...widths) + size * 0.8;
    const bh = lines.length * lh + size * 0.4;
    const bx = g.textAlign === 'left' ? x - size * 0.4 : g.textAlign === 'right' ? x - bw + size * 0.4 : x - bw / 2;
    g.fillStyle = t.boxColor || '#000';
    g.globalAlpha = alpha * 0.8;
    g.fillRect(bx, y0 - lh / 2 - size * 0.2, bw, bh);
    g.globalAlpha = alpha;
  }
  lines.forEach((line, i) => {
    const y = y0 + i * lh;
    if (t.shadow) { g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = size * 0.15; g.shadowOffsetY = size * 0.05; }
    if (t.glow) { g.shadowColor = t.color; g.shadowBlur = size * 0.4; }
    if (t.outline) { g.lineWidth = Math.max(1, size * 0.06); g.strokeStyle = '#000'; g.lineJoin = 'round'; g.strokeText(line, x, y); }
    g.fillStyle = t.color;
    g.fillText(line, x, y);
    if (t.glow) g.fillText(line, x, y);
  });
  g.restore();
}

function titleAlpha(t, time) {
  const local = time - t.start;
  if (local < 0 || local > t.duration) return 0;
  const f = Math.min(t.fade || 0, t.duration / 2);
  if (f <= 0) return 1;
  return clamp(Math.min(local / f, (t.duration - local) / f), 0, 1);
}

// ---------------------------------------------------------------- preview engine
const canvas = $('#preview');
const ctx = canvas.getContext('2d');
const preview = { videos: new Map(), images: new Map(), audios: new Map(), active: null, raf: 0, wall: 0, t0: 0 };

function setAspect(value) {
  const [w, h] = value.split('x').map(Number);
  P().settings.width = w; P().settings.height = h;
  $('#aspectSelect').value = value;
  const maxW = 960, maxH = 540;
  const s = Math.min(maxW / w, maxH / h);
  canvas.width = Math.round(w * s); canvas.height = Math.round(h * s);
  renderPreviewFrame();
}

function locate(t) {
  let acc = 0;
  for (const c of P().tracks.video) {
    const d = RP.clipDuration(c);
    if (t < acc + d || (c === P().tracks.video[P().tracks.video.length - 1] && t <= acc + d + 1e-3 && t >= acc)) {
      return { clip: c, local: Math.min(t - acc, d), dur: d, src: c.in + Math.min(t - acc, d) * (c.speed || 1) };
    }
    acc += d;
  }
  return null;
}

function cssFilter(fx, scale) {
  const e = Object.assign({}, RP.DEFAULT_EFFECTS, fx);
  const f = [];
  if (e.brightness !== 1) f.push(`brightness(${e.brightness})`);
  if (e.contrast !== 1) f.push(`contrast(${e.contrast})`);
  if (e.saturation !== 1) f.push(`saturate(${e.saturation})`);
  if (e.grayscale) f.push('grayscale(1)');
  if (e.sepia) f.push('sepia(1)');
  if (e.invert) f.push('invert(1)');
  if (e.blur > 0) f.push(`blur(${(e.blur * scale).toFixed(2)}px)`);
  return f.length ? f.join(' ') : 'none';
}

function sourceFor(m) {
  if (!m) return null;
  if (m.type === 'image') {
    let img = preview.images.get(m.id);
    if (!img) { img = new Image(); img.onload = renderPreviewFrame; img.src = mediaSrc(m); preview.images.set(m.id, img); }
    return img.complete && img.naturalWidth ? { el: img, w: img.naturalWidth, h: img.naturalHeight } : null;
  }
  const v = preview.videos.get(m.id);
  return v && v.readyState >= 2 ? { el: v, w: v.videoWidth, h: v.videoHeight } : null;
}

function drawFrame(t) {
  const W = canvas.width, H = canvas.height;
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const hit = locate(t);
  if (hit) {
    const c = hit.clip;
    const src = sourceFor(mediaById(c.mediaId));
    if (src) {
      const s = Math.min(W / src.w, H / src.h);
      const dw = src.w * s, dh = src.h * s, dx = (W - dw) / 2, dy = (H - dh) / 2;
      const fx = c.effects || {};
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.scale(fx.flipH ? -1 : 1, fx.flipV ? -1 : 1);
      ctx.translate(-W / 2, -H / 2);
      ctx.filter = cssFilter(fx, W / 1920);
      ctx.drawImage(src.el, dx, dy, dw, dh);
      ctx.restore();
      if (fx.vignette) {
        const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(dw, dh) * 0.3, W / 2, H / 2, Math.hypot(dw, dh) / 2);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.7)');
        ctx.fillStyle = g; ctx.fillRect(dx, dy, dw, dh);
      }
    }
    const fi = Math.min(c.fadeIn || 0, hit.dur / 2), fo = Math.min(c.fadeOut || 0, hit.dur / 2);
    let a = 0;
    if (fi > 0 && hit.local < fi) a = 1 - hit.local / fi;
    if (fo > 0 && hit.local > hit.dur - fo) a = Math.max(a, (hit.local - (hit.dur - fo)) / fo);
    if (a > 0) { ctx.globalAlpha = clamp(a, 0, 1); ctx.fillStyle = c.fadeColor === 'white' ? '#fff' : '#000'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  }
  for (const tc of P().tracks.text) {
    const a = titleAlpha(tc, t);
    if (a > 0) drawTitle(ctx, tc, W, H, a);
  }
  ctx.restore();
}

function renderPreviewFrame() {
  if (state.playing) return;
  const hit = locate(state.time);
  if (hit) {
    const m = mediaById(hit.clip.mediaId);
    const v = m && preview.videos.get(m.id);
    if (v && Math.abs(v.currentTime - hit.src) > 0.02) {
      v.currentTime = hit.src;
      v.addEventListener('seeked', () => drawFrame(state.time), { once: true });
    }
  }
  drawFrame(state.time);
}

function setTime(t) {
  state.time = clamp(t, 0, Math.max(0, RP.projectDuration(P())));
  if (state.playing) { preview.t0 = state.time; preview.wall = performance.now(); syncMedia(true); }
  updatePlayhead();
  renderPreviewFrame();
}

function syncMedia(force) {
  const t = state.time;
  const hit = locate(t);
  const activeV = hit ? preview.videos.get(hit.clip.mediaId) : null;
  for (const v of preview.videos.values()) if (v !== activeV && !v.paused) v.pause();
  if (activeV && hit) {
    const c = hit.clip;
    activeV.playbackRate = c.speed || 1;
    activeV.volume = c.muted ? 0 : clamp(c.volume ?? 1, 0, 1);
    if (force || preview.active !== c.id || Math.abs(activeV.currentTime - hit.src) > 0.3) activeV.currentTime = hit.src;
    if (activeV.paused) activeV.play().catch(() => {});
    preview.active = c.id;
  } else preview.active = null;

  for (const ac of P().tracks.audio) {
    const m = mediaById(ac.mediaId);
    if (!m) continue;
    let a = preview.audios.get(ac.id);
    if (!a) { a = new Audio(api.fileUrl(m.previewPath || m.path)); preview.audios.set(ac.id, a); }
    const local = t - ac.start;
    const len = RP.clipDuration(ac);
    if (local >= 0 && local < len) {
      const fi = ac.fadeIn || 0, fo = ac.fadeOut || 0;
      let g = 1;
      if (fi > 0 && local < fi) g = local / fi;
      if (fo > 0 && local > len - fo) g = Math.min(g, (len - local) / fo);
      a.volume = ac.muted ? 0 : clamp((ac.volume ?? 1) * g, 0, 1);
      const want = ac.in + local;
      if (force || Math.abs(a.currentTime - want) > 0.3) a.currentTime = want;
      if (a.paused) a.play().catch(() => {});
    } else if (!a.paused) a.pause();
  }
}

function play() {
  const total = RP.projectDuration(P());
  if (total <= 0) return toast('Add some media to the timeline first');
  if (state.time >= total - 0.01) state.time = 0;
  state.playing = true;
  $('#playBtn').textContent = '❚❚';
  preview.t0 = state.time;
  preview.wall = performance.now();
  syncMedia(true);
  const loop = () => {
    if (!state.playing) return;
    state.time = preview.t0 + (performance.now() - preview.wall) / 1000;
    if (state.time >= total) { state.time = total; pause(); updatePlayhead(); return; }
    syncMedia(false);
    drawFrame(state.time);
    updatePlayhead();
    const x = state.time * state.pps;
    if (x > scrollEl.scrollLeft + scrollEl.clientWidth - 40) scrollEl.scrollLeft = x - 80;
    preview.raf = requestAnimationFrame(loop);
  };
  preview.raf = requestAnimationFrame(loop);
}

function pause() {
  state.playing = false;
  cancelAnimationFrame(preview.raf);
  $('#playBtn').textContent = '▶';
  for (const v of preview.videos.values()) v.pause();
  for (const a of preview.audios.values()) a.pause();
  renderPreviewFrame();
}

// ---------------------------------------------------------------- export
const FMT_OPTS = () => ({
  format: $('#exFormat').value, resolution: $('#exRes').value, quality: $('#exQuality').value,
  targetMB: Number($('#exTarget').value), fps: Number($('#exFps').value)
});

function setupExportDialog() {
  for (const [id, f] of Object.entries(RP.FORMATS)) $('#exFormat').add(new Option(f.label, id));
  for (const r of RP.RESOLUTIONS) $('#exRes').add(new Option(r.label, r.id, false, r.id === '1080'));
  const update = () => {
    const o = FMT_OPTS();
    $('#exTargetWrap').hidden = o.quality !== 'target';
    const b = RP.bitrates(P(), o);
    $('#exDur').textContent = timecode(b.duration).slice(3);
    $('#exDims').textContent = RP.FORMATS[o.format].video ? `${b.size.width}×${b.size.height}` : 'Audio';
    $('#exBitrate').textContent = o.format === 'gif' ? 'Palette' : `${((b.video + b.audio) / 1000).toFixed(1)} Mbps`;
    $('#exSize').textContent = '≈ ' + RP.formatBytes(RP.estimateSize(P(), o));
  };
  ['#exFormat', '#exRes', '#exQuality', '#exTarget', '#exFps'].forEach((s) => $(s).addEventListener('input', update));
  setupExportDialog.update = update;

  let busy = false;
  $('#exCancel').addEventListener('click', (e) => {
    if (busy) { e.preventDefault(); api.cancelExport(); }
  });
  $('#exGo').addEventListener('click', async (e) => {
    e.preventDefault();
    if (busy) return;
    const o = FMT_OPTS();
    const ext = RP.FORMATS[o.format].ext;
    const out = await api.pickExportPath($('#exName').value || 'My Video', ext);
    if (!out) return;
    o.outputPath = out;
    const size = RP.outputSize(P(), o.resolution);
    const textImages = {};
    for (const tc of P().tracks.text) {
      const c = document.createElement('canvas');
      c.width = size.width; c.height = size.height;
      drawTitle(c.getContext('2d'), tc, size.width, size.height, 1);
      textImages[tc.id] = c.toDataURL('image/png');
    }
    busy = true;
    $('#exGo').disabled = true;
    $('#exCancel').textContent = 'Stop';
    $('#exProgressWrap').hidden = false;
    $('#exResult').textContent = 'Rendering…';
    $('#exProgress').style.width = '0';
    const project = JSON.parse(JSON.stringify(P()));
    project.media.forEach((m) => delete m.thumb);
    const r = await api.startExport({ project, opts: o, textImages });
    busy = false;
    $('#exGo').disabled = false;
    $('#exCancel').textContent = 'Close';
    if (r.ok) {
      $('#exProgress').style.width = '100%';
      $('#exResult').innerHTML = `✅ Exported <b>${RP.formatBytes(r.size)}</b> to ${esc(r.path)} &nbsp;<a href="#" id="revealLink" class="accent">Show in folder</a>`;
      $('#revealLink').onclick = (ev) => { ev.preventDefault(); api.reveal(r.path); };
    } else {
      $('#exProgressWrap').hidden = true;
      $('#exResult').textContent = r.canceled ? 'Export canceled.' : `Export failed:\n${r.error}`;
    }
  });
  api.onProgress((p) => { $('#exProgress').style.width = (p * 100).toFixed(1) + '%'; $('#exProgressText').textContent = Math.round(p * 100) + '%'; });
}

function openExport() {
  pause();
  if (RP.projectDuration(P()) <= 0) return toast('Nothing to export yet — add media to the timeline');
  $('#exProgressWrap').hidden = true;
  $('#exResult').textContent = '';
  $('#exCancel').textContent = 'Cancel';
  setupExportDialog.update();
  $('#exportDialog').showModal();
}

// ---------------------------------------------------------------- project files
async function saveProject(as) {
  const data = JSON.parse(JSON.stringify(P()));
  const p = await api.saveProject(as ? null : state.filePath, data);
  if (p) { state.filePath = p; setTitle(); toast('Project saved'); }
}
async function openProject() {
  const r = await api.openProject();
  if (!r) return;
  pause();
  state.project = Object.assign(newProject(), r.data);
  state.filePath = r.filePath;
  state.undo = []; state.redo = []; state.selected = null; state.time = 0;
  preview.videos.clear(); preview.images.clear(); preview.audios.clear();
  for (const m of P().media) await prepareMedia(m);
  setAspect(`${P().settings.width}x${P().settings.height}`);
  setTitle();
  refreshAll();
  renderLibrary();
}
function newProjectCmd() {
  if (P().tracks.video.length + P().tracks.text.length + P().tracks.audio.length && !confirm('Start a new project? Unsaved changes will be lost.')) return;
  pause();
  state.project = newProject();
  state.filePath = null; state.undo = []; state.redo = []; state.selected = null; state.time = 0;
  setAspect('1920x1080'); setTitle(); refreshAll(); renderLibrary();
}
function setTitle() {
  const name = state.filePath ? state.filePath.split(/[\\/]/).pop().replace(/\.fcproj$/, '') : 'Untitled Project';
  $('#projectName').textContent = name;
  document.title = `${name} — FilmClip`;
}

// ---------------------------------------------------------------- wiring
function refreshAll() { renderTimeline(); renderInspector(); renderPreviewFrame(); }

function setupUI() {
  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tab-pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === b.dataset.tab));
  }));
  $('#importBtn').onclick = async () => importPaths(await api.pickMedia());
  $('#exportBtn').onclick = openExport;
  $('#playBtn').onclick = () => (state.playing ? pause() : play());
  $('#toStart').onclick = () => setTime(0);
  $('#toEnd').onclick = () => setTime(RP.projectDuration(P()));
  $('#stepBack').onclick = () => { pause(); setTime(state.time - 1 / P().settings.fps); };
  $('#stepFwd').onclick = () => { pause(); setTime(state.time + 1 / P().settings.fps); };
  $('#undoBtn').onclick = undo;
  $('#redoBtn').onclick = redo;
  $('#splitBtn').onclick = splitAtPlayhead;
  $('#deleteBtn').onclick = deleteSelected;
  $('#addTextBtn').onclick = () => addTitle(TITLE_PRESETS[0], state.time);
  $('#aspectSelect').onchange = (e) => { pushHistory(); setAspect(e.target.value); };

  const dz = document.body;
  dz.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); $('#dropZone').classList.add('over'); } });
  dz.addEventListener('dragleave', (e) => { if (!e.relatedTarget) $('#dropZone').classList.remove('over'); });
  dz.addEventListener('drop', (e) => {
    $('#dropZone').classList.remove('over');
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    importPaths([...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean));
  });

  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.code === 'Space') { e.preventDefault(); state.playing ? pause() : play(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
    else if (e.key === 'ArrowLeft') { pause(); setTime(state.time - (e.shiftKey ? 1 : 1 / P().settings.fps)); }
    else if (e.key === 'ArrowRight') { pause(); setTime(state.time + (e.shiftKey ? 1 : 1 / P().settings.fps)); }
    else if (e.key === 'Home') setTime(0);
    else if (e.key === 'End') setTime(RP.projectDuration(P()));
    else if (!mod && e.key.toLowerCase() === 's') splitAtPlayhead();
  });

  api.onMenu((cmd) => {
    ({ new: newProjectCmd, open: openProject, save: () => saveProject(false), saveAs: () => saveProject(true),
      import: async () => importPaths(await api.pickMedia()), export: openExport, undo, redo, split: splitAtPlayhead })[cmd]?.();
  });
  window.addEventListener('resize', renderTimeline);
}

renderPresets();
setupUI();
setupTimelineEvents();
setupExportDialog();
setAspect('1920x1080');
renderLibrary();
refreshAll();
