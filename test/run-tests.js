// Smoke test: build a project, render every format with the bundled ffmpeg.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const RP = require('../src/shared/render-plan');
const { reverseVideo } = require('../src/main/reverse');
const ffmpeg = require('ffmpeg-static');
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
    audio: [
      { id: 'a1', mediaId: 'm', lane: 0, start: 0.5, in: 0, out: 3, volume: 0.5, fadeIn: 0.5 },
      // sound effect: sped up, ends at 1 + 2 / 2 = 2 s
      { id: 'a2', mediaId: 'm', lane: 1, start: 1, in: 0, out: 2, speed: 2 },
      // voice-over reversed with filters, ends at 6 + 1.5 = 7.5 s (longer than the video: sets the length)
      { id: 'a3', mediaId: 'm', lane: 2, start: 6, in: 0.5, out: 2, reverse: true },
      // detached audio of a reversed video clip, read from the pre-reversed copy
      { id: 'a4', mediaId: 'r', lane: 1, start: 0, in: 1, out: 2, reverse: true, speed: 0.5 }
    ]
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
  const actual = ok ? probeDuration(out) : 0;
  if (ok && Math.abs(actual - 7.5) > 0.2) { failed++; console.log(`FAIL ${format} length ${actual}s, expected 7.5s`); }
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${format}  duration=${duration}s  estimate=${RP.formatBytes(RP.estimateSize(project, opts))}  actual=${ok ? RP.formatBytes(fs.statSync(out).size) : '-'}`);
}
// Audio-only project (no video clips) exported to MP3; a 3 s sound at 2× must end at 1.5 s.
{
  const p = { settings: { width: 640, height: 360, fps: 30 }, media: [{ id: 'm', type: 'audio', path: path.join(tmp, 'm.mp3'), hasAudio: true, duration: 3 }],
    tracks: { video: [], text: [{ id: 't', start: 0, duration: 3 }], audio: [{ id: 'a', mediaId: 'm', lane: 2, start: 0, in: 0, out: 3, speed: 2 }] } };
  const out = path.join(tmp, 'audio-only.mp3');
  const r = spawnSync(ffmpeg, RP.buildFfmpegArgs(p, { format: 'mp3', resolution: '480', quality: 'medium', outputPath: out }, {}).args, { encoding: 'utf8' });
  const sd = spawnSync(ffmpeg, ['-i', out, '-af', 'silencedetect=n=-40dB:d=0.3', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const m = sd.match(/silence_start: ([\d.]+)/);
  const ok = r.status === 0 && m && Math.abs(Number(m[1]) - 1.5) < 0.1;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} audio-only mp3, 2× speed ends at ${m ? m[1] : '?'}s`);
}
process.exit(failed ? 1 : 0);
})();
