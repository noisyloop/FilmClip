// Smoke test: build a project, render every format with the bundled ffmpeg.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const RP = require('../src/shared/render-plan');
const { reverseVideo } = require('../src/main/reverse');
const { probe } = require('../src/main/probe');
// The bundled binary when installed, otherwise ffmpeg from PATH.
const ffmpeg = (() => { try { const p = require('ffmpeg-static'); if (p && fs.existsSync(p)) return p; } catch (_) {} return 'ffmpeg'; })();
const tmp = path.join(__dirname, 'tmp');
fs.mkdirSync(tmp, { recursive: true });
const gen = (args) => { const r = spawnSync(ffmpeg, ['-v', 'error', '-y', ...args]); if (r.status) throw new Error(String(r.stderr)); };
gen(['-f', 'lavfi', '-i', 'testsrc=s=640x360:r=30:d=4', '-f', 'lavfi', '-i', 'sine=f=440:d=4', '-shortest', path.join(tmp, 'a.mp4')]);
gen(['-f', 'lavfi', '-i', 'color=red:s=320x240:d=1', '-frames:v', '1', path.join(tmp, 'img.png')]);
gen(['-f', 'lavfi', '-i', 'color=c=black@0:s=1280x720,format=rgba', '-frames:v', '1', path.join(tmp, 'text.png')]);
gen(['-f', 'lavfi', '-i', 'sine=f=220:d=3', path.join(tmp, 'm.mp3')]);
const project = {
  settings: { width: 1920, height: 1080, fps: 30 },
  media: [
    { id: 'v', type: 'video', path: path.join(tmp, 'a.mp4'), hasAudio: true, duration: 4, width: 640, height: 360 },
    { id: 'r', type: 'video', path: path.join(tmp, 'a.mp4'), reversedPath: path.join(tmp, 'a-rev.mp4'), hasAudio: true, duration: 4, width: 640, height: 360 },
    { id: 'i', type: 'image', path: path.join(tmp, 'img.png') },
    { id: 'm', type: 'audio', path: path.join(tmp, 'm.mp3'), hasAudio: true }
  ],
  tracks: {
    video: [
      { id: 'c1', mediaId: 'v', in: 0.5, out: 3.5, speed: 2, volume: 0.8, fadeIn: 0.3, effects: { brightness: 1.2, contrast: 1.1, saturation: 0.5, blur: 2, sepia: true, vignette: true, flipH: true } },
      { id: 'c2', mediaId: 'i', in: 0, out: 2, speed: 1, fadeOut: 0.5, fadeColor: 'white', effects: { grayscale: true, invert: true }, transform: { x: 0.2, y: -0.1, scale: 0.5 } },
      // reversed, no pre-reversed copy: reversed with filters
      { id: 'c3', mediaId: 'v', in: 1, out: 2.5, speed: 1, reverse: true, transform: { x: -0.6, y: 0.4, scale: 1.8 }, effects: { flipH: true } },
      // reversed via the pre-reversed copy, sped up
      { id: 'c4', mediaId: 'r', in: 0.5, out: 3.5, speed: 1.5, reverse: true }
    ],
    text: [{ id: 't1', start: 1, duration: 4, fade: 0.3 }],
    audio: [{ id: 'a1', mediaId: 'm', start: 0.5, in: 0, out: 3, volume: 0.5, fadeIn: 0.5 }]
  }
};
let failed = 0;

// Pre-reversed copy (chunked) must match the source length and run backwards.
const frameMean = (file, t) => {
  const r = spawnSync(ffmpeg, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=8:8,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 });
  return [...r.stdout].reduce((a, b) => a + b, 0);
};
const probeDuration = (file) => {
  const m = String(spawnSync(ffmpeg, ['-hide_banner', '-i', file]).stderr).match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
};
const RANGE_CHECKS = [
  ['plain', { reverse: false, in: 1, out: 3 }, { path: project.media[0].path, ss: 1, t: 2, filterReverse: false }],
  ['reverse, filters', { reverse: true, in: 1, out: 3 }, { path: project.media[0].path, ss: 1, t: 2, filterReverse: true }],
  ['reverse, copy', { reverse: true, in: 1, out: 3 }, { path: project.media[1].reversedPath, ss: 1, t: 2, filterReverse: false }]
];
RANGE_CHECKS.forEach(([name, clip, want], i) => {
  const got = RP.sourceRange(clip, project.media[i === 2 ? 1 : 0]);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} sourceRange ${name}${ok ? '' : ` got ${JSON.stringify(got)}`}`);
});

(async () => {
await reverseVideo(ffmpeg, project.media[0].path, project.media[1].reversedPath, { duration: 4, hasAudio: true });
{
  const d = probeDuration(project.media[1].reversedPath);
  // testsrc frames differ over time; frame at t in the reversed copy must match frame at 4 - t in the source.
  const same = (a, b) => Math.abs(a - b) < 30;
  const okDur = Math.abs(d - 4) < 0.15;
  const okDir = same(frameMean(project.media[1].reversedPath, 0.5), frameMean(project.media[0].path, 3.5 - 1 / 30)) &&
    same(frameMean(project.media[1].reversedPath, 3.0), frameMean(project.media[0].path, 1.0 - 1 / 30));
  if (!okDur || !okDir) failed++;
  console.log(`${okDur && okDir ? 'ok  ' : 'FAIL'} reverseVideo duration=${d}s backwards=${okDir}`);
}

for (const format of ['mp4', 'mov', 'webm', 'gif', 'mp3']) {
  const out = path.join(tmp, 'out.' + format);
  const opts = { format, resolution: '720', quality: 'medium', outputPath: out };
  const { args, duration } = RP.buildFfmpegArgs(project, opts, { t1: path.join(tmp, 'text.png') });
  const r = spawnSync(ffmpeg, args, { encoding: 'utf8' });
  const ok = r.status === 0 && fs.existsSync(out);
  if (!ok) { failed++; console.error(r.stderr.split('\n').slice(-15).join('\n')); }
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${format}  duration=${duration}s  estimate=${RP.formatBytes(RP.estimateSize(project, opts))}  actual=${ok ? RP.formatBytes(fs.statSync(out).size) : '-'}`);
}

// ---- WebM import: probe a normal WebM, an audio-only WebM and a recording with no duration in its header.
{
  const webm = path.join(tmp, 'clip.webm');
  gen(['-f', 'lavfi', '-i', 'testsrc=s=320x180:r=15:d=2', '-f', 'lavfi', '-i', 'sine=f=330:d=2', '-c:v', 'libvpx-vp9', '-c:a', 'libopus', '-shortest', webm]);
  const live = path.join(tmp, 'live.webm'); // like a browser MediaRecorder file: no duration / cues
  gen(['-f', 'lavfi', '-i', 'testsrc=s=320x180:r=15:d=2', '-c:v', 'libvpx', '-f', 'webm', '-live', '1', live]);
  const aud = path.join(tmp, 'voice.webm');
  gen(['-f', 'lavfi', '-i', 'sine=f=330:d=2', '-c:a', 'libopus', aud]);
  const checks = [
    ['webm video', await probe(ffmpeg, webm), (i) => i.type === 'video' && i.hasAudio && i.width === 320 && Math.abs(i.duration - 2) < 0.2],
    ['webm without duration', await probe(ffmpeg, live), (i) => i.type === 'video' && i.width === 320 && Math.abs(i.duration - 2) < 0.3],
    ['webm audio only', await probe(ffmpeg, aud), (i) => i.type === 'audio' && i.hasAudio && Math.abs(i.duration - 2) < 0.2]
  ];
  for (const [name, info, test] of checks) {
    const ok = !!info && test(info);
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} import ${name} ${info ? `type=${info.type} dur=${info.duration.toFixed(2)}s ${info.width}x${info.height}` : 'null'}`);
  }
  // A WebM clip must also export (timeline edit with trim + effect).
  const p2 = { settings: { width: 640, height: 360, fps: 15 }, media: [{ id: 'w', type: 'video', path: webm, hasAudio: true, duration: 2, width: 320, height: 180 }],
    tracks: { video: [{ id: 'w1', mediaId: 'w', in: 0.2, out: 1.8, speed: 1 }], text: [], audio: [], fx: [] } };
  const out = path.join(tmp, 'webm-out.mp4');
  const r = spawnSync(ffmpeg, RP.buildFfmpegArgs(p2, { format: 'mp4', resolution: 'project', quality: 'low', outputPath: out }, {}).args, { encoding: 'utf8' });
  const ok = r.status === 0 && fs.existsSync(out);
  if (!ok) { failed++; console.error(r.stderr.split('\n').slice(-10).join('\n')); }
  console.log(`${ok ? 'ok  ' : 'FAIL'} export from a webm clip`);
}

// ---- Effect clips: each one must render, change the picture inside its window and leave the rest alone.
{
  const base = { settings: { width: 320, height: 180, fps: 10 },
    media: [{ id: 'v', type: 'video', path: path.join(tmp, 'a.mp4'), hasAudio: true, duration: 4, width: 640, height: 360 },
      { id: 'i', type: 'image', path: path.join(tmp, 'img.png') }],
    tracks: { video: [{ id: 'c', mediaId: 'v', in: 0, out: 3, speed: 1 }], text: [], audio: [], fx: [] } };
  const render = (fx, name) => {
    const proj = JSON.parse(JSON.stringify(base));
    proj.tracks.fx = fx;
    const out = path.join(tmp, `fx-${name}.mp4`);
    const r = spawnSync(ffmpeg, RP.buildFfmpegArgs(proj, { format: 'mp4', resolution: 'project', quality: 'medium', outputPath: out }, {}).args, { encoding: 'utf8' });
    return { out, r };
  };
  const frame = (file, t) => spawnSync(ffmpeg, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 24 }).stdout;
  const diff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i += 7) d += Math.abs(a[i] - (b[i] || 0)); return d / (a.length / 7); };
  const plain = render([], 'none');
  if (plain.r.status) { failed++; console.error(plain.r.stderr.split('\n').slice(-8).join('\n')); }
  const types = [...RP.FX_ORDER, 'blend-image', 'blend-video'];
  for (const name of types) {
    const type = name.split('-')[0];
    const fx = RP.newEffect(type, 1, 1, 'f1');
    if (name === 'blend-image') { fx.mediaId = 'i'; fx.mode = 'difference'; fx.params.opacity = 1; }
    if (name === 'blend-video') { fx.mediaId = 'v'; fx.mode = 'screen'; }
    const { out, r } = render([fx], name);
    let ok = r.status === 0 && fs.existsSync(out);
    let note = '';
    if (ok) {
      const inside = diff(frame(out, 1.5), frame(plain.out, 1.5));
      const before = diff(frame(out, 0.4), frame(plain.out, 0.4));
      const after = diff(frame(out, 2.5), frame(plain.out, 2.5));
      ok = inside > 3 && before < 2 && after < 3 && before < inside / 3 && after < inside / 2;
      note = `  changed ${inside.toFixed(1)} inside, ${before.toFixed(1)} before, ${after.toFixed(1)} after`;
    } else console.error(r.stderr.split('\n').slice(-12).join('\n'));
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} effect ${name}${note}`);
  }
  // Effects stack and several can overlap.
  const stack = [RP.newEffect('rgbsplit', 0.5, 2, 's1'), RP.newEffect('slices', 1, 1.5, 's2'), RP.newEffect('noise', 1.2, 0.5, 's3')];
  const { out, r } = render(stack, 'stack');
  const ok = r.status === 0 && fs.existsSync(out);
  if (!ok) { failed++; console.error(r.stderr.split('\n').slice(-12).join('\n')); }
  console.log(`${ok ? 'ok  ' : 'FAIL'} overlapping effect clips`);
}

// ---- Hostile project files: effect types that are not real effects must be ignored, not crash or reach ffmpeg.
{
  const proj = { settings: { width: 320, height: 180, fps: 10 }, media: [{ id: 'v', type: 'video', path: path.join(tmp, 'a.mp4'), hasAudio: true, duration: 4, width: 640, height: 360 }],
    tracks: { video: [{ id: 'c', mediaId: 'v', in: 0, out: 1, speed: 1 }], text: [], audio: [],
      fx: [{ id: 'x1', type: 'constructor', start: 0, duration: 1 }, { id: 'x2', type: '__proto__', start: 0, duration: 1 }, { id: 'x3', type: 'toString', start: 0, duration: 1 },
        { id: 'x4', type: 'blend', mode: "normal',drawtext=text='x", start: 0, duration: 1, params: { opacity: '1:x' } },
        { id: 'x5', type: 'slices', start: 0, duration: 1, params: { rate: '1);x', shift: {}, height: null, density: 'NaN' } }] } };
  let ok = false;
  try {
    const graph = RP.buildFfmpegArgs(proj, { format: 'mp4', resolution: 'project', quality: 'low', outputPath: path.join(tmp, 'hostile.mp4') }, {});
    const text = graph.args.join(' ');
    const r = spawnSync(ffmpeg, graph.args, { encoding: 'utf8' });
    ok = !RP.fxDef('constructor') && !RP.fxDef('__proto__') && !!RP.fxDef('blend') && !text.includes('drawtext') && !text.includes(');x') && r.status === 0;
    if (r.status) console.error(r.stderr.split('\n').slice(-8).join('\n'));
  } catch (e) { console.error(e.message); }
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} hostile effect clips are ignored or sanitised`);
}
process.exit(failed ? 1 : 0);
})();
