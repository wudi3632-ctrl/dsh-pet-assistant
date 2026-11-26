const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('petDesktop', {
  regions: value => ipcRenderer.send('pet:regions', value),
  drag: (dx, dy) => ipcRenderer.send('pet:drag', dx, dy),
  settings: () => ipcRenderer.send('pet:settings'),
  lastTask: () => ipcRenderer.send('pet:last-task'),
  automation: ms => ipcRenderer.send('pet:automation', ms),
  pointer: value => ipcRenderer.send('pet:pointer', value),
  dragging: value => ipcRenderer.send('pet:dragging', value),
  setMicrophone: (enabled,deviceId='') => ipcRenderer.send('pet:microphone-set',{enabled,deviceId}),
  reportMicrophone: value => ipcRenderer.send('pet:microphone-state',value),
  getMicrophoneState: () => ipcRenderer.invoke('pet:microphone-state'),
  onMicrophone: callback => ipcRenderer.on('pet:microphone-state',(_event,value)=>callback(value)),
  listenNow: () => ipcRenderer.send('pet:listen-now'),
  onCommand: callback => ipcRenderer.on('pet:command', (_event, command) => callback(command)),
  onViewport: callback => ipcRenderer.on('pet:viewport',(_event,value)=>callback(value)),
  getViewport: () => ipcRenderer.invoke('pet:viewport'),
});
