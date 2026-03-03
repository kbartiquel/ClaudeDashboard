const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  openExternalTerminal: (cwd, resumeSessionId) => ipcRenderer.invoke('open-external-terminal', cwd, resumeSessionId),
  saveTempFile: (arrayBuffer, mimeType, fileName) => ipcRenderer.invoke('save-temp-file', arrayBuffer, mimeType, fileName),
});
