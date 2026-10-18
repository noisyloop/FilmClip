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
  redo: [],
  clipboard: null // { track, clip }
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
  state.time = clamp(state.time, 0, RP.projectDuration(P()));
  refreshAll();
  updatePlayhead();
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
/** Timeline start / length of any clip. */
function clipStart(track, c) { return track === 'video' ? videoStarts()[P().tracks.video.indexOf(c)] : c.start; }
function clipLen(track, c) { return track === 'text' ? c.duration : RP.clipDuration(c); }
const clone = (o) => JSON.parse(JSON.stringify(o));
const isImageClip = (c) => { const m = c.mediaId && mediaById(c.mediaId); return !!m && m.type === 'image'; };

/**
 * Keep only the part of a clip between local timeline offsets a..b (seconds
 * from the clip's start). Reversed clips play their source range backwards,
 * so their timeline start corresponds to `out`.
 */
function keepRange(track, c, a, b) {
  if (track === 'text') { c.start += a; c.duration = b - a; return; }
  const sp = c.speed || 1;
  if (c.reverse) { const nout = c.out - a * sp; c.in = c.out - b * sp; c.out = nout; }
  else { const nin = c.in + a * sp; c.out = c.in + b * sp; c.in = nin; }
  if (track === 'audio') c.start += a;
}

function deleteSelected(ripple = false) {
  if (!state.selected) return;
  const { track, id } = state.selected;
  const list = P().tracks[track];
  const i = list.findIndex((c) => c.id === id);
  if (i < 0) return;
  pushHistory();
  const c = list[i];
  const start = clipStart(track, c), len = clipLen(track, c);
  list.splice(i, 1);
  // The main track is magnetic already; ripple closes the gap on the other tracks.
  if (ripple && track !== 'video') for (const o of list) if (o.start >= start + len - 1e-6) o.start = Math.max(0, o.start - len);
  state.selected = null;
  refreshAll();
}

/** Split a clip at a local offset. Returns false when the point is too close to an edge. */
function splitClip(track, c, local) {
  const len = clipLen(track, c);
  if (!(local > 0.05 && local < len - 0.05)) return false;
  pushHistory();
  const b = clone(c);
  b.id = uid();
  keepRange(track, c, 0, local);
  keepRange(track, b, local, len);
  if (track !== 'text') { c.fadeOut = 0; b.fadeIn = 0; }
  const list = P().tracks[track];
  list.splice(list.indexOf(c) + 1, 0, b);
  state.selected = { track, id: b.id };
  refreshAll();
  return true;
}

function splitAtPlayhead() {
  const t = state.time;
  const sel = selectedClip();
  if (sel && splitClip(state.selected.track, sel, t - clipStart(state.selected.track, sel))) return;
  for (const track of ['video', 'text', 'audio']) {
    for (const c of P().tracks[track]) if (splitClip(track, c, t - clipStart(track, c))) return;
  }
  toast('Move the playhead over a clip to split it');
}

/** The selected clip if the playhead is over it, otherwise the main-track clip under the playhead. */
function clipUnderPlayhead() {
  const c = selectedClip();
  if (c) {
    const tr = state.selected.track, local = state.time - clipStart(tr, c);
    if (local > 0 && local < clipLen(tr, c)) return { track: tr, clip: c };
  }
  const hit = locate(state.time);
  return hit ? { track: 'video', clip: hit.clip } : null;
}

function trimTo(track, c, local, which) {
  const len = clipLen(track, c);
  if (!(local > 0.05 && local < len - 0.05)) return toast('Move the playhead over the clip first');
  pushHistory();
  const start = clipStart(track, c);
  if (which === 'start') keepRange(track, c, local, len); else keepRange(track, c, 0, local);
  state.selected = { track, id: c.id };
  if (which === 'start' && track === 'video') state.time = start;
  refreshAll();
  updatePlayhead();
}
function trimAtPlayhead(which) {
  const hit = clipUnderPlayhead();
  if (!hit) return toast('Move the playhead over a clip first');
  trimTo(hit.track, hit.clip, state.time - clipStart(hit.track, hit.clip), which);
}

// ---------------------------------------------------------------- clipboard
function copySelected(cut) {
  const c = selectedClip();
  if (!c) return toast('Select a clip first');
  state.clipboard = { track: state.selected.track, clip: clone(c) };
  if (cut) deleteSelected();
  toast(cut ? 'Cut' : 'Copied');
}

/** Insert a clip at a timeline time (main track: at the nearest clip boundary). */
function insertClip(track, c, t) {
  if (track === 'video') {
    const list = P().tracks.video;
    const starts = videoStarts();
    let idx = list.length;
    for (let i = 0; i < list.length; i++) if (t < starts[i] + RP.clipDuration(list[i]) / 2) { idx = i; break; }
    list.splice(idx, 0, c);
  } else {
    c.start = Math.max(0, t);
    P().tracks[track].push(c);
  }
  state.selected = { track, id: c.id };
}

function pasteClip(at) {
  const cb = state.clipboard;
  if (!cb) return toast('Nothing to paste — copy a clip first');
  pushHistory();
  const c = clone(cb.clip);
  c.id = uid();
  insertClip(cb.track, c, at ?? state.time);
  refreshAll();
}

function duplicateSelected() {
  const c = selectedClip();
  if (!c) return toast('Select a clip first');
  const track = state.selected.track;
  pushHistory();
  const d = clone(c);
  d.id = uid();
  const list = P().tracks[track];
  if (track === 'video') list.splice(list.indexOf(c) + 1, 0, d);
  else { d.start = c.start + clipLen(track, c); list.push(d); }
  state.selected = { track, id: d.id };
  refreshAll();
  toast('Duplicated');
}

// ---------------------------------------------------------------- speed / reverse / mute
const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4, 8];
const SPEED_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];
const canChangeSpeed = (track, c) => track === 'video' && !isImageClip(c);

function setSpeed(c, v) {
  pushHistory();
  c.speed = v;
  refreshAll();
  toast(`Speed ${v}×`);
}
function speedStep(dir) {
  const c = selectedClip();
  if (!c || !canChangeSpeed(state.selected.track, c)) return toast('Select a video clip first');
  const cur = c.speed || 1;
  const next = dir > 0 ? SPEED_STEPS.find((s) => s > cur + 1e-6) : [...SPEED_STEPS].reverse().find((s) => s < cur - 1e-6);
  if (next == null) return toast(`Speed ${cur}×`);
  setSpeed(c, next);
}

function toggleReverse(c) {
  if (!c) { c = selectedClip(); if (!c || state.selected.track !== 'video') return toast('Select a video clip first'); }
  if (isImageClip(c)) return toast('Photos can’t be reversed');
  pushHistory();
  c.reverse = !c.reverse;
  refreshAll();
  toast(c.reverse ? 'Clip reversed' : 'Reverse removed');
  if (c.reverse) ensureReversed(mediaById(c.mediaId));
}

/** Build (or reload) the reversed copy of a video used to preview and export reversed clips. */
async function ensureReversed(m) {
  if (!m || m.type !== 'video' || preview.reversed.has(m.id) || m.reversing) return;
  m.reversing = true;
  try {
    if (!(m.reversedPath && await api.exists(m.reversedPath))) {
      renderTimeline();
      toast('Preparing reversed clip… preview is choppy until it’s ready');
      m.reversedPath = await api.makeReversed({ file: m.path, duration: m.duration, hasAudio: !!m.hasAudio });
      toast('Reversed clip ready');
    }
    preview.reversed.set(m.id, await loadVideo(api.fileUrl(m.reversedPath)));
  } catch (_) {
    m.reversedPath = null;
    toast('Couldn’t prepare a reversed preview — export will still reverse the clip');
  }
  m.reversing = false;
  refreshAll();
}

function toggleMute(c) {
  if (!c) { c = selectedClip(); if (!c || state.selected.track === 'text' || isImageClip(c)) return toast('Select a video or audio clip first'); }
  pushHistory();
  c.muted = !c.muted;
  refreshAll();
  toast(c.muted ? 'Muted' : 'Unmuted');
}

function resetTransform(c) {
  pushHistory();
  c.transform = { x: 0, y: 0, scale: 1 };
  refreshAll();
}

// ---------------------------------------------------------------- navigation
function editPoints() {
  const pts = new Set([0, RP.projectDuration(P())]);
  const starts = videoStarts();
  P().tracks.video.forEach((c, i) => { pts.add(starts[i]); pts.add(starts[i] + RP.clipDuration(c)); });
  for (const c of P().tracks.text) { pts.add(c.start); pts.add(c.start + c.duration); }
  for (const c of P().tracks.audio) { pts.add(c.start); pts.add(c.start + RP.clipDuration(c)); }
  return [...pts].sort((a, b) => a - b);
}
function jumpEdit(dir) {
  pause();
  const pts = editPoints();
  const t = dir > 0 ? pts.find((p) => p > state.time + 1e-3) : [...pts].reverse().find((p) => p < state.time - 1e-3);
  if (t != null) setTime(t);
}

function setZoom(pps) {
  state.pps = clamp(pps, 2, 300);
  $('#zoom').value = state.pps;
  renderTimeline();
  scrollEl.scrollLeft = state.time * state.pps - scrollEl.clientWidth / 2;
}
function zoomFit() {
  setZoom((scrollEl.clientWidth - 40) / Math.max(1, RP.projectDuration(P())));
  scrollEl.scrollLeft = 0;
}

/** J / K / L shuttle: repeated presses double the speed, up to 8×. */
function shuttle(dir) {
  const r = preview.rate;
  if (state.playing && Math.sign(r) === dir) play(clamp(r * 2, -8, 8));
  else play(dir);
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
    const tags = [c.reverse ? (m && m.reversing ? '↺ preparing…' : '↺') : '', (c.speed || 1) !== 1 ? `${c.speed}×` : '', c.muted ? '🔇' : ''].filter(Boolean);
    const d = clipEl(c, 'video', starts[i], RP.clipDuration(c), (m ? m.name : 'Missing') + (tags.length ? '  ' + tags.join(' ') : ''));
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
  P().tracks.audio.forEach((c) => { const m = mediaById(c.mediaId); ta.appendChild(clipEl(c, 'audio', c.start, RP.clipDuration(c), '♪  ' + (m ? m.name : 'Missing') + (c.muted ? '  🔇' : ''))); });
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
  d.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); openClipMenu(e, track, c, timeAtX(e.clientX)); });
  return d;
}

const timeAtX = (clientX) => Math.max(0, (clientX - tracksEl.getBoundingClientRect().left) / state.pps);

function startClipDrag(e, clip, track, node) {
  e.stopPropagation();
  state.selected = { track, id: clip.id };
  document.querySelectorAll('.clip.selected').forEach((n) => n.classList.remove('selected'));
  node.classList.add('selected');
  renderInspector();
  if (e.button !== 0) { drawFrame(state.time); return; } // right-click: select only, the menu opens on contextmenu
  const mode = e.target.classList.contains('l') ? 'left' : e.target.classList.contains('r') ? 'right' : 'move';
  const x0 = e.clientX;
  const orig = JSON.parse(JSON.stringify(clip));
  const m = mediaById(clip.mediaId);
  const maxOut = m && m.type !== 'image' ? m.duration || orig.out : 3600;
  let changed = false;
  let pending = null;
  let raf = 0;
  node.setPointerCapture(e.pointerId);

  // Coalesce pointer events to one update per frame.
  const onMove = (ev) => {
    pending = ev;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (pending) applyMove(pending); });
  };
  const applyMove = (ev) => {
    pending = null;
    const dt = (ev.clientX - x0) / state.pps;
    if (!changed && Math.abs(ev.clientX - x0) < 3) return;
    if (!changed) { pushHistory(); changed = true; }
    const speed = clip.speed || 1;
    if (track === 'text') {
      if (mode === 'move') clip.start = Math.max(0, orig.start + dt);
      else if (mode === 'right') clip.duration = Math.max(0.2, orig.duration + dt);
      else { const ns = clamp(orig.start + dt, 0, orig.start + orig.duration - 0.2); clip.duration = orig.duration - (ns - orig.start); clip.start = ns; }
    } else if (mode === 'right' && clip.reverse) {
      clip.in = clamp(orig.in - dt * speed, 0, orig.out - 0.1); // a reversed clip ends at its source `in`
    } else if (mode === 'left' && clip.reverse) {
      clip.out = clamp(orig.out - dt * speed, orig.in + 0.1, maxOut);
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
    // Reposition the existing nodes rather than rebuilding the timeline, which would
    // destroy the node being dragged (and its pointer capture) on every move.
    layoutClips();
    renderPreviewFrame();
  };
  const onUp = (ev) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (pending) applyMove(pending);
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
    if (!changed) setTime(timeAtX(ev.clientX)); // plain click: move playhead too
    refreshAll();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

/** Update clip positions and widths in place during a drag. */
function layoutClips() {
  const place = (trackEl, clips, startOf, lenOf) => {
    const nodes = new Map([...trackEl.children].map((n) => [n.dataset.id, n]));
    clips.forEach((c, i) => {
      const n = nodes.get(String(c.id));
      if (!n) return;
      n.style.left = startOf(c, i) * state.pps + 'px';
      n.style.width = Math.max(4, lenOf(c) * state.pps) + 'px';
    });
  };
  const starts = videoStarts();
  place($('#trackVideo'), P().tracks.video, (c, i) => starts[i], RP.clipDuration);
  place($('#trackText'), P().tracks.text, (c) => c.start, (c) => c.duration);
  place($('#trackAudio'), P().tracks.audio, (c) => c.start, RP.clipDuration);
  const width = (RP.projectDuration(P()) + 20) * state.pps;
  if (width > tracksEl.offsetWidth) tracksEl.style.width = width + 'px';
  updatePlayhead();
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
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); state.pps = clamp(state.pps * (e.deltaY < 0 ? 1.1 : 0.9), 2, 300); $('#zoom').value = state.pps; renderTimeline(); }
  }, { passive: false });

  // Right-click on an empty part of the timeline.
  tracksEl.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.clip')) return;
    e.preventDefault();
    const t = timeAtX(e.clientX);
    showMenu(e.clientX, e.clientY, [
      { label: 'Paste Here', kb: KB.mod + 'V', disabled: !state.clipboard, action: () => pasteClip(t) },
      { label: 'Add Title Here', kb: KB.mod + 'T', action: () => addTitle(TITLE_PRESETS[0], t) },
      '-',
      { label: 'Move Playhead Here', action: () => { pause(); setTime(t); } }
    ], t);
  });

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
  const slider = (parent, label, obj, key, min, max, step, fmtv = (v) => v, def = key === 'blur' ? 0 : 1) => {
    const r = el('div', 'row', `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}"><output></output>`);
    const inp = r.querySelector('input'), out = r.querySelector('output');
    inp.value = obj[key] ?? 0; out.textContent = fmtv(Number(inp.value));
    inp.addEventListener('input', () => { if (!dirty) { pushHistory(); dirty = true; } obj[key] = Number(inp.value); out.textContent = fmtv(obj[key]); commit(); });
    inp.addEventListener('change', () => { dirty = false; });
    inp.addEventListener('dblclick', () => { pushHistory(); obj[key] = def; renderInspector(); commit(); });
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
    slider(s, 'Size', c, 'size', 8, 400, 1, (v) => v + 'px', 96);
    const ck = el('div', 'checks'); s.appendChild(ck);
    check(ck, 'Bold', c, 'bold'); check(ck, 'Italic', c, 'italic'); check(ck, 'Shadow', c, 'shadow'); check(ck, 'Outline', c, 'outline'); check(ck, 'Glow', c, 'glow'); check(ck, 'Background', c, 'box');
    const br = el('div', 'row full', '<span>Box color</span><input type="color">');
    const bi = br.querySelector('input'); bi.value = c.boxColor || '#000000';
    bi.oninput = () => { c.boxColor = bi.value; commit(); }; bi.onfocus = () => pushHistory();
    s.appendChild(br);
    const p = section('Position & Timing');
    p.appendChild(el('p', 'muted hint', 'Tip: drag the title in the player to move it, or drag a corner to resize.'));
    slider(p, 'X', c, 'x', 0, 1, 0.01, pct, 0.5);
    slider(p, 'Y', c, 'y', 0, 1, 0.01, pct, 0.5);
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
    slider(b, 'Speed', c, 'speed', 0.1, 8, 0.05, (v) => v.toFixed(2) + '×');
    slider(b, 'Volume', c, 'volume', 0, 2, 0.01, pct);
    const ck = el('div', 'checks'); b.appendChild(ck); check(ck, 'Mute', c, 'muted');
    const rl = el('label', '', `<input type="checkbox"> Reverse${m && m.reversing ? ' <span class="muted">(preparing…)</span>' : ''}`);
    const ri = rl.querySelector('input'); ri.checked = !!c.reverse;
    ri.addEventListener('change', () => toggleReverse(c));
    ck.appendChild(rl);
  }
  if (!c.transform) c.transform = { x: 0, y: 0, scale: 1 };
  const pos = section('Position & Size');
  pos.appendChild(el('p', 'muted hint', 'Tip: drag the clip in the player to move it, or drag a corner to resize.'));
  slider(pos, 'Scale', c.transform, 'scale', 0.1, 4, 0.01, pct, 1);
  slider(pos, 'X', c.transform, 'x', -1, 1, 0.01, pct, 0);
  slider(pos, 'Y', c.transform, 'y', -1, 1, 0.01, pct, 0);
  const rp = el('button', 'btn small', 'Reset position & size');
  rp.onclick = () => resetTransform(c);
  pos.appendChild(rp);
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
/** Font, line positions and bounding box of a title in a W x H frame. Sets g.font. */
function titleLayout(g, t, W, H) {
  const size = Math.max(4, t.size * (H / 1080));
  g.font = `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${size}px "${t.font || 'Helvetica'}", Helvetica, Arial, sans-serif`;
  const align = t.align || 'center';
  const lines = t.text.split('\n');
  const lh = size * 1.2;
  const x = t.x * W;
  const y0 = t.y * H - ((lines.length - 1) * lh) / 2;
  const maxW = Math.max(...lines.map((l) => g.measureText(l).width));
  const left = align === 'left' ? x : align === 'right' ? x - maxW : x - maxW / 2;
  const padX = t.box ? size * 0.4 : 0, padY = t.box ? size * 0.2 : 0;
  return { size, align, lines, lh, x, y0, box: { x: left - padX, y: y0 - lh / 2 - padY, w: maxW + padX * 2, h: lines.length * lh + padY * 2 } };
}
function titleBox(g, t, W, H) {
  g.save();
  const b = titleLayout(g, t, W, H).box;
  g.restore();
  return b;
}

function drawTitle(g, t, W, H, alpha = 1) {
  if (!t.text) return;
  g.save();
  g.globalAlpha = alpha;
  const L = titleLayout(g, t, W, H);
  const size = L.size;
  g.textAlign = L.align;
  g.textBaseline = 'middle';
  if (t.box) {
    g.fillStyle = t.boxColor || '#000';
    g.globalAlpha = alpha * 0.8;
    g.fillRect(L.box.x, L.box.y, L.box.w, L.box.h);
    g.globalAlpha = alpha;
  }
  L.lines.forEach((line, i) => {
    const y = L.y0 + i * L.lh;
    if (t.shadow) { g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = size * 0.15; g.shadowOffsetY = size * 0.05; }
    if (t.glow) { g.shadowColor = t.color; g.shadowBlur = size * 0.4; }
    if (t.outline) { g.lineWidth = Math.max(1, size * 0.06); g.strokeStyle = '#000'; g.lineJoin = 'round'; g.strokeText(line, L.x, y); }
    g.fillStyle = t.color;
    g.fillText(line, L.x, y);
    if (t.glow) g.fillText(line, L.x, y);
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
const preview = {
  videos: new Map(), reversed: new Map(), images: new Map(), audios: new Map(),
  active: null, raf: 0, wall: 0, t0: 0, rate: 1, guides: null
};

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
      return { clip: c, local: Math.min(t - acc, d), dur: d };
    }
    acc += d;
  }
  return null;
}

/**
 * The video element and media time to show for a main-track clip. Reversed
 * clips use the pre-reversed copy once it exists ("live" playback); until
 * then the original is stepped backwards by seeking.
 */
function playbackSource(c, local) {
  const m = mediaById(c.mediaId);
  if (!m || m.type !== 'video') return null;
  const speed = c.speed || 1;
  if (c.reverse) {
    const orig = c.out - local * speed;
    const rv = preview.reversed.get(m.id);
    if (rv) return { v: rv, time: clamp((m.duration || rv.duration) - orig, 0, rv.duration || Infinity), live: true };
    return { v: preview.videos.get(m.id), time: orig, live: false };
  }
  return { v: preview.videos.get(m.id), time: c.in + local * speed, live: true };
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

function sourceFor(c, local) {
  const m = mediaById(c.mediaId);
  if (!m) return null;
  if (m.type === 'image') {
    let img = preview.images.get(m.id);
    if (!img) { img = new Image(); img.onload = renderPreviewFrame; img.src = mediaSrc(m); preview.images.set(m.id, img); }
    return img.complete && img.naturalWidth ? { el: img, w: img.naturalWidth, h: img.naturalHeight } : null;
  }
  const ps = playbackSource(c, local);
  const v = ps && ps.v;
  return v && v.readyState >= 2 ? { el: v, w: v.videoWidth, h: v.videoHeight } : null;
}

/** Where a main-track clip is drawn in a W x H frame, after its position / scale. */
function videoRect(c, W, H, src) {
  const m = mediaById(c.mediaId);
  const sw = (src && src.w) || (m && m.width) || W;
  const sh = (src && src.h) || (m && m.height) || H;
  const tf = RP.transformOf(c);
  const s = Math.min(W / sw, H / sh) * tf.scale;
  const w = sw * s, h = sh * s;
  return { x: (W - w) / 2 + tf.x * W, y: (H - h) / 2 + tf.y * H, w, h };
}

function drawFrame(t) {
  const W = canvas.width, H = canvas.height;
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const hit = locate(t);
  if (hit) {
    const c = hit.clip;
    const src = sourceFor(c, hit.local);
    if (src) {
      const r = videoRect(c, W, H, src);
      const fx = c.effects || {};
      ctx.save();
      ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
      ctx.scale(fx.flipH ? -1 : 1, fx.flipV ? -1 : 1);
      ctx.filter = cssFilter(fx, W / 1920);
      ctx.drawImage(src.el, -r.w / 2, -r.h / 2, r.w, r.h);
      ctx.restore();
      if (fx.vignette) {
        const g = ctx.createRadialGradient(r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) * 0.3, r.x + r.w / 2, r.y + r.h / 2, Math.hypot(r.w, r.h) / 2);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.7)');
        ctx.fillStyle = g; ctx.fillRect(r.x, r.y, r.w, r.h);
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
  drawSelection();
}

// ---------------------------------------------------------------- move / resize in the player
/** Box of the selected title or video clip if it is visible at the playhead. */
function selectionBox() {
  const c = selectedClip();
  if (!c || state.playing) return null;
  const W = canvas.width, H = canvas.height;
  if (state.selected.track === 'text') {
    return state.time >= c.start && state.time <= c.start + c.duration ? titleBox(ctx, c, W, H) : null;
  }
  if (state.selected.track === 'video') {
    const hit = locate(state.time);
    return hit && hit.clip === c ? videoRect(c, W, H, sourceFor(c, hit.local)) : null;
  }
  return null;
}
/** Corner handle centers, kept inside the frame so a full-frame clip's handles can be grabbed. */
function corners(b) {
  const m = 6 / displayScale();
  return [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]
    .map(([x, y]) => [clamp(x, m, canvas.width - m), clamp(y, m, canvas.height - m)]);
}
const inBox = (b, p) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

/** Canvas pixels per screen pixel is 1/s; the canvas is letterboxed by object-fit: contain. */
function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  const s = Math.min(r.width / canvas.width, r.height / canvas.height);
  return { x: (e.clientX - r.left - (r.width - canvas.width * s) / 2) / s, y: (e.clientY - r.top - (r.height - canvas.height * s) / 2) / s, s };
}
function displayScale() {
  const r = canvas.getBoundingClientRect();
  return Math.min(r.width / canvas.width, r.height / canvas.height) || 1;
}
function hitCorner(b, p) {
  const tol = 10 / p.s;
  return corners(b).findIndex(([x, y]) => Math.abs(p.x - x) <= tol && Math.abs(p.y - y) <= tol);
}

function drawSelection() {
  const W = canvas.width, H = canvas.height;
  const k = 1 / displayScale();
  ctx.save();
  const g = preview.guides;
  if (g && (g.v || g.h)) {
    ctx.strokeStyle = '#ff4fd8'; ctx.lineWidth = k;
    ctx.beginPath();
    if (g.v) { ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); }
    if (g.h) { ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); }
    ctx.stroke();
  }
  const b = selectionBox();
  if (b) {
    ctx.strokeStyle = '#19d3c5'; ctx.lineWidth = 1.5 * k; ctx.setLineDash([6 * k, 4 * k]);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.setLineDash([]);
    const hs = 9 * k;
    for (const [x, y] of corners(b)) {
      ctx.fillStyle = '#fff'; ctx.fillRect(x - hs / 2, y - hs / 2, hs, hs);
      ctx.strokeRect(x - hs / 2, y - hs / 2, hs, hs);
    }
  }
  ctx.restore();
}

/** Topmost title or the main-track clip under a canvas point. */
function previewHit(p) {
  const W = canvas.width, H = canvas.height;
  const texts = P().tracks.text.filter((tc) => state.time >= tc.start && state.time <= tc.start + tc.duration);
  for (let i = texts.length - 1; i >= 0; i--) if (inBox(titleBox(ctx, texts[i], W, H), p)) return { track: 'text', clip: texts[i] };
  const hit = locate(state.time);
  if (hit && inBox(videoRect(hit.clip, W, H, sourceFor(hit.clip, hit.local)), p)) return { track: 'video', clip: hit.clip };
  return null;
}

function setupPreviewEvents() {
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (state.playing) pause();
    const p = canvasPoint(e);
    let box = selectionBox();
    const corner = box ? hitCorner(box, p) : -1;
    let target;
    if (box && (corner >= 0 || inBox(box, p))) target = { track: state.selected.track, clip: selectedClip() };
    else {
      target = previewHit(p);
      if (!target) { if (state.selected) { state.selected = null; refreshAll(); } return; }
      state.selected = { track: target.track, id: target.clip.id };
      renderTimeline(); renderInspector();
      box = selectionBox();
      if (!box) return;
    }
    const c = target.clip;
    const W = canvas.width, H = canvas.height;
    const orig = clone(c);
    const otf = RP.transformOf(c);
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const d0 = Math.max(4, Math.hypot(p.x - cx, p.y - cy));
    let changed = false;
    let pending = null;
    let raf = 0;
    canvas.setPointerCapture(e.pointerId);
    // Coalesce pointer events to one redraw per frame.
    const mv = (ev) => {
      pending = ev;
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (pending) apply(pending); });
    };
    const apply = (ev) => {
      pending = null;
      const q = canvasPoint(ev);
      if (!changed && Math.hypot(q.x - p.x, q.y - p.y) * q.s < 3) return;
      if (!changed) { pushHistory(); changed = true; }
      if (corner >= 0) {
        const f = Math.hypot(q.x - cx, q.y - cy) / d0;
        if (target.track === 'text') c.size = Math.round(clamp(orig.size * f, 8, 400));
        else c.transform = Object.assign({}, otf, { scale: clamp(otf.scale * f, 0.05, 5) });
      } else {
        let dx = (q.x - p.x) / W, dy = (q.y - p.y) / H;
        // Snap the center onto the frame's center lines.
        const snap = 6 / q.s;
        preview.guides = { v: Math.abs(cx + dx * W - W / 2) < snap, h: Math.abs(cy + dy * H - H / 2) < snap };
        if (preview.guides.v) dx = (W / 2 - cx) / W;
        if (preview.guides.h) dy = (H / 2 - cy) / H;
        if (target.track === 'text') { c.x = orig.x + dx; c.y = orig.y + dy; }
        else c.transform = Object.assign({}, otf, { x: otf.x + dx, y: otf.y + dy });
      }
      drawFrame(state.time);
    };
    const up = () => {
      canvas.removeEventListener('pointermove', mv);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (pending) apply(pending);
      preview.guides = null;
      if (changed) refreshAll(); else drawFrame(state.time);
    };
    canvas.addEventListener('pointermove', mv);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons) return;
    const p = canvasPoint(e);
    const box = selectionBox();
    const corner = box ? hitCorner(box, p) : -1;
    canvas.style.cursor = corner === 0 || corner === 3 ? 'nwse-resize' : corner > 0 ? 'nesw-resize' : (box && inBox(box, p)) || previewHit(p) ? 'move' : 'default';
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const p = canvasPoint(e);
    const box = selectionBox();
    const target = box && inBox(box, p) ? { track: state.selected.track, clip: selectedClip() } : previewHit(p);
    if (target) openClipMenu(e, target.track, target.clip, state.time);
  });
}

function renderPreviewFrame() {
  if (state.playing) return;
  const hit = locate(state.time);
  if (hit) {
    const ps = playbackSource(hit.clip, hit.local);
    const v = ps && ps.v;
    if (v && Math.abs(v.currentTime - ps.time) > 0.02) {
      v.currentTime = ps.time;
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
  const rate = preview.rate;
  const hit = locate(t);
  const ps = hit ? playbackSource(hit.clip, hit.local) : null;
  const activeV = ps ? ps.v : null;
  for (const v of [...preview.videos.values(), ...preview.reversed.values()]) if (v !== activeV && !v.paused) v.pause();
  if (activeV) {
    const c = hit.clip;
    activeV.volume = c.muted ? 0 : clamp(c.volume ?? 1, 0, 1);
    if (ps.live && rate > 0) {
      activeV.playbackRate = clamp((c.speed || 1) * rate, 0.0625, 16);
      if (force || preview.active !== c.id || Math.abs(activeV.currentTime - ps.time) > 0.3) activeV.currentTime = ps.time;
      if (activeV.paused) activeV.play().catch(() => {});
    } else {
      // Playing backwards: step through frames by seeking (silent).
      if (!activeV.paused) activeV.pause();
      if (!activeV.seeking && Math.abs(activeV.currentTime - ps.time) > 0.03) activeV.currentTime = ps.time;
    }
    preview.active = c.id;
  } else preview.active = null;

  for (const ac of P().tracks.audio) {
    const m = mediaById(ac.mediaId);
    if (!m) continue;
    let a = preview.audios.get(ac.id);
    if (!a) { a = new Audio(api.fileUrl(m.previewPath || m.path)); preview.audios.set(ac.id, a); }
    const local = t - ac.start;
    const len = RP.clipDuration(ac);
    if (rate > 0 && local >= 0 && local < len) {
      const fi = ac.fadeIn || 0, fo = ac.fadeOut || 0;
      let g = 1;
      if (fi > 0 && local < fi) g = local / fi;
      if (fo > 0 && local > len - fo) g = Math.min(g, (len - local) / fo);
      a.volume = ac.muted ? 0 : clamp((ac.volume ?? 1) * g, 0, 1);
      a.playbackRate = clamp(rate, 0.0625, 16);
      const want = ac.in + local;
      if (force || Math.abs(a.currentTime - want) > 0.3) a.currentTime = want;
      if (a.paused) a.play().catch(() => {});
    } else if (!a.paused) a.pause();
  }
}

/** Play at a rate: 1 = normal, 2/4/8 = fast forward, negative = backwards. */
function play(rate = 1) {
  const total = RP.projectDuration(P());
  if (total <= 0) return toast('Add some media to the timeline first');
  if (rate > 0 && state.time >= total - 0.01) state.time = 0;
  if (rate < 0 && state.time <= 0.01) state.time = total;
  preview.rate = rate;
  state.playing = true;
  $('#playBtn').textContent = '❚❚';
  if (rate !== 1) toast(rate < 0 ? `◀◀ ${-rate}×` : `▶▶ ${rate}×`);
  preview.t0 = state.time;
  preview.wall = performance.now();
  cancelAnimationFrame(preview.raf);
  syncMedia(true);
  const loop = () => {
    if (!state.playing) return;
    state.time = preview.t0 + ((performance.now() - preview.wall) / 1000) * preview.rate;
    if (state.time >= total) { state.time = total; pause(); updatePlayhead(); return; }
    if (preview.rate < 0 && state.time <= 0) { state.time = 0; pause(); updatePlayhead(); return; }
    syncMedia(false);
    drawFrame(state.time);
    updatePlayhead();
    const x = state.time * state.pps;
    if (x > scrollEl.scrollLeft + scrollEl.clientWidth - 40) scrollEl.scrollLeft = x - 80;
    else if (preview.rate < 0 && x < scrollEl.scrollLeft + 20) scrollEl.scrollLeft = x - scrollEl.clientWidth + 80;
    preview.raf = requestAnimationFrame(loop);
  };
  preview.raf = requestAnimationFrame(loop);
}

function pause() {
  state.playing = false;
  preview.rate = 1;
  cancelAnimationFrame(preview.raf);
  $('#playBtn').textContent = '▶';
  for (const v of preview.videos.values()) v.pause();
  for (const v of preview.reversed.values()) v.pause();
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
    project.media.forEach((m) => { delete m.thumb; delete m.reversing; });
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
  data.media.forEach((m) => delete m.reversing);
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
  preview.videos.clear(); preview.reversed.clear(); preview.images.clear(); preview.audios.clear();
  for (const m of P().media) { m.reversing = false; await prepareMedia(m); }
  for (const c of P().tracks.video) if (c.reverse) ensureReversed(mediaById(c.mediaId));
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

// ---------------------------------------------------------------- context menu
const IS_MAC = api.platform === 'darwin';
const KB = IS_MAC ? { mod: '⌘', shift: '⇧', alt: '⌥', del: '⌫' } : { mod: 'Ctrl+', shift: 'Shift+', alt: 'Alt+', del: 'Delete' };
const ctxMenu = el('div', 'ctx-menu');
ctxMenu.hidden = true;
document.body.appendChild(ctxMenu);

/** items: { label, kb, action, disabled, checked, submenu } or '-' for a separator. */
function showMenu(x, y, items, markTime) {
  hideMenu();
  const build = (list) => {
    const box = el('div', 'ctx-list');
    for (const it of list) {
      if (it === '-') { box.appendChild(el('div', 'ctx-sep')); continue; }
      const row = el('div', 'ctx-item' + (it.disabled ? ' disabled' : ''));
      row.innerHTML = `<span class="ck">${it.checked ? '✓' : ''}</span><span class="lbl">${esc(it.label)}</span><span class="kb">${it.submenu ? '▸' : esc(it.kb || '')}</span>`;
      if (it.submenu && !it.disabled) {
        const sub = build(it.submenu);
        sub.classList.add('ctx-sub');
        row.appendChild(sub);
        // Keep the submenu inside the window (menus opened from the timeline sit near the bottom).
        row.addEventListener('mouseenter', () => {
          sub.style.top = '-5px';
          const over = sub.getBoundingClientRect().bottom - innerHeight + 4;
          if (over > 0) sub.style.top = `${-5 - over}px`;
        });
      }
      else if (!it.disabled && it.action) row.addEventListener('click', (e) => { e.stopPropagation(); hideMenu(); it.action(); });
      box.appendChild(row);
    }
    return box;
  };
  ctxMenu.appendChild(build(items));
  ctxMenu.hidden = false;
  const r = ctxMenu.getBoundingClientRect();
  ctxMenu.style.left = Math.min(x, innerWidth - r.width - 4) + 'px';
  ctxMenu.style.top = Math.min(y, innerHeight - r.height - 4) + 'px';
  ctxMenu.classList.toggle('flip', x + r.width * 2 > innerWidth);
  // Show where "Split Here" will cut.
  if (markTime != null) { const mk = $('#ctxMark'); mk.style.left = markTime * state.pps + 'px'; mk.hidden = false; }
}
function hideMenu() {
  ctxMenu.hidden = true;
  ctxMenu.innerHTML = '';
  $('#ctxMark').hidden = true;
}

/** Right-click menu for a clip; t is the timeline time that was clicked. */
function openClipMenu(e, track, c, t) {
  state.selected = { track, id: c.id };
  renderTimeline(); renderInspector(); drawFrame(state.time);
  const m = c.mediaId ? mediaById(c.mediaId) : null;
  const local = t - clipStart(track, c);
  const len = clipLen(track, c);
  const inside = local > 0.05 && local < len - 0.05;
  const sp = c.speed || 1;
  const items = [
    { label: 'Cut', kb: KB.mod + 'X', action: () => copySelected(true) },
    { label: 'Copy', kb: KB.mod + 'C', action: () => copySelected(false) },
    { label: 'Paste', kb: KB.mod + 'V', disabled: !state.clipboard, action: () => pasteClip(t) },
    { label: 'Duplicate', kb: KB.mod + 'D', action: duplicateSelected },
    { label: 'Delete', kb: KB.del, action: () => deleteSelected() },
    '-',
    { label: 'Split Here', disabled: !inside, action: () => { pause(); setTime(t); splitClip(track, c, local); } },
    { label: 'Trim Start to Here', disabled: !inside, action: () => trimTo(track, c, local, 'start') },
    { label: 'Trim End to Here', disabled: !inside, action: () => trimTo(track, c, local, 'end') }
  ];
  if (track === 'video') {
    const vid = canChangeSpeed(track, c);
    items.push('-',
      { label: 'Reverse', checked: !!c.reverse, kb: KB.mod + 'R', disabled: !vid, action: () => toggleReverse(c) },
      { label: `Speed (${sp}×)`, disabled: !vid, submenu: [
        ...SPEED_PRESETS.map((v) => ({ label: v === 1 ? '1× Normal' : `${v}×`, checked: Math.abs(sp - v) < 1e-6, action: () => setSpeed(c, v) })),
        '-',
        { label: 'Speed Up', kb: KB.mod + KB.shift + '>', action: () => speedStep(1) },
        { label: 'Slow Down', kb: KB.mod + KB.shift + '<', action: () => speedStep(-1) }
      ] });
  }
  if (track === 'audio' || (track === 'video' && m && m.type === 'video')) {
    items.push({ label: c.muted ? 'Unmute' : 'Mute', kb: KB.mod + KB.shift + 'M', action: () => toggleMute(c) });
  }
  if (track === 'video') items.push({ label: 'Reset Position & Size', disabled: RP.isIdentity(RP.transformOf(c)), action: () => resetTransform(c) });
  if (track === 'text') items.push('-', { label: 'Edit Text…', action: () => { const ta = $('#inspectorBody textarea'); if (ta) { ta.focus(); ta.select(); } } });
  showMenu(e.clientX, e.clientY, items, track === 'text' || track === 'audio' || track === 'video' ? t : null);
}

// ---------------------------------------------------------------- keyboard shortcuts
const SHORTCUTS = [
  ['Playback', [
    ['Space', 'Play / pause'],
    ['L', 'Play forward — press again for 2×, 4×, 8×'],
    ['J', 'Play backward — press again to go faster'],
    ['K', 'Pause'],
    ['←  →', 'Previous / next frame'],
    [KB.shift + '←  →', 'Back / forward 1 second'],
    ['↑  ↓', 'Previous / next edit point'],
    ['Home  End', 'Go to start / end']
  ]],
  ['Editing', [
    [KB.mod + 'B  or  S', 'Split at playhead'],
    [KB.mod + 'X', 'Cut clip'],
    [KB.mod + 'C', 'Copy clip'],
    [KB.mod + 'V', 'Paste at playhead'],
    [KB.mod + 'D', 'Duplicate clip'],
    [KB.del, 'Delete clip'],
    [KB.shift + KB.del, 'Ripple delete (close the gap)'],
    [KB.alt + '[', 'Trim start to playhead'],
    [KB.alt + ']', 'Trim end to playhead'],
    [KB.mod + 'R', 'Reverse clip'],
    [KB.mod + KB.shift + '>', 'Speed up'],
    [KB.mod + KB.shift + '<', 'Slow down'],
    [KB.mod + KB.shift + 'M', 'Mute / unmute clip'],
    [KB.mod + 'T', 'Add title at playhead'],
    [KB.mod + 'Z', 'Undo'],
    [KB.mod + KB.shift + 'Z', 'Redo']
  ]],
  ['Timeline & project', [
    [KB.mod + '=', 'Zoom in timeline'],
    [KB.mod + '−', 'Zoom out timeline'],
    [KB.shift + 'Z', 'Fit timeline to window'],
    [KB.mod + 'I', 'Import media'],
    [KB.mod + 'E', 'Export'],
    [KB.mod + 'N / O / S', 'New / open / save project'],
    [KB.mod + '/  or  ?', 'Show this list']
  ]],
  ['Mouse', [
    ['Right-click a clip', 'Cut, copy, paste, split here, reverse, speed…'],
    ['Drag in the player', 'Move the selected clip or title'],
    ['Drag a corner in the player', 'Resize it'],
    ['Drag clip edges', 'Trim'],
    [KB.mod + 'scroll', 'Zoom timeline']
  ]]
];

function showShortcuts() {
  const body = $('#scBody');
  if (!body.children.length) {
    for (const [group, rows] of SHORTCUTS) {
      const sec = el('div', 'sc-group', `<h4>${group}</h4>`);
      for (const [k, d] of rows) sec.appendChild(el('div', 'sc-row', `<kbd>${esc(k)}</kbd><span>${esc(d)}</span>`));
      body.appendChild(sec);
    }
  }
  if (!$('#shortcutsDialog').open) $('#shortcutsDialog').showModal();
}

const typingIn = (n) => !!n && (n.isContentEditable || (n.matches && n.matches('textarea, select, input:not([type=range]):not([type=checkbox]):not([type=color])')));

function onKey(e) {
  if (e.key === 'Escape') hideMenu();
  if (e.target.matches('input, textarea, select') || document.querySelector('dialog[open]')) return;
  const mod = e.metaKey || e.ctrlKey;
  // Shortcuts listed in the app menu without a registered accelerator (they would type text otherwise).
  if (mod && e.shiftKey && e.code === 'Period') { e.preventDefault(); return speedStep(1); }
  if (mod && e.shiftKey && e.code === 'Comma') { e.preventDefault(); return speedStep(-1); }
  if (mod) return; // the rest are app-menu accelerators
  if (e.altKey && e.code === 'BracketLeft') { e.preventDefault(); return trimAtPlayhead('start'); }
  if (e.altKey && e.code === 'BracketRight') { e.preventDefault(); return trimAtPlayhead('end'); }
  if (e.key === '?') return showShortcuts();
  if (e.shiftKey && e.code === 'KeyZ') return zoomFit();
  const fps = P().settings.fps;
  switch (e.code) {
    case 'Space': e.preventDefault(); return state.playing ? pause() : play();
    case 'KeyL': if (!e.repeat) shuttle(1); return;
    case 'KeyJ': if (!e.repeat) shuttle(-1); return;
    case 'KeyK': return pause();
    case 'KeyS': return splitAtPlayhead();
    case 'Delete': case 'Backspace': e.preventDefault(); return deleteSelected(e.shiftKey);
    case 'ArrowLeft': e.preventDefault(); pause(); return setTime(state.time - (e.shiftKey ? 1 : 1 / fps));
    case 'ArrowRight': e.preventDefault(); pause(); return setTime(state.time + (e.shiftKey ? 1 : 1 / fps));
    case 'ArrowUp': e.preventDefault(); return jumpEdit(-1);
    case 'ArrowDown': e.preventDefault(); return jumpEdit(1);
    case 'Home': return setTime(0);
    case 'End': return setTime(RP.projectDuration(P()));
  }
}

const MENU_COMMANDS = {
  new: () => newProjectCmd(), open: () => openProject(), save: () => saveProject(false), saveAs: () => saveProject(true),
  import: async () => importPaths(await api.pickMedia()), export: () => openExport(),
  undo: () => undo(), redo: () => redo(),
  cut: () => copySelected(true), copy: () => copySelected(false), paste: () => pasteClip(), duplicate: () => duplicateSelected(),
  delete: () => deleteSelected(), rippleDelete: () => deleteSelected(true), selectAll: () => {},
  split: () => splitAtPlayhead(), trimStart: () => trimAtPlayhead('start'), trimEnd: () => trimAtPlayhead('end'),
  reverse: () => toggleReverse(), speedUp: () => speedStep(1), speedDown: () => speedStep(-1), mute: () => toggleMute(),
  addTitle: () => addTitle(TITLE_PRESETS[0], state.time),
  zoomIn: () => setZoom(state.pps * 1.25), zoomOut: () => setZoom(state.pps / 1.25), zoomFit: () => zoomFit(),
  shortcuts: () => showShortcuts()
};
const NATIVE_EDIT = ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'];

function onMenuCommand(cmd) {
  // Editing commands act on the text field being typed in, if any.
  if (NATIVE_EDIT.includes(cmd) && typingIn(document.activeElement)) return api.nativeEdit(cmd);
  if (document.querySelector('dialog[open]') && cmd !== 'shortcuts') return;
  hideMenu();
  MENU_COMMANDS[cmd]?.();
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
  $('#deleteBtn').onclick = () => deleteSelected();
  $('#copyBtn').onclick = () => copySelected(false);
  $('#pasteBtn').onclick = () => pasteClip();
  $('#dupBtn').onclick = duplicateSelected;
  $('#reverseBtn').onclick = () => toggleReverse();
  $('#shortcutsBtn').onclick = showShortcuts;
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

  window.addEventListener('keydown', onKey);
  api.onMenu(onMenuCommand);
  window.addEventListener('pointerdown', (e) => { if (!ctxMenu.contains(e.target)) hideMenu(); }, true);
  window.addEventListener('blur', hideMenu);
  scrollEl.addEventListener('scroll', hideMenu);
  window.addEventListener('resize', renderTimeline);
}

renderPresets();
setupUI();
setupTimelineEvents();
setupPreviewEvents();
setupExportDialog();
setAspect('1920x1080');
renderLibrary();
refreshAll();
