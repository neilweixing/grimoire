function attachAppBridge(
  ipcMain,
  app,
  getWindow,
  getOrigin,
  { clearCache } = {},
) {
  function validate(event) {
    const window = getWindow();
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      new URL(event.senderFrame.url).origin !== getOrigin()
    )
      throw new Error(
        "Application controls are restricted to the main application.",
      );
  }
  ipcMain.handle("grimoire:app-clear-cache", async (event) => {
    validate(event);
    if (!clearCache) throw new Error("Cache cleanup is unavailable.");
    await clearCache();
  });
  ipcMain.handle("grimoire:app-quit", (event) => {
    validate(event);
    // Use normal shutdown so Pi cleanup and deferred update installation still run.
    app.quit();
  });
}

function minimizeOnClose(window, isQuitting) {
  window.on("close", (event) => {
    if (isQuitting()) return;
    event.preventDefault();
    window.minimize();
  });
}
module.exports = { attachAppBridge, minimizeOnClose };
