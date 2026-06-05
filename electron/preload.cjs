// Preload — exposes a minimal, safe API to the renderer via contextBridge.
// All sensitive logic (env vars, API keys) stays in the main process.

const { contextBridge, ipcRenderer } = require("electron");

const updaterChannels = [
  "updater:checking",
  "updater:available",
  "updater:progress",
  "updater:downloaded",
  "updater:not-available",
  "updater:error",
];

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  platform: process.platform,
  getAISignal: (data) => ipcRenderer.invoke("ai:getSignal", data),
  telegram: {
    status: () => ipcRenderer.invoke("telegram:status"),
    send: (text, parseMode) =>
      ipcRenderer.invoke("telegram:send", { text, parseMode }),
    sendSignal: (signal, symbol, interval, extra) =>
      ipcRenderer.invoke("telegram:sendSignal", {
        signal,
        symbol,
        interval,
        extra,
      }),
    sendAlert: (event) => ipcRenderer.invoke("telegram:sendAlert", event),
    test: () => ipcRenderer.invoke("telegram:test"),
  },
  updater: {
    status: () => ipcRenderer.invoke("updater:status"),
    check: () => ipcRenderer.invoke("updater:check"),
    install: () => ipcRenderer.invoke("updater:install"),
    onEvent: (callback) => {
      if (typeof callback !== "function") return () => {};
      const handler = (_e, channel, payload) => callback(channel, payload);
      for (const ch of updaterChannels) {
        ipcRenderer.on(ch, (e, payload) =>
          callback(ch.replace("updater:", ""), payload),
        );
      }
      return () => {
        for (const ch of updaterChannels) {
          ipcRenderer.removeAllListeners(ch);
        }
      };
    },
  },
});
