// Build a reversed copy of a video file with ffmpeg. Video is reversed in short
// chunks (ffmpeg's reverse filter buffers every frame in memory) and the chunks
// are joined in reverse order; audio is reversed in one pass.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHUNK_SECONDS = 4;

function run(ffmpegPath, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ['-hide_banner', '-v', 'error', '-y', ...args]);
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err || `ffmpeg exited with ${code}`))));
  });
}

async function reverseVideo(ffmpegPath, file, out, { duration, hasAudio }) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'filmclip-rev-'));
  try {
    const n = Math.max(1, Math.ceil(duration / CHUNK_SECONDS - 1e-6));
    const parts = [];
    for (let i = 0; i < n; i++) {
      const part = path.join(work, `v${i}.mp4`);
      const len = Math.min(CHUNK_SECONDS, duration - i * CHUNK_SECONDS);
      await run(ffmpegPath, ['-ss', String(i * CHUNK_SECONDS), '-t', String(len), '-i', file, '-an', '-vf', 'reverse',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', part]);
      parts.push(part);
    }
    const list = path.join(work, 'list.txt');
    fs.writeFileSync(list, parts.reverse().map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
    const tmpOut = path.join(work, 'out.mp4');
    if (hasAudio) {
      const audio = path.join(work, 'a.m4a');
      await run(ffmpegPath, ['-i', file, '-vn', '-af', 'areverse', '-c:a', 'aac', '-b:a', '192k', audio]);
      await run(ffmpegPath, ['-f', 'concat', '-safe', '0', '-i', list, '-i', audio, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-movflags', '+faststart', tmpOut]);
    } else {
      await run(ffmpegPath, ['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', tmpOut]);
    }
    fs.copyFileSync(tmpOut, out + '.part');
    fs.renameSync(out + '.part', out);
    return out;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = { reverseVideo, run };
