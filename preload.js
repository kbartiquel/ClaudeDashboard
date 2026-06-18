const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  pickFile: () => ipcRenderer.invoke('pick-file'),
  openExternalTerminal: (cwd, resumeSessionId, promptMode) => ipcRenderer.invoke('open-external-terminal', cwd, resumeSessionId, promptMode),
  saveTempFile: (arrayBuffer, mimeType, fileName) => ipcRenderer.invoke('save-temp-file', arrayBuffer, mimeType, fileName),
  getFilePath: (file) => webUtils.getPathForFile(file),
});
