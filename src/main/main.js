// FilmClip main process. Fully offline: no accounts, no network calls.
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const RP = require('../shared/render-plan');

const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');

let win;
let exportProc = null;

const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'mts', 'm2ts', '3gp'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'];
const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus'];

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#16171d',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

function send(cmd) { if (win) win.webContents.send('menu', cmd); }

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
      { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
      { label: 'Save Project', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
      { label: 'Save Project As…', accelerator: 'Shift+CmdOrCtrl+S', click: () => send('saveAs') },
      { type: 'separator' },
      { label: 'Import Media…', accelerator: 'CmdOrCtrl+I', click: () => send('import') },
      { label: 'Export…', accelerator: 'CmdOrCtrl+E', click: () => send('export') },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' }
    ] },
    { label: 'Edit', submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') },
      { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: () => send('redo') },
      { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      { type: 'separator' },
      { label: 'Split at Playhead', accelerator: 'CmdOrCtrl+B', click: () => send('split') }
    ] },
    { label: 'View', submenu: [
      { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }
    ] },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function classify(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  return 'video';
}

/** Read duration / size / audio presence by parsing `ffmpeg -i` output. */
function probe(file) {
  return new Promise((resolve) => {
    const p = spawn(ffmpegPath, ['-hide_banner', '-i', file]);
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', () => {
      const info = { path: file, name: path.basename(file), type: classify(file), size: 0, duration: 0, width: 0, height: 0, hasAudio: false };
      try { info.size = fs.statSync(file).size; } catch (_) {}
      const dm = err.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (dm) info.duration = Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]);
      const vm = err.match(/Stream #.*Video:.*?(\d{2,5})x(\d{2,5})/);
      if (vm) { info.width = Number(vm[1]); info.height = Number(vm[2]); }
      info.hasAudio = /Stream #.*Audio:/.test(err);
      if (/rotate\s*:\s*-?(90|270)/.test(err) || /rotation of -?90/.test(err)) [info.width, info.height] = [info.height, info.width];
      if (info.type === 'image') info.duration = 5;
      if (info.type === 'video' && !vm && info.hasAudio) info.type = 'audio';
      resolve(info);
    });
    p.on('error', () => resolve(null));
  });
}

/** Transcode to a lightweight H.264 proxy when Chromium can't decode the source. */
function makeProxy(file) {
  const dir = path.join(app.getPath('userData'), 'proxies');
  fs.mkdirSync(dir, { recursive: true });
  const stat = fs.statSync(file);
  const out = path.join(dir, `${Buffer.from(file + stat.mtimeMs).toString('base64url').slice(-40)}.mp4`);
  if (fs.existsSync(out)) return Promise.resolve(out);
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ['-y', '-i', file, '-vf', 'scale=-2:min(720\\,ih)', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', out]);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error('Could not create preview proxy'))));
  });
}

ipcMain.handle('media:pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Media', extensions: [...VIDEO_EXT, ...IMAGE_EXT, ...AUDIO_EXT] }, { name: 'All Files', extensions: ['*'] }]
  });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('media:probe', (_e, files) => Promise.all(files.map(probe)));
ipcMain.handle('media:proxy', (_e, file) => makeProxy(file));

ipcMain.handle('project:save', async (_e, { filePath, data }) => {
  let target = filePath;
  if (!target) {
    const r = await dialog.showSaveDialog(win, { defaultPath: 'Untitled.fcproj', filters: [{ name: 'FilmClip Project', extensions: ['fcproj'] }] });
    if (r.canceled) return null;
    target = r.filePath;
  }
  fs.writeFileSync(target, JSON.stringify(data, null, 2));
  return target;
});
ipcMain.handle('project:open', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'FilmClip Project', extensions: ['fcproj'] }] });
  if (r.canceled) return null;
  return { filePath: r.filePaths[0], data: JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')) };
});

ipcMain.handle('export:pickPath', async (_e, { defaultName, ext }) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('videos'), `${defaultName}.${ext}`),
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
  });
  return r.canceled ? null : r.filePath;
});

ipcMain.handle('export:start', async (_e, { project, opts, textImages }) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'filmclip-'));
  const pngs = {};
  for (const [id, dataUrl] of Object.entries(textImages || {})) {
    const file = path.join(tmp, `${id}.png`);
    fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    pngs[id] = file;
  }
  const { args, duration } = RP.buildFfmpegArgs(project, opts, pngs);
  return new Promise((resolve) => {
    let log = '';
    exportProc = spawn(ffmpegPath, args);
    exportProc.stdout.on('data', (d) => {
      const m = String(d).match(/out_time_us=(\d+)/g);
      if (m) {
        const us = Number(m[m.length - 1].split('=')[1]);
        win.webContents.send('export:progress', Math.min(1, us / 1e6 / duration));
      }
    });
    exportProc.stderr.on('data', (d) => { log = (log + d).slice(-8000); });
    exportProc.on('close', (code, signal) => {
      exportProc = null;
      fs.rmSync(tmp, { recursive: true, force: true });
      if (code === 0) {
        resolve({ ok: true, path: opts.outputPath, size: fs.statSync(opts.outputPath).size });
      } else {
        try { fs.unlinkSync(opts.outputPath); } catch (_) {}
        resolve({ ok: false, canceled: signal === 'SIGTERM', error: log.split('\n').slice(-12).join('\n') });
      }
    });
  });
});
ipcMain.handle('export:cancel', () => { if (exportProc) exportProc.kill('SIGTERM'); });
ipcMain.handle('shell:reveal', (_e, p) => shell.showItemInFolder(p));

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
