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
      let idx;
      if (isImage) {
        idx = addInput(['-loop', '1', '-framerate', String(fps), '-t', fmt(D), '-i', m.path]);
      } else {
        idx = addInput(['-ss', fmt(num(clip.in, 0)), '-t', fmt(num(clip.out, 0) - num(clip.in, 0)), '-i', m.path]);
      }
      const n = segments.length;
      const v = [];
      v.push(isImage ? 'setpts=PTS-STARTPTS' : `setpts=(PTS-STARTPTS)/${fmt(speed)}`);
      v.push(`fps=${fps}`);
      v.push(`scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=bicubic`);
      v.push(...effectFilters(clip.effects, W));
      v.push(`pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`, 'setsar=1', 'format=yuv420p');
      const color = clip.fadeColor === 'white' ? 'white' : 'black';
      const fi = Math.min(num(clip.fadeIn, 0), D / 2);
      const fo = Math.min(num(clip.fadeOut, 0), D / 2);
      if (fi > 0) v.push(`fade=t=in:st=0:d=${fmt(fi)}:color=${color}`);
      if (fo > 0) v.push(`fade=t=out:st=${fmt(D - fo)}:d=${fmt(fo)}:color=${color}`);
      v.push(`tpad=stop_mode=clone:stop_duration=${fmt(D)}`, `trim=duration=${fmt(D)}`, 'setpts=PTS-STARTPTS');
      graph.push(`[${idx}:v]${v.join(',')}[v${n}]`);

      const vol = clip.muted ? 0 : num(clip.volume, 1);
      if (!isImage && m.hasAudio) {
        const a = ['asetpts=PTS-STARTPTS', ...atempoChain(speed)];
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
    bitrates, estimateSize, buildFfmpegArgs, effectFilters, formatBytes
  };
});
