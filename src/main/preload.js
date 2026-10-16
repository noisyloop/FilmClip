const { contextBridge, ipcRenderer, webUtils } = require('electron');
const { pathToFileURL } = require('url');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  pickMedia: () => ipcRenderer.invoke('media:pick'),
  probe: (files) => ipcRenderer.invoke('media:probe', files),
  makeProxy: (file) => ipcRenderer.invoke('media:proxy', file),
  fileUrl: (p) => pathToFileURL(p).href,
  pathForFile: (file) => webUtils.getPathForFile(file),
  saveProject: (filePath, data) => ipcRenderer.invoke('project:save', { filePath, data }),
  openProject: () => ipcRenderer.invoke('project:open'),
  pickExportPath: (defaultName, ext) => ipcRenderer.invoke('export:pickPath', { defaultName, ext }),
  startExport: (payload) => ipcRenderer.invoke('export:start', payload),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  onProgress: (cb) => ipcRenderer.on('export:progress', (_e, v) => cb(v)),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, cmd) => cb(cmd))
});
