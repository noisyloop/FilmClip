/*
 * Render plan: pure functions shared by the renderer (durations, file-size
 * estimates) and the main process (building the ffmpeg command line).
 * Loaded with require() in Node and as a plain <script> in the UI.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RenderPlan = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const AUDIO_RATE = 48000;

  // Short-side resolutions offered in the export dialog.
  const RESOLUTIONS = [
    { id: '480', label: '480p (SD)', short: 480 },
    { id: '720', label: '720p (HD)', short: 720 },
    { id: '1080', label: '1080p (Full HD)', short: 1080 },
    { id: '1440', label: '1440p (2K)', short: 1440 },
    { id: '2160', label: '2160p (4K)', short: 2160 }
  ];

  // Video bitrates in kbit/s at 30 fps, by short side and quality.
  const VIDEO_KBPS = {
    480: { low: 900, medium: 1800, high: 3500 },
    720: { low: 2000, medium: 4000, high: 7500 },
    1080: { low: 4000, medium: 8000, high: 12000 },
    1440: { low: 8000, medium: 14000, high: 24000 },
    2160: { low: 16000, medium: 30000, high: 50000 }
  };
  const AUDIO_KBPS = { low: 96, medium: 160, high: 320 };

  const FORMATS = {
    mp4: { label: 'MP4 (H.264)', ext: 'mp4', video: true, audio: true },
    mov: { label: 'MOV (H.264)', ext: 'mov', video: true, audio: true },
    webm: { label: 'WebM (VP9)', ext: 'webm', video: true, audio: true },
    gif: { label: 'GIF (animated)', ext: 'gif', video: true, audio: false },
    mp3: { label: 'MP3 (audio only)', ext: 'mp3', video: false, audio: true }
  };

  const DEFAULT_EFFECTS = {
    brightness: 1, contrast: 1, saturation: 1, blur: 0,
    grayscale: false, sepia: false, invert: false, vignette: false,
    flipH: false, flipV: false
  };

  // ---- Effect clips (the Effects track): glitches and blend modes drawn over everything below.
  const BLEND_MODES = [
    { id: 'normal', label: 'Normal', canvas: 'source-over' },
    { id: 'multiply', label: 'Multiply', canvas: 'multiply' },
    { id: 'screen', label: 'Screen', canvas: 'screen' },
    { id: 'overlay', label: 'Overlay', canvas: 'overlay' },
    { id: 'softlight', label: 'Soft Light', canvas: 'soft-light' },
    { id: 'hardlight', label: 'Hard Light', canvas: 'hard-light' },
    { id: 'difference', label: 'Difference', canvas: 'difference' },
    { id: 'exclusion', label: 'Exclusion', canvas: 'exclusion' },
    { id: 'addition', label: 'Add', canvas: 'lighter' },
    { id: 'darken', label: 'Darken', canvas: 'darken' },
    { id: 'lighten', label: 'Lighten', canvas: 'lighten' },
    { id: 'dodge', label: 'Color Dodge', canvas: 'color-dodge' },
    { id: 'burn', label: 'Color Burn', canvas: 'color-burn' }
  ];
  // fmt: how the inspector prints the value. Pixel sizes are for a 1920-wide frame and scale with the output.
  const FX_TYPES = {
    blend: { label: 'Blend', icon: '◧', hint: 'Blends another clip or photo into everything below',
      params: [{ key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.01, def: 0.8, fmt: 'pct' }] },
    rgbsplit: { label: 'RGB Split', icon: '◍', hint: 'Colour channels drift apart',
      params: [{ key: 'amount', label: 'Amount', min: 0, max: 80, step: 1, def: 14, fmt: 'px' },
        { key: 'angle', label: 'Angle', min: 0, max: 360, step: 1, def: 0, fmt: 'deg' }] },
    slices: { label: 'Glitch Slices', icon: '▤', hint: 'Horizontal bands jump sideways',
      params: [{ key: 'shift', label: 'Shift', min: 0, max: 50, step: 1, def: 12, fmt: 'pct0' },
        { key: 'height', label: 'Band height', min: 1, max: 30, step: 1, def: 6, fmt: 'pct0' },
        { key: 'density', label: 'Density', min: 0, max: 1, step: 0.01, def: 0.5, fmt: 'pct' },
        { key: 'rate', label: 'Speed', min: 1, max: 30, step: 1, def: 12, fmt: 'hz' }] },
    pixelate: { label: 'Pixelate', icon: '▦', hint: 'Chunky mosaic blocks',
      params: [{ key: 'size', label: 'Block size', min: 2, max: 120, step: 1, def: 24, fmt: 'px' }] },
    scanlines: { label: 'Scanlines', icon: '≣', hint: 'CRT / VHS lines',
      params: [{ key: 'spacing', label: 'Spacing', min: 2, max: 16, step: 1, def: 4, fmt: 'px' },
        { key: 'darkness', label: 'Darkness', min: 0, max: 1, step: 0.01, def: 0.45, fmt: 'pct' }] },
    noise: { label: 'Static Noise', icon: '░', hint: 'Grainy TV static',
      params: [{ key: 'amount', label: 'Amount', min: 1, max: 100, step: 1, def: 30, fmt: 'num' }] },
    wobble: { label: 'Wobble', icon: '≈', hint: 'Wavy, melting distortion',
      params: [{ key: 'amount', label: 'Amount', min: 0, max: 80, step: 1, def: 18, fmt: 'px' },
        { key: 'length', label: 'Wavelength', min: 20, max: 600, step: 5, def: 200, fmt: 'px' },
        { key: 'speed', label: 'Speed', min: 0, max: 10, step: 0.1, def: 2, fmt: 'hz' }] },
    shake: { label: 'Shake', icon: '⌁', hint: 'Jittery camera shake',
      params: [{ key: 'strength', label: 'Strength', min: 0, max: 10, step: 0.1, def: 3, fmt: 'pct0' },
        { key: 'rate', label: 'Speed', min: 1, max: 60, step: 1, def: 20, fmt: 'hz' }] },
    flicker: { label: 'Flicker', icon: '☀', hint: 'Random brightness flashes',
      params: [{ key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, def: 0.35, fmt: 'pct' },
        { key: 'rate', label: 'Speed', min: 1, max: 60, step: 1, def: 15, fmt: 'hz' }] }
  };
  const FX_ORDER = ['blend', 'rgbsplit', 'slices', 'pixelate', 'scanlines', 'noise', 'wobble', 'shake', 'flicker'];

  /** A fresh effect clip of a given type. */
  function newEffect(type, start, duration, id) {
    const def = FX_TYPES[type];
    const params = {};
    for (const p of def.params) params[p.key] = p.def;
    const fx = { id, type, start: Math.max(0, start || 0), duration: duration || 2.5, params };
    if (type === 'blend') { fx.mode = 'multiply'; fx.mediaId = null; }
    return fx;
  }
  /** Effect parameters with defaults filled in. */
  function fxParams(fx) {
    const def = FX_TYPES[fx.type];
    const out = {};
    for (const p of (def ? def.params : [])) out[p.key] = Math.min(p.max, Math.max(p.min, num(fx.params && fx.params[p.key], p.def)));
    return out;
  }
  const blendMode = (id) => BLEND_MODES.find((m) => m.id === id) || BLEND_MODES[1];

  // Deterministic pseudo-random numbers shared by the preview and ffmpeg (as an expression), so a
  // glitch looks the same in the player and in the exported file.
  function hash(a, b) {
    const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }
  function hashExpr(a, b) {
    const s = `sin((${a})*12.9898+(${b})*78.233)*43758.5453`;
    return `(${s}-floor(${s}))`;
  }
  const scaleOf = (W) => W / 1920;
  function slicesGeom(p, W, H) {
    return { bh: Math.max(2, Math.round((p.height / 100) * H)), shift: Math.round((p.shift / 100) * W), density: p.density, rate: p.rate };
  }
  /** Horizontal offset (px) of one band at local time lt: output(x) = source(x + offset). */
  function sliceOffset(g, band, lt) {
    const k = Math.floor(lt * g.rate);
    return hash(band, k) > 1 - g.density ? Math.floor((hash(band + 0.5, k) - 0.5) * 2 * g.shift) : 0;
  }
  function wobbleOffset(p, W, y, lt) {
    const k = scaleOf(W);
    return Math.floor(p.amount * k * Math.sin((2 * Math.PI * y) / Math.max(4, p.length * k) + 2 * Math.PI * p.speed * lt));
  }
  function scanGeom(p, W) {
    const gap = Math.max(2, Math.round(p.spacing * scaleOf(W)));
    return { gap, th: Math.max(1, Math.floor(gap / 2)) };
  }
  function pixelBlock(p, W) { return Math.max(2, Math.round(p.size * scaleOf(W))); }
  function shakeGeom(p, W, H) {
    const m = p.strength / 100;
    return { cw: even(W * (1 - 2 * m)), ch: even(H * (1 - 2 * m)) };
  }
  function shakeOrigin(p, W, H, lt) {
    const g = shakeGeom(p, W, H);
    const k = Math.floor(lt * p.rate);
    return { x: (W - g.cw) * hash(k, 1.3), y: (H - g.ch) * hash(k, 7.7), w: g.cw, h: g.ch };
  }
  function flickerLevel(p, lt) { return p.amount * 2 * (hash(Math.floor(lt * p.rate), 3.1) - 0.5); }

  /** ffmpeg filters for one glitch effect, run on a stream whose time starts at 0. Not used for blend. */
  function fxFilters(fx, W, H) {
    const p = fxParams(fx);
    const k = scaleOf(W);
    switch (fx.type) {
      case 'rgbsplit': {
        const a = p.amount * k, r = (p.angle * Math.PI) / 180;
        const dx = Math.round(Math.cos(r) * a), dy = Math.round(Math.sin(r) * a);
        return [`rgbashift=rh=${-dx}:rv=${-dy}:bh=${dx}:bv=${dy}:edge=smear`, 'format=yuv420p'];
      }
      case 'pixelate': {
        const s = pixelBlock(p, W);
        return [`scale=${Math.ceil(W / s)}:${Math.ceil(H / s)}:flags=neighbor`, `scale=${W}:${H}:flags=neighbor`, 'format=yuv420p'];
      }
      case 'scanlines': {
        const g = scanGeom(p, W);
        return [`drawgrid=w=0:h=${g.gap}:t=${g.th}:c=black@${fmt(p.darkness)}`];
      }
      case 'noise':
        return [`noise=alls=${Math.round(p.amount)}:allf=t`];
      case 'slices': {
        const g = slicesGeom(p, W, H);
        const band = `floor(Y/${g.bh})`;
        const step = `floor(T*${g.rate})`;
        const off = `if(gt(${hashExpr(band, step)},${fmt(1 - g.density)}),floor((${hashExpr(`${band}+0.5`, step)}-0.5)*2*${g.shift}),0)`;
        const at = (c) => `${c}='${c}(mod(X+${off}+W,W),Y)'`;
        return ['format=gbrp', `geq=${at('r')}:${at('g')}:${at('b')}`, 'format=yuv420p'];
      }
      case 'wobble': {
        const off = `floor(${fmt(p.amount * k)}*sin(2*PI*Y/${fmt(Math.max(4, p.length * k))}+2*PI*${fmt(p.speed)}*T))`;
        const at = (c) => `${c}='${c}(mod(X+${off}+W,W),Y)'`;
        return ['format=gbrp', `geq=${at('r')}:${at('g')}:${at('b')}`, 'format=yuv420p'];
      }
      case 'shake': {
        const g = shakeGeom(p, W, H);
        const step = `floor(t*${p.rate})`;
        return [`crop=w=${g.cw}:h=${g.ch}:x='(iw-ow)*${hashExpr(step, 1.3)}':y='(ih-oh)*${hashExpr(step, 7.7)}'`, `scale=${W}:${H}:flags=bicubic`, 'setsar=1'];
      }
      case 'flicker':
        return [`eq=brightness='${fmt(p.amount)}*2*(${hashExpr(`floor(t*${p.rate})`, 3.1)}-0.5)':eval=frame`];
      default:
        return [];
    }
  }

  function num(v, d) {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  }
  function fmt(n) {
    return String(Math.round(n * 10000) / 10000);
  }
  function even(n) {
    return Math.max(2, Math.round(n / 2) * 2);
  }

  /** Length of a clip on the timeline, in seconds. */
  function clipDuration(clip) {
    const speed = num(clip.speed, 1) || 1;
    return Math.max(0, (num(clip.out, 0) - num(clip.in, 0)) / speed);
  }

  function mainTrackDuration(project) {
    return project.tracks.video.reduce((s, c) => s + clipDuration(c), 0);
  }

  function projectDuration(project) {
    let d = mainTrackDuration(project);
    for (const t of project.tracks.text) d = Math.max(d, num(t.start, 0) + num(t.duration, 0));
    for (const a of project.tracks.audio) d = Math.max(d, num(a.start, 0) + clipDuration(a));
    return d;
  }

  /** Output frame size for a resolution id, preserving the project aspect. */
  function outputSize(project, resolutionId) {
    const pw = project.settings.width;
    const ph = project.settings.height;
    if (!resolutionId || resolutionId === 'project') return { width: even(pw), height: even(ph) };
    const short = Number(resolutionId);
    if (pw >= ph) return { width: even((short * pw) / ph), height: even(short) };
    return { width: even(short), height: even((short * ph) / pw) };
  }

  function nearestTier(shortSide) {
    const tiers = Object.keys(VIDEO_KBPS).map(Number);
    let best = tiers[0];
    for (const t of tiers) if (Math.abs(t - shortSide) < Math.abs(best - shortSide)) best = t;
    return best;
  }

  /**
   * Resolve bitrates for an export. opts: { format, resolution, quality,
   * fps, targetMB }. quality may be 'low' | 'medium' | 'high' | 'target'.
   */
  function bitrates(project, opts) {
    const f = FORMATS[opts.format] || FORMATS.mp4;
    const size = outputSize(project, opts.resolution);
    const fps = num(opts.fps, project.settings.fps || 30);
    const duration = Math.max(0.1, projectDuration(project));
    const q = opts.quality === 'target' ? 'medium' : (opts.quality || 'medium');
    let audio = f.audio ? AUDIO_KBPS[q] || 160 : 0;
    let video = 0;
    if (f.video && opts.format !== 'gif') {
      const shortSide = Math.min(size.width, size.height);
      const base = VIDEO_KBPS[nearestTier(shortSide)][q];
      const tierShort = nearestTier(shortSide);
      const pixelScale = (shortSide * shortSide) / (tierShort * tierShort);
      const fpsScale = Math.max(0.5, Math.min(2, fps / 30)) ** 0.75;
      video = Math.round(base * pixelScale * fpsScale * (opts.format === 'webm' ? 0.7 : 1));
    }
    if (opts.quality === 'target' && num(opts.targetMB, 0) > 0) {
      const totalKbps = (num(opts.targetMB, 0) * 8 * 1024 * 1024) / 1000 / duration / 1.02;
      if (!f.video) {
        audio = Math.max(32, Math.min(320, Math.round(totalKbps)));
      } else if (opts.format !== 'gif') {
        audio = Math.min(audio, Math.max(64, Math.round(totalKbps * 0.1)));
        video = Math.max(100, Math.round(totalKbps - audio));
      }
    }
    return { video, audio, size, fps, duration };
  }

  /** Estimated output size in bytes. */
  function estimateSize(project, opts) {
    const b = bitrates(project, opts);
    if (opts.format === 'gif') {
      const gif = gifSize(b.size);
      const gifFps = Math.min(15, b.fps);
      // Rough heuristic: ~0.12 bytes per pixel per frame for palette GIFs.
      return Math.round(gif.width * gif.height * gifFps * b.duration * 0.12);
    }
    return Math.round(((b.video + b.audio) * 1000 * b.duration) / 8 * 1.02);
  }

  function gifSize(size) {
    const maxW = 640;
    if (size.width <= maxW) return size;
    return { width: maxW, height: even((size.height * maxW) / size.width) };
  }

  function atempoChain(speed) {
    const parts = [];
    let s = speed;
    while (s > 2) { parts.push('atempo=2'); s /= 2; }
    while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5; }
    if (Math.abs(s - 1) > 1e-6) parts.push('atempo=' + fmt(s));
    return parts;
  }

  /** Position / scale of a clip inside the frame. x, y are offsets as a fraction of the frame. */
  function transformOf(clip) {
    const t = clip.transform || {};
    return { x: num(t.x, 0), y: num(t.y, 0), scale: Math.max(0.05, num(t.scale, 1)) };
  }
  function isIdentity(t) {
    return Math.abs(t.x) < 1e-4 && Math.abs(t.y) < 1e-4 && Math.abs(t.scale - 1) < 1e-4;
  }

  /** Size of media fitted (letterboxed) into a W x H frame. */
  function fitSize(m, W, H) {
    const mw = num(m.width, 0) || W;
    const mh = num(m.height, 0) || H;
    const s = Math.min(W / mw, H / mh);
    return { width: mw * s, height: mh * s };
  }

  /**
   * Which file and range to read for a clip. A reversed clip reads the
   * matching range of the pre-reversed copy (media.reversedPath) when one
   * exists, otherwise the normal range plus reverse filters.
   */
  function sourceRange(clip, m) {
    const cin = num(clip.in, 0);
    const cout = num(clip.out, 0);
    if (clip.reverse && m.type !== 'image') {
      if (m.reversedPath && num(m.duration, 0) > 0) {
        return { path: m.reversedPath, ss: Math.max(0, num(m.duration, 0) - cout), t: cout - cin, filterReverse: false };
      }
      return { path: m.path, ss: cin, t: cout - cin, filterReverse: true };
    }
    return { path: m.path, ss: cin, t: cout - cin, filterReverse: false };
  }

  /** Video effect filters, in the same order the preview applies them. */
  function effectFilters(fx, outWidth) {
    const e = Object.assign({}, DEFAULT_EFFECTS, fx || {});
    const out = [];
    if (e.flipH) out.push('hflip');
    if (e.flipV) out.push('vflip');
    const b = num(e.brightness, 1);
    if (Math.abs(b - 1) > 1e-3) {
      const k = fmt(b);
      out.push(`lutrgb=r='min(val*${k},maxval)':g='min(val*${k},maxval)':b='min(val*${k},maxval)'`);
    }
    const c = num(e.contrast, 1);
    const s = num(e.saturation, 1);
    if (Math.abs(c - 1) > 1e-3 || Math.abs(s - 1) > 1e-3) out.push(`eq=contrast=${fmt(c)}:saturation=${fmt(s)}`);
    if (e.grayscale) out.push('hue=s=0');
    if (e.sepia) out.push('colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131');
    if (e.invert) out.push('negate');
    const blur = num(e.blur, 0);
    if (blur > 0) out.push(`gblur=sigma=${fmt((blur * outWidth) / 1920)}`);
    if (e.vignette) out.push('vignette=angle=PI/4');
    return out;
  }

  /**
   * Build ffmpeg arguments.
   * project: project JSON (with media map).
   * opts: { format, resolution, quality, targetMB, fps, outputPath }.
   * textImages: { [textClipId]: absolute PNG path rendered at output size }.
   */
  function buildFfmpegArgs(project, opts, textImages) {
    const fmtInfo = FORMATS[opts.format] || FORMATS.mp4;
    const br = bitrates(project, opts);
    const W = br.size.width;
    const H = br.size.height;
    const fps = br.fps;
    const total = Math.max(0.1, projectDuration(project));
    const media = {};
    for (const m of project.media) media[m.id] = m;

    const args = ['-hide_banner', '-y', '-nostats', '-progress', 'pipe:1'];
    const graph = [];
    let inputIndex = 0;
    const segments = [];

    const addInput = (a) => { args.push(...a); return inputIndex++; };

    // Main (magnetic) video track.
    for (const clip of project.tracks.video) {
      const m = media[clip.mediaId];
      if (!m) continue;
      const D = clipDuration(clip);
      if (D <= 0.01) continue;
      const speed = num(clip.speed, 1) || 1;
      const isImage = m.type === 'image';
      const src = sourceRange(clip, m);
      let idx;
      if (isImage) {
        idx = addInput(['-loop', '1', '-framerate', String(fps), '-t', fmt(D), '-i', m.path]);
      } else {
        idx = addInput(['-ss', fmt(src.ss), '-t', fmt(src.t), '-i', src.path]);
      }
      const n = segments.length;
      const v = [];
      // No pre-reversed copy of the media: reverse the trimmed segment in memory.
      if (src.filterReverse) v.push('reverse');
      v.push(isImage ? 'setpts=PTS-STARTPTS' : `setpts=(PTS-STARTPTS)/${fmt(speed)}`);
      v.push(`fps=${fps}`);
      const tf = transformOf(clip);
      if (isIdentity(tf)) {
        v.push(`scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=bicubic`);
        v.push(...effectFilters(clip.effects, W));
        v.push(`pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`, 'setsar=1', 'format=yuv420p');
      } else {
        // Scaled / moved clip: fit, scale, then overlay onto a black frame.
        const fit = fitSize(m, W, H);
        const sw = even(fit.width * tf.scale);
        const sh = even(fit.height * tf.scale);
        v.push(`scale=${sw}:${sh}:flags=bicubic`, 'setsar=1');
        v.push(...effectFilters(clip.effects, W));
        v.push('format=yuva420p');
        graph.push(`[${idx}:v]${v.join(',')}[fg${n}]`);
        graph.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${fmt(D)},format=yuv420p[bg${n}]`);
        const ox = Math.round((W - sw) / 2 + tf.x * W);
        const oy = Math.round((H - sh) / 2 + tf.y * H);
        v.length = 0;
        v.push(`overlay=${ox}:${oy}:eof_action=repeat`, 'setsar=1', 'format=yuv420p');
      }
      const color = clip.fadeColor === 'white' ? 'white' : 'black';
      const fi = Math.min(num(clip.fadeIn, 0), D / 2);
      const fo = Math.min(num(clip.fadeOut, 0), D / 2);
      if (fi > 0) v.push(`fade=t=in:st=0:d=${fmt(fi)}:color=${color}`);
      if (fo > 0) v.push(`fade=t=out:st=${fmt(D - fo)}:d=${fmt(fo)}:color=${color}`);
      v.push(`tpad=stop_mode=clone:stop_duration=${fmt(D)}`, `trim=duration=${fmt(D)}`, 'setpts=PTS-STARTPTS');
      graph.push(`${isIdentity(tf) ? `[${idx}:v]` : `[bg${n}][fg${n}]`}${v.join(',')}[v${n}]`);

      const vol = clip.muted ? 0 : num(clip.volume, 1);
      if (!isImage && m.hasAudio) {
        const a = [...(src.filterReverse ? ['areverse'] : []), 'asetpts=PTS-STARTPTS', ...atempoChain(speed)];
        if (Math.abs(vol - 1) > 1e-3) a.push(`volume=${fmt(vol)}`);
        if (fi > 0) a.push(`afade=t=in:st=0:d=${fmt(fi)}`);
        if (fo > 0) a.push(`afade=t=out:st=${fmt(D - fo)}:d=${fmt(fo)}`);
        a.push(`aresample=${AUDIO_RATE}`, 'aformat=sample_fmts=fltp:channel_layouts=stereo', 'apad', `atrim=duration=${fmt(D)}`, 'asetpts=PTS-STARTPTS');
        graph.push(`[${idx}:a]${a.join(',')}[a${n}]`);
      } else {
        graph.push(`anullsrc=r=${AUDIO_RATE}:cl=stereo,atrim=duration=${fmt(D)},aformat=sample_fmts=fltp:channel_layouts=stereo[a${n}]`);
      }
      segments.push(D);
    }

    // Black gap so text/music that outlasts the main track still renders.
    const mainDur = segments.reduce((s, d) => s + d, 0);
    if (total - mainDur > 0.01) {
      const n = segments.length;
      const D = total - mainDur;
      graph.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${fmt(D)},setsar=1,format=yuv420p[v${n}]`);
      graph.push(`anullsrc=r=${AUDIO_RATE}:cl=stereo,atrim=duration=${fmt(D)},aformat=sample_fmts=fltp:channel_layouts=stereo[a${n}]`);
      segments.push(D);
    }

    const pads = segments.map((_, i) => `[v${i}][a${i}]`).join('');
    graph.push(`${pads}concat=n=${segments.length}:v=1:a=1[vcat][acat]`);

    // Text overlays (pre-rendered transparent PNGs, WYSIWYG with the preview).
    let vLabel = 'vcat';
    let t = 0;
    for (const tc of project.tracks.text) {
      const png = textImages && textImages[tc.id];
      const dur = num(tc.duration, 0);
      if (!png || dur <= 0) continue;
      const start = num(tc.start, 0);
      const idx = addInput(['-loop', '1', '-framerate', String(fps), '-t', fmt(dur), '-i', png]);
      const f = [`scale=${W}:${H}`, 'format=rgba'];
      const fade = Math.min(num(tc.fade, 0), dur / 2);
      if (fade > 0) {
        f.push(`fade=t=in:st=0:d=${fmt(fade)}:alpha=1`, `fade=t=out:st=${fmt(dur - fade)}:d=${fmt(fade)}:alpha=1`);
      }
      f.push(`setpts=PTS-STARTPTS+${fmt(start)}/TB`);
      graph.push(`[${idx}:v]${f.join(',')}[t${t}]`);
      const next = `vt${t}`;
      graph.push(`[${vLabel}][t${t}]overlay=0:0:eof_action=pass:enable='between(t,${fmt(start)},${fmt(start + dur)})'[${next}]`);
      vLabel = next;
      t++;
    }

    // Effect clips: run the stretch of video under each one through its filters, then lay it back
    // on top. They apply in track order to everything below (video and titles).
    let fxN = 0;
    for (const fx of project.tracks.fx || []) {
      const def = FX_TYPES[fx.type];
      const s = Math.max(0, num(fx.start, 0));
      const e = Math.min(total, s + num(fx.duration, 0));
      const D = e - s;
      if (!def || D < 0.04) continue;
      const n = fxN++;
      graph.push(`[${vLabel}]split=2[fb${n}][fs${n}]`);
      graph.push(`[fs${n}]trim=start=${fmt(s)}:end=${fmt(e)},setpts=PTS-STARTPTS,setsar=1[fl${n}]`);
      let tail = `fl${n}`;
      if (fx.type === 'blend') {
        const m = media[fx.mediaId];
        if (m && (m.type === 'image' || m.type === 'video')) {
          const idx = m.type === 'image'
            ? addInput(['-loop', '1', '-framerate', String(fps), '-t', fmt(D), '-i', m.path])
            : addInput(['-stream_loop', '-1', '-t', fmt(D), '-i', m.path]);
          graph.push(`[${idx}:v]fps=${fps},scale=${W}:${H}:force_original_aspect_ratio=increase:flags=bicubic,crop=${W}:${H},setsar=1,format=yuv420p,trim=duration=${fmt(D)},setpts=PTS-STARTPTS[ly${n}]`);
        } else {
          // No layer picked: blend the picture with a mirrored copy of itself.
          graph.push(`[${tail}]split=2[fm${n}a][fm${n}b]`);
          graph.push(`[fm${n}b]hflip[ly${n}]`);
          tail = `fm${n}a`;
        }
        const p = fxParams(fx);
        graph.push(`[${tail}]format=yuv420p[fq${n}]`);
        graph.push(`[fq${n}][ly${n}]blend=all_mode=${blendMode(fx.mode).id}:all_opacity=${fmt(p.opacity)}:shortest=1,format=yuv420p[fo${n}]`);
        tail = `fo${n}`;
      } else {
        graph.push(`[${tail}]${fxFilters(fx, W, H).join(',')}[fo${n}]`);
        tail = `fo${n}`;
      }
      graph.push(`[${tail}]setpts=PTS+${fmt(s)}/TB[fx${n}]`);
      graph.push(`[fb${n}][fx${n}]overlay=0:0:eof_action=pass:enable='between(t,${fmt(s)},${fmt(e)})'[vfx${n}]`);
      vLabel = `vfx${n}`;
    }

    // Music / voice-over track.
    const extra = [];
    project.tracks.audio.forEach((ac, i) => {
      const m = media[ac.mediaId];
      if (!m || !(m.type === 'audio' || m.hasAudio)) return;
      const D = clipDuration(ac);
      if (D <= 0.01) return;
      const idx = addInput(['-ss', fmt(num(ac.in, 0)), '-t', fmt(num(ac.out, 0) - num(ac.in, 0)), '-i', m.path]);
      const a = ['asetpts=PTS-STARTPTS'];
      const vol = ac.muted ? 0 : num(ac.volume, 1);
      if (Math.abs(vol - 1) > 1e-3) a.push(`volume=${fmt(vol)}`);
      const fi = Math.min(num(ac.fadeIn, 0), D / 2);
      const fo = Math.min(num(ac.fadeOut, 0), D / 2);
      if (fi > 0) a.push(`afade=t=in:st=0:d=${fmt(fi)}`);
      if (fo > 0) a.push(`afade=t=out:st=${fmt(D - fo)}:d=${fmt(fo)}`);
      a.push(`aresample=${AUDIO_RATE}`, 'aformat=sample_fmts=fltp:channel_layouts=stereo');
      const delay = Math.round(num(ac.start, 0) * 1000);
      if (delay > 0) a.push(`adelay=${delay}:all=1`);
      graph.push(`[${idx}:a]${a.join(',')}[m${i}]`);
      extra.push(`[m${i}]`);
    });
    let aLabel = 'acat';
    if (extra.length) {
      graph.push(`[acat]${extra.join('')}amix=inputs=${extra.length + 1}:duration=first:normalize=0[amix]`);
      aLabel = 'amix';
    }

    if (opts.format === 'gif') {
      const g = gifSize({ width: W, height: H });
      graph.push(`[${vLabel}]fps=${Math.min(15, fps)},scale=${g.width}:${g.height}:flags=lanczos,split[g1][g2]`);
      graph.push('[g1]palettegen=stats_mode=diff[pal]');
      graph.push('[g2][pal]paletteuse=dither=bayer:bayer_scale=4[vout]');
      vLabel = 'vout';
    }

    // Terminate streams the chosen format does not use.
    if (!fmtInfo.video) graph.push(`[${vLabel}]nullsink`);
    if (!fmtInfo.audio) graph.push(`[${aLabel}]anullsink`);

    args.push('-filter_complex', graph.join(';'));

    if (fmtInfo.video) args.push('-map', `[${vLabel}]`);
    if (fmtInfo.audio) args.push('-map', `[${aLabel}]`);

    const vk = br.video;
    switch (opts.format) {
      case 'webm':
        args.push('-c:v', 'libvpx-vp9', '-b:v', `${vk}k`, '-maxrate', `${Math.round(vk * 1.45)}k`, '-minrate', `${Math.round(vk * 0.5)}k`,
          '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', '-pix_fmt', 'yuv420p',
          '-c:a', 'libopus', '-b:a', `${br.audio}k`);
        break;
      case 'gif':
        args.push('-loop', '0');
        break;
      case 'mp3':
        args.push('-c:a', 'libmp3lame', '-b:a', `${br.audio}k`);
        break;
      default:
        args.push('-c:v', 'libx264', '-preset', 'medium', '-b:v', `${vk}k`, '-maxrate', `${Math.round(vk * 1.5)}k`,
          '-bufsize', `${vk * 2}k`, '-pix_fmt', 'yuv420p', '-r', String(fps),
          '-c:a', 'aac', '-b:a', `${br.audio}k`, '-movflags', '+faststart');
    }
    args.push('-t', fmt(total), opts.outputPath);
    return { args, duration: total, width: W, height: H };
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
  }

  return {
    RESOLUTIONS, FORMATS, VIDEO_KBPS, AUDIO_KBPS, DEFAULT_EFFECTS,
    clipDuration, mainTrackDuration, projectDuration, outputSize,
    bitrates, estimateSize, buildFfmpegArgs, effectFilters, formatBytes,
    transformOf, isIdentity, fitSize, sourceRange,
    BLEND_MODES, FX_TYPES, FX_ORDER, newEffect, fxParams, blendMode, fxFilters,
    hash, slicesGeom, sliceOffset, wobbleOffset, scanGeom, pixelBlock, shakeOrigin, flickerLevel
  };
});
