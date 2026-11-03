const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('captureBridge', {
  listDisplays: () => ipcRenderer.invoke('capture:list-displays'),
  start: (displayId) => ipcRenderer.invoke('capture:start', displayId),
  stop: () => ipcRenderer.invoke('capture:stop'),
  onFrame: (callback) => {
    const listener = (_event, bytes) => callback(bytes)
    ipcRenderer.on('capture:frame', listener)
    return () => ipcRenderer.removeListener('capture:frame', listener)
  },
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status)
    ipcRenderer.on('capture:status', listener)
    return () => ipcRenderer.removeListener('capture:status', listener)
  },
})
