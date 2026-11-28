const { app, BrowserWindow, ipcMain, session } = require("electron");
const { createServer } = require("node:http");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const assert = require("node:assert/strict");
const { attachEmbeddedBrowser } = require("../src/embedded-browser.cjs");
const {
  browserPartition,
  createBrowserData,
} = require("../src/browser-data.cjs");
const data = mkdtempSync(join(tmpdir(), "grimoire-session-browser-"));
app.setPath("userData", data);
const handlers = new Map();
const original = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (name, fn) => {
  handlers.set(name, fn);
  original(name, fn);
};
let server, window;
let assetRequests = 0;
const timeout = setTimeout(() => {
  console.error("Browser isolation test timed out");
  app.exit(1);
}, 30000);
app
  .whenReady()
  .then(async () => {
    server = createServer((req, res) => {
      if (req.url === "/cached-resource") {
        assetRequests++;
        res.setHeader("Cache-Control", "public, max-age=31536000");
        res.end("cached resource");
        return;
      }
      res.setHeader("Content-Type", "text/html");
      res.end(
        "<!doctype html><title>Session test</title><label>Name<input aria-label=\"Name\"></label><label>Password<input type=\"password\" aria-label=\"Password\"></label><button onclick=\"localStorage.setItem('name',document.querySelector('input').value)\">Save</button><script>document.querySelector('input').value=localStorage.getItem('name')||''</script>",
      );
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${server.address().port}/`;
    window = new BrowserWindow({
      show: false,
      webPreferences: { backgroundThrottling: false },
    });
    await window.loadURL(url);
    const controller = attachEmbeddedBrowser(window, new URL(url).origin);
    const command = (request) =>
      handlers.get("grimoire:browser-command")(
        {
          sender: window.webContents,
          senderFrame: window.webContents.mainFrame,
        },
        request,
      );
    const a = { workspace: "/test", threadId: "a" };
    const b = { workspace: "/test", threadId: "b" };
    const run = (context, tool, args = {}) =>
      controller.execute({ ...context, tool, args });
    await command({ action: "bind", context: a });
    await run(a, "browser_navigate", { url });
    await command({ action: "bind", context: b });
    await run(b, "browser_navigate", { url });
    const snapshot = await run(a, "browser_snapshot");
    const name = snapshot.elements.find((e) => e.label === "Name");
    assert.ok(name);
    await run(a, "browser_type", {
      url,
      snapshotId: snapshot.snapshotId,
      ref: name.ref,
      label: name.label,
      text: "session-a-only",
    });
    const typed = await run(a, "browser_snapshot");
    assert.equal(
      typed.elements.find((e) => e.label === "Name").value,
      "session-a-only",
    );
    const save = typed.elements.find((e) => e.label === "Save");
    await run(a, "browser_click", {
      url,
      snapshotId: typed.snapshotId,
      ref: save.ref,
      label: save.label,
    });
    await run(b, "browser_navigate", { url });
    const other = await run(b, "browser_snapshot");
    assert.equal(other.elements.find((e) => e.label === "Name").value, "");
    await assert.rejects(
      run(b, "browser_type", {
        url,
        snapshotId: typed.snapshotId,
        ref: name.ref,
        label: name.label,
        text: "wrong-session",
      }),
    );
    await command({ action: "bind", context: a });
    const retained = await run(a, "browser_snapshot");
    assert.equal(
      retained.elements.find((e) => e.label === "Name").value,
      "session-a-only",
    );
    const aSession = session.fromPartition(`persist:${browserPartition(a)}`);
    const bSession = session.fromPartition(`persist:${browserPartition(b)}`);
    await aSession.cookies.set({ url, name: "login", value: "session-a" });
    await bSession.cookies.set({ url, name: "login", value: "session-b" });
    await (await aSession.fetch(`${url}cached-resource`)).text();
    await (await aSession.fetch(`${url}cached-resource`)).text();
    assert.equal(
      assetRequests,
      1,
      "The fixture should populate the HTTP cache",
    );
    const aView = window.contentView.children.find(
      (view) => view.webContents?.session === aSession,
    );
    assert.ok(aView);
    // Seed storage independently of background input-event timing.
    await aView.webContents.executeJavaScript(
      "localStorage.setItem('name', 'session-a-only')",
    );
    assert.equal(
      await aView.webContents.executeJavaScript("localStorage.getItem('name')"),
      "session-a-only",
      "Fixture storage should exist before cleanup",
    );
    await controller.clearCache();
    assert.equal(
      (await aSession.cookies.get({ name: "login" }))[0].value,
      "session-a",
    );
    assert.equal(
      (await bSession.cookies.get({ name: "login" }))[0].value,
      "session-b",
    );
    await run(a, "browser_navigate", { url });
    assert.equal(
      (await run(a, "browser_snapshot")).elements.find(
        (e) => e.label === "Name",
      ).value,
      "session-a-only",
    );
    await (await aSession.fetch(`${url}cached-resource`)).text();
    assert.equal(
      assetRequests,
      2,
      "Clear cache should evict the HTTP response",
    );

    // A certificate mode change must not leave the old session's cookies behind on deletion.
    await command({ action: "settings", ignoreCertificateErrors: true });
    const aUnverified = session.fromPartition(
      `persist:${browserPartition(a)}-unverified`,
    );
    const bUnverified = session.fromPartition(
      `persist:${browserPartition(b)}-unverified`,
    );
    await aUnverified.cookies.set({
      url,
      name: "login",
      value: "a-unverified",
    });
    await bUnverified.cookies.set({
      url,
      name: "login",
      value: "b-unverified",
    });
    await command({ action: "bind", context: b });
    await controller.clearData(a);
    assert.deepEqual(await aSession.cookies.get({}), []);
    assert.deepEqual(await aUnverified.cookies.get({}), []);
    assert.equal(
      (await bSession.cookies.get({ name: "login" }))[0].value,
      "session-b",
    );
    assert.equal(
      (await bUnverified.cookies.get({ name: "login" }))[0].value,
      "b-unverified",
    );
    await assert.rejects(command({ action: "bind", context: a }), /deleted/);
    const probe = new BrowserWindow({
      show: false,
      webPreferences: { session: aSession },
    });
    await probe.loadURL(url);
    assert.equal(
      await probe.webContents.executeJavaScript("localStorage.getItem('name')"),
      null,
    );
    probe.destroy();

    // Reopening the persisted ownership index must still find inactive partitions.
    const reopened = createBrowserData({ session, dataPath: data });
    await reopened.clear(b);
    assert.deepEqual(await bSession.cookies.get({}), []);
    assert.deepEqual(await bUnverified.cookies.get({}), []);
    clearTimeout(timeout);
    console.log(
      "PASS: browser isolation, cache eviction with cookies and local storage retained, per-chat data cleanup, certificate variants, and persisted ownership",
    );
    window.close();
    server.close();
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    window?.close();
    server?.close();
    app.exit(1);
  });
