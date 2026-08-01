const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('toastApi', {
  open: (nick) => ipcRenderer.send('toast:open', nick),
  dismiss: () => ipcRenderer.send('toast:dismiss'),
});
