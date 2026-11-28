export function writeClipboardText(text: string): Promise<void> {
  const desktop = window.grimoireDesktop?.clipboard;
  if (desktop) return desktop.writeText(text);
  if (!navigator.clipboard)
    return Promise.reject(new Error("Clipboard API is unavailable."));
  return navigator.clipboard.writeText(text);
}
