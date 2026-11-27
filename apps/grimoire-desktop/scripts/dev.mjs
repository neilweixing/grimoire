import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, watch } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer as createNetServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = fileURLToPath(new URL("../", import.meta.url));
const root = fileURLToPath(new URL("../../../", import.meta.url));
const agent = join(root, "apps/grimoire-agent");
const web = join(root, "apps/grimoire-web");
const requireAgent = createRequire(join(agent, "package.json"));
const requireWeb = createRequire(join(web, "package.json"));
const requireDesktop = createRequire(join(desktop, "package.json"));
const dataDir =
  process.env.GRIMOIRE_DESKTOP_USER_DATA ||
  join(root, ".data/desktop-dev/profile");
const statePath = join(dataDir, "dev-state.json");
const output = join(
  agent,
  ".desktop-dev",
  createHash("sha256").update(dataDir).digest("hex").slice(0, 12),
);
const inspectorPorts = {
  main: port("GRIMOIRE_MAIN_INSPECT_PORT", 9229),
  agent: port("GRIMOIRE_AGENT_INSPECT_PORT", 9230),
  renderer: port("GRIMOIRE_RENDERER_INSPECT_PORT", 9222),
};
const watchers = [];
let vite;
let electron;
let stopping = false;
let expectedExit;
let buildTimer;
let restartTimer;
let builds = Promise.resolve();
let restarts = Promise.resolve();

function port(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1024 || value > 65535)
    throw new Error(`${name} must be a port between 1024 and 65535.`);
  return value;
}

function reservePort(value = 0) {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once("error", () =>
      reject(
        new Error(
          `Port ${value} is in use. Stop the existing debugger or override its GRIMOIRE_*_INSPECT_PORT variable.`,
        ),
      ),
    );
    server.listen(value, "127.0.0.1", () => {
      const selected = server.address().port;
      server.close((error) => (error ? reject(error) : resolve(selected)));
    });
  });
}

async function stopElectron() {
  const child = electron;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  expectedExit = child;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    }, 8000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
  if (electron === child) electron = undefined;
}

async function startElectron(apiPort, webUrl) {
  if (stopping) return;
  const executable = requireDesktop("electron");
  const child = spawn(
    executable,
    [
      `--inspect=127.0.0.1:${inspectorPorts.main}`,
      `--remote-debugging-port=${inspectorPorts.renderer}`,
      "--remote-debugging-address=127.0.0.1",
      desktop,
    ],
    {
      cwd: root,
      detached: true,
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "development",
        GRIMOIRE_DESKTOP_DEV: "1",
        GRIMOIRE_DESKTOP_USER_DATA: dataDir,
        GRIMOIRE_DESKTOP_DEV_URL: webUrl,
        GRIMOIRE_DESKTOP_AGENT_ENTRY: join(output, "desktop.js"),
        GRIMOIRE_DESKTOP_AGENT_PORT: String(apiPort),
        GRIMOIRE_DESKTOP_AGENT_INSPECT_PORT: String(inspectorPorts.agent),
      },
    },
  );
  electron = child;
  child.once("error", (error) => {
    console.error(error);
    void shutdown(1);
  });
  child.once("exit", (code) => {
    if (!stopping && expectedExit !== child) void shutdown(code ?? 1);
  });
  const deadline = Date.now() + 30_000;
  while (!stopping && Date.now() < deadline) {
    try {
      const state = JSON.parse(await readFile(statePath, "utf8"));
      if (state.pid === child.pid) return;
    } catch {}
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error("Electron stopped before it became ready.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!stopping)
    throw new Error(
      "Electron startup timed out. Check the development profile's desktop.log.",
    );
}

function checkDesktopSyntax() {
  for (const file of readdirSync(join(desktop, "src")).filter((name) =>
    name.endsWith(".cjs"),
  ))
    execFileSync(process.execPath, ["--check", join(desktop, "src", file)], {
      stdio: ["ignore", "ignore", "pipe"],
    });
}

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  clearTimeout(buildTimer);
  clearTimeout(restartTimer);
  for (const watcher of watchers) watcher.close();
  await stopElectron();
  await builds;
  await vite?.close();
  process.exit(code);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
process.once("uncaughtException", (error) => {
  console.error(error);
  void shutdown(1);
});
process.once("unhandledRejection", (error) => {
  console.error(error);
  void shutdown(1);
});

try {
  console.log("[desktop-dev] Starting Grimoire development services...");
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new Error(
      "Desktop development currently supports Apple Silicon Macs only.",
    );
  if (new Set(Object.values(inspectorPorts)).size !== 3)
    throw new Error("The three debugger ports must be different.");
  for (const value of Object.values(inspectorPorts)) await reservePort(value);
  const apiPort = await reservePort();
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const { build } = await import(requireAgent.resolve("tsup"));
  const buildAgent = () =>
    build({
      config: false,
      entry: { desktop: join(agent, "src/desktop.ts") },
      tsconfig: join(agent, "tsconfig.json"),
      outDir: output,
      format: ["esm"],
      target: "node24",
      platform: "node",
      noExternal: ["@grimoire/core"],
      external: Object.keys(requireAgent("./package.json").dependencies).filter(
        (name) => name !== "@grimoire/core",
      ),
      splitting: false,
      clean: false,
      sourcemap: true,
    });
  const queueBuild = () => {
    clearTimeout(buildTimer);
    buildTimer = setTimeout(() => {
      builds = builds
        .then(() => (stopping ? undefined : buildAgent()))
        .catch((error) => {
          console.error(
            "[desktop-dev] Agent build failed; the previous service is still running.",
            error.message,
          );
        });
    }, 150);
  };
  for (const directory of [
    join(agent, "src"),
    join(root, "packages/grimoire-core/src"),
  ])
    watchers.push(watch(directory, { recursive: true }, queueBuild));
  await buildAgent();
  const { createServer } = await import(requireWeb.resolve("vite"));
  vite = await createServer({
    root: web,
    configFile: join(web, "vite.config.ts"),
    mode: "development",
    server: {
      host: "127.0.0.1",
      port: 5180,
      strictPort: false,
      proxy: {
        "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false },
      },
    },
  });
  await vite.listen();
  const webUrl = vite.resolvedUrls.local[0];
  checkDesktopSyntax();
  await startElectron(apiPort, webUrl);
  watchers.push(
    watch(join(desktop, "src"), { recursive: true }, (_event, filename) => {
      if (!filename?.endsWith(".cjs")) return;
      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        restarts = restarts
          .then(async () => {
            if (stopping) return;
            try {
              checkDesktopSyntax();
            } catch (error) {
              console.error(
                "[desktop-dev] Desktop syntax check failed; the previous window is still running.",
                error.stderr?.toString() || error.message,
              );
              return;
            }
            console.log(
              "[desktop-dev] Restarting Electron after main/preload change...",
            );
            await stopElectron();
            await startElectron(apiPort, webUrl);
          })
          .catch((error) => {
            console.error(error);
            void shutdown(1);
          });
      }, 200);
    }),
  );
  console.log(`[desktop-dev] Ready: ${webUrl}`);
  console.log(
    `[desktop-dev] API: http://127.0.0.1:${apiPort}; main: ${inspectorPorts.main}; Pi: ${inspectorPorts.agent}; renderer: ${inspectorPorts.renderer}`,
  );
  console.log(
    `[desktop-dev] Data: ${dataDir}; press Ctrl+C to stop all services.`,
  );
} catch (error) {
  console.error("[desktop-dev]", error);
  await shutdown(1);
}
