// Media probing with the bundled ffmpeg. No Electron dependencies so it can be tested directly.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'ogv', 'avi', 'mts', 'm2ts', '3gp'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'];
const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus', 'weba'];

function classify(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  return 'video';
}

const toSeconds = (h, m, s) => Number(h) * 3600 + Number(m) * 60 + Number(s);

function run(ffmpegPath, args) {
  return new Promise((resolve) => {
    const p = spawn(ffmpegPath, args);
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', () => resolve(err));
    p.on('error', () => resolve(null));
  });
}

/**
 * Files written by a browser's MediaRecorder (and some screen recorders) are WebM / MKV files
 * with no duration in the header. Decode them once without output to find out how long they are.
 */
async function measureDuration(ffmpegPath, file) {
  const err = await run(ffmpegPath, ['-hide_banner', '-nostats', '-i', file, '-map', '0:v:0?', '-map', '0:a:0?', '-f', 'null', '-']);
  if (!err) return 0;
  const all = [...err.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  if (!all.length) return 0;
  const last = all[all.length - 1];
  return toSeconds(last[1], last[2], last[3]);
}

/** Read duration / size / audio presence by parsing `ffmpeg -i` output. */
async function probe(ffmpegPath, file) {
  const err = await run(ffmpegPath, ['-hide_banner', '-i', file]);
  if (err === null) return null;
  const info = { path: file, name: path.basename(file), type: classify(file), size: 0, duration: 0, width: 0, height: 0, hasAudio: false };
  try { info.size = fs.statSync(file).size; } catch (_) {}
  const dm = err.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (dm) info.duration = toSeconds(dm[1], dm[2], dm[3]);
  const vm = err.match(/Stream #.*Video:.*?(\d{2,5})x(\d{2,5})/);
  if (vm) { info.width = Number(vm[1]); info.height = Number(vm[2]); }
  info.hasAudio = /Stream #.*Audio:/.test(err);
  if (/rotate\s*:\s*-?(90|270)/.test(err) || /rotation of -?90/.test(err)) [info.width, info.height] = [info.height, info.width];
  if (info.type === 'image') info.duration = 5;
  if (info.type === 'video' && !vm && info.hasAudio) info.type = 'audio';
  if (info.type !== 'image' && !(info.duration > 0)) info.duration = await measureDuration(ffmpegPath, file);
  return info;
}

module.exports = { probe, classify, measureDuration, VIDEO_EXT, IMAGE_EXT, AUDIO_EXT };
