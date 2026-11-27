import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "./app.js";
import { SettingsStore } from "./settings.js";
import { NativeSandboxExecutor } from "./sandbox.js";
import type { BrowserRequest } from "./browser-tools.js";

type ParentPort = {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: any }) => void): void;
};
const parent = (process as NodeJS.Process & { parentPort?: ParentPort })
  .parentPort;
if (!parent)
  throw new Error("The desktop Agent requires an Electron utility process.");
const dataDir = process.env.GRIMOIRE_DESKTOP_DATA!;
const webDir = process.env.GRIMOIRE_DESKTOP_WEB!;
const development = process.env.GRIMOIRE_DESKTOP_DEV === "1";
if (!dataDir || (!development && !webDir))
  throw new Error("Desktop resource paths are missing.");
let nextRequest = 0;
const pending = new Map<number, (path: string | null) => void>();
const browserPending = new Map<
  number,
  { resolve(value: unknown): void; reject(error: Error): void }
>();
const app = createApp(new SettingsStore(join(dataDir, "providers.json")), {
  dataDir: join(dataDir, "pi"),
  allowFullAccess: true,
  browser: async (request: BrowserRequest, signal) => {
    signal?.throwIfAborted();
    const id = ++nextRequest;
    return new Promise((resolve, reject) => {
      const finish = (error?: Error, value?: unknown) => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", cancel);
        browserPending.delete(id);
        if (error) reject(error);
        else resolve(value);
      };
      const cancel = () => {
        parent.postMessage({ type: "browser-cancel", id });
        finish(new Error("Browser action cancelled."));
      };
      const timeout = setTimeout(cancel, 30_000);
      browserPending.set(id, {
        resolve: (value) => finish(undefined, value),
        reject: (error) => finish(error),
      });
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) return cancel();
      parent.postMessage({ type: "browser-request", id, request });
    });
  },
  selectFolder: async (initialPath, locale, signal) => {
    const id = ++nextRequest;
    return new Promise<string | null>((resolve) => {
      const finish = (path: string | null) => {
        pending.delete(id);
        signal?.removeEventListener("abort", cancel);
        resolve(path);
      };
      const cancel = () => finish(null);
      pending.set(id, finish);
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) return cancel();
      parent.postMessage({ type: "select-folder", id, initialPath, locale });
    });
  },
});
if (!development) {
  app.use("/*", serveStatic({ root: webDir }));
  app.get("*", (c) => {
    if (c.req.path.startsWith("/api/")) return c.notFound();
    return c.html(readFileSync(join(webDir, "index.html"), "utf8"));
  });
}
const server = serve(
  {
    fetch: app.fetch,
    hostname: "127.0.0.1",
    port: development ? Number(process.env.GRIMOIRE_DESKTOP_AGENT_PORT) : 0,
  },
  (info) => {
    parent.postMessage({ type: "ready", url: `http://127.0.0.1:${info.port}` });
  },
);
parent.on("message", async ({ data }) => {
  if (data.type === "browser-result") {
    const pending = browserPending.get(data.id);
    if (data.error) pending?.reject(new Error(data.error));
    else pending?.resolve(data.result);
  }
  if (data.type === "folder-result") pending.get(data.id)?.(data.path);
  if (data.type === "shutdown") {
    for (const pending of browserPending.values())
      pending.reject(new Error("The desktop Agent is shutting down."));
    for (const finish of pending.values()) finish(null);
    await app.dispose();
    if ("closeAllConnections" in server) server.closeAllConnections();
    server.close(() => process.exit(0));
  }
  if (data.type === "smoke-sandbox") {
    try {
      const executor = new NativeSandboxExecutor(
        data.path,
        process.platform === "win32",
      );
      let output = "";
      const result = await executor.exec(
        process.platform === "win32"
          ? 'Write-Output "grimoire-sandbox-ok"'
          : "printf grimoire-sandbox-ok",
        data.path,
        {
          onData: (chunk) => {
            output += chunk.toString();
          },
        },
      );
      parent.postMessage({
        type: "sandbox-result",
        executor: executor.kind,
        ...result,
        output,
      });
    } catch (error) {
      parent.postMessage({ type: "sandbox-result", error: String(error) });
    }
  }
});
