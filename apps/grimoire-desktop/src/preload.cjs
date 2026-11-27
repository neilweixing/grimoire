const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("grimoireDesktop", {
  browser: {
    command: (command) =>
      ipcRenderer.invoke("grimoire:browser-command", command),
    onState: (listener) => {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on("grimoire:browser-state", handler);
      return () =>
        ipcRenderer.removeListener("grimoire:browser-state", handler);
    },
    onOpen: (listener) => {
      const handler = () => listener();
      ipcRenderer.on("grimoire:browser-open", handler);
      return () => ipcRenderer.removeListener("grimoire:browser-open", handler);
    },
  },
});

window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.dataset.desktop =
    process.platform === "darwin" ? "macos" : "windows";
});
