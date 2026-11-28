function attachAppBridge(ipcMain, app, getWindow, getOrigin) {
  ipcMain.handle("grimoire:app-quit", (event) => {
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
