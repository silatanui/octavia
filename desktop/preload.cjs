const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('octaviaDesktop', {
  isDesktop: true,
  platform: process.platform,
})
