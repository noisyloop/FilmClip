// Smoke test: build a project, render every format with the bundled ffmpeg.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const RP = require('../src/shared/render-plan');
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
    { id: 'v', type: 'video', path: path.join(tmp, 'a.mp4'), hasAudio: true },
    { id: 'i', type: 'image', path: path.join(tmp, 'img.png') },
    { id: 'm', type: 'audio', path: path.join(tmp, 'm.mp3'), hasAudio: true }
  ],
  tracks: {
    video: [
      { id: 'c1', mediaId: 'v', in: 0.5, out: 3.5, speed: 2, volume: 0.8, fadeIn: 0.3, effects: { brightness: 1.2, contrast: 1.1, saturation: 0.5, blur: 2, sepia: true, vignette: true, flipH: true } },
      { id: 'c2', mediaId: 'i', in: 0, out: 2, speed: 1, fadeOut: 0.5, fadeColor: 'white', effects: { grayscale: true, invert: true } }
    ],
    text: [{ id: 't1', start: 1, duration: 4, fade: 0.3 }],
    audio: [{ id: 'a1', mediaId: 'm', start: 0.5, in: 0, out: 3, volume: 0.5, fadeIn: 0.5 }]
  }
};
let failed = 0;
for (const format of ['mp4', 'mov', 'webm', 'gif', 'mp3']) {
  const out = path.join(tmp, 'out.' + format);
  const opts = { format, resolution: '720', quality: 'medium', outputPath: out };
  const { args, duration } = RP.buildFfmpegArgs(project, opts, { t1: path.join(tmp, 'text.png') });
  const r = spawnSync(ffmpeg, args, { encoding: 'utf8' });
  const ok = r.status === 0 && fs.existsSync(out);
  if (!ok) { failed++; console.error(r.stderr.split('\n').slice(-15).join('\n')); }
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${format}  duration=${duration}s  estimate=${RP.formatBytes(RP.estimateSize(project, opts))}  actual=${ok ? RP.formatBytes(fs.statSync(out).size) : '-'}`);
}
process.exit(failed ? 1 : 0);
