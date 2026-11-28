function attachClipboardBridge(ipcMain, clipboard, getWindow, getOrigin) {
  ipcMain.handle("grimoire:clipboard-write", (event, text) => {
    const window = getWindow();
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      new URL(event.senderFrame.url).origin !== getOrigin()
    )
      throw new Error(
        "Clipboard writes are restricted to the main application.",
      );
    if (
      typeof text !== "string" ||
      Buffer.byteLength(text, "utf8") > 8 * 1024 * 1024
    )
      throw new Error("Invalid clipboard text.");
    clipboard.writeText(text);
  });
}
module.exports = { attachClipboardBridge };
