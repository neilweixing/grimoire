import { afterEach, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
  stat,
  rename,
  symlink,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const {
  createLocalMacInstaller,
  verifyArchive,
  validateLinks,
  waitForLocalUpdate,
} = require("../apps/grimoire-desktop/src/macos-update.cjs");
const {
  treeDigest,
  replaceBundle,
  writeResult,
} = require("../apps/grimoire-desktop/src/macos-update-helper.cjs");
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function directory() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "grimoire-mac-update-test-")),
  );
  roots.push(root);
  return root;
}
async function bundle(
  path: string,
  version: string,
  id = "io.grimoire.desktop",
  arch = 0x100000c,
) {
  await mkdir(join(path, "Contents/MacOS"), { recursive: true });
  await writeFile(
    join(path, "Contents/Info.plist"),
    `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleExecutable</key><string>Grimoire</string></dict></plist>`,
  );
  // A minimal Mach-O header is sufficient for lipo; the fixture is never executed.
  const executable = Buffer.alloc(32);
  executable.writeUInt32LE(0xfeedfacf, 0);
  executable.writeUInt32LE(arch, 4);
  executable.writeUInt32LE(2, 12);
  await writeFile(join(path, "Contents/MacOS/Grimoire"), executable, {
    mode: 0o755,
  });
}
async function zipBundle(
  root: string,
  version = "0.1.3",
  id?: string,
  arch?: number,
) {
  const source = join(root, "source/Grimoire.app");
  await bundle(source, version, id, arch);
  const archive = join(root, "update.zip");
  await execute("/usr/bin/ditto", [
    "-c",
    "-k",
    "--sequesterRsrc",
    "--keepParent",
    source,
    archive,
  ]);
  return {
    archive,
    checksum: createHash("sha512")
      .update(await readFile(archive))
      .digest("base64"),
  };
}
function appFixture(root: string, version = "0.1.2") {
  return {
    getAppPath: () => join(root, "Grimoire.app/Contents/Resources/app.asar"),
    getPath: () => join(root, "profile"),
    getVersion: () => version,
  };
}
async function installation() {
  const root = await directory();
  await bundle(join(root, "Grimoire.app"), "0.1.2");
  await mkdir(join(root, "profile"));
  return { root, app: appFixture(root), ...(await zipBundle(root)) };
}
// Only central-directory metadata is needed for these preflight rejection fixtures.
function unsafeZip(
  entries: Array<{ name: string; type?: number; size?: number }>,
) {
  const central = entries.map(({ name, type = 0o100644, size = 0 }) => {
    const bytes = Buffer.from(name);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50);
    header.writeUInt16LE(0x0314, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x800, 8);
    header.writeUInt32LE(size, 20);
    header.writeUInt32LE(size, 24);
    header.writeUInt16LE(bytes.length, 28);
    header.writeUInt32LE((type << 16) >>> 0, 38);
    return Buffer.concat([header, bytes]);
  });
  const body = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(body.length, 12);
  return Buffer.concat([body, end]);
}
it.each([
  [{ name: "../outside" }],
  [{ name: "Grimoire.app/a/../../outside" }],
  [{ name: "Other.app/Contents/Info.plist" }],
  [
    { name: "Grimoire.app/link", type: 0o120777 },
    { name: "Grimoire.app/link/escape" },
  ],
  [{ name: "Grimoire.app/A" }, { name: "Grimoire.app/a" }],
  [{ name: "Grimoire.app/device", type: 0o020600 }],
  [{ name: "Grimoire.app/huge", size: 0xffffffff }],
])(
  "rejects unsafe archive metadata before extraction: %j",
  async (...entries) => {
    const file = join(await directory(), "unsafe.zip");
    const bytes = unsafeZip(entries);
    await writeFile(file, bytes);
    await expect(
      verifyArchive(file, createHash("sha512").update(bytes).digest("base64")),
    ).rejects.toThrow();
  },
);
it("rejects a checksum mismatch", async () => {
  const file = join(await directory(), "bad.zip");
  await writeFile(file, "corrupt");
  await expect(
    verifyArchive(file, Buffer.alloc(64).toString("base64")),
  ).rejects.toThrow("checksum mismatch");
});
it("rejects external bundle symlinks while retaining internal framework links", async () => {
  const root = await directory();
  const app = join(root, "Grimoire.app");
  await mkdir(join(app, "Framework/Versions/A"), { recursive: true });
  await symlink("A", join(app, "Framework/Versions/Current"));
  await validateLinks(app);
  await symlink(root, join(app, "escape"));
  await expect(validateLinks(app)).rejects.toThrow("external symlink");
});
it("restores the original bundle if the staged rename fails", async () => {
  const root = await directory();
  const target = join(root, "Grimoire.app");
  const staging = join(root, ".grimoire-update-fixture");
  const candidate = join(staging, "payload/Grimoire.app");
  await bundle(target, "0.1.2");
  await bundle(candidate, "0.1.3");
  const original = await stat(target);
  const plan = {
    root: staging,
    target,
    candidate,
    backup: join(staging, "previous.app"),
    parentPid: process.pid,
    device: original.dev,
    inode: original.ino,
    digest: await treeDigest(candidate),
  };
  let attempts = 0;
  await expect(
    replaceBundle(plan, async (from: string, to: string) => {
      if (++attempts === 2) throw new Error("simulated rename failure");
      await rename(from, to);
    }),
  ).rejects.toThrow("simulated rename failure");
  expect(await readFile(join(target, "Contents/Info.plist"), "utf8")).toContain(
    "0.1.2",
  );
  expect(
    await readFile(join(candidate, "Contents/Info.plist"), "utf8"),
  ).toContain("0.1.3");
});
it("rejects changes to staged files and to the installed bundle before touching the original", async () => {
  const root = await directory();
  const target = join(root, "Grimoire.app");
  const staging = join(root, ".grimoire-update-fixture");
  const candidate = join(staging, "payload/Grimoire.app");
  await bundle(target, "0.1.2");
  await bundle(candidate, "0.1.3");
  const original = await stat(target);
  const plan = {
    root: staging,
    target,
    candidate,
    backup: join(staging, "previous.app"),
    parentPid: process.pid,
    device: original.dev,
    inode: original.ino,
    digest: await treeDigest(candidate),
  };
  await writeFile(join(candidate, "injected"), "changed");
  await expect(replaceBundle(plan)).rejects.toThrow("changed after validation");
  plan.digest = await treeDigest(candidate);
  await rename(target, join(root, "moved.app"));
  await bundle(target, "0.1.4");
  await expect(replaceBundle(plan)).rejects.toThrow("replaced while");
  expect(await readFile(join(target, "Contents/Info.plist"), "utf8")).toContain(
    "0.1.4",
  );
});

const macTest = process.platform === "darwin" ? it : it.skip;
macTest.each([
  ["0.1.4", "io.grimoire.desktop", 0x100000c],
  ["0.1.3", "other.application", 0x100000c],
  ["0.1.3", "io.grimoire.desktop", 0x1000007],
])(
  "rejects an incompatible bundle (%s, %s, %s) and cleans staging",
  async (version, id, arch) => {
    const { root, app } = await installation();
    const { archive, checksum } = await zipBundle(root, version, id, arch);
    const installer = createLocalMacInstaller({ app });
    await expect(
      installer.prepare(archive, "0.1.3", checksum),
    ).rejects.toThrow();
    expect(
      (await readdir(root)).filter((name) =>
        name.startsWith(".grimoire-update-"),
      ),
    ).toEqual([]);
    expect(
      await readFile(join(root, "Grimoire.app/Contents/Info.plist"), "utf8"),
    ).toContain("0.1.2");
  },
);
macTest(
  "cleans private staging and preserves the installation on a failed checksum",
  async () => {
    const { root, app, archive } = await installation();
    await expect(
      createLocalMacInstaller({ app }).prepare(
        archive,
        "0.1.3",
        Buffer.alloc(64).toString("base64"),
      ),
    ).rejects.toThrow("checksum mismatch");
    expect(
      (await readdir(root)).filter((name) =>
        name.startsWith(".grimoire-update-"),
      ),
    ).toEqual([]);
  },
);
macTest(
  "waits for the real Electron host to exit, replaces locally, then cleans its backup on next launch",
  async () => {
    const { root, archive, checksum } = await installation();
    const runner = join(root, "host.cjs");
    const module = resolve("apps/grimoire-desktop/src/macos-update.cjs");
    await writeFile(
      runner,
      `
    const {createLocalMacInstaller} = require(${JSON.stringify(module)});
    const app = {getAppPath:()=>${JSON.stringify(join(root, "Grimoire.app/Contents/Resources/app.asar"))},getPath:()=>${JSON.stringify(join(root, "profile"))},getVersion:()=>"0.1.2"};
    (async()=>{const installer=createLocalMacInstaller({app});await installer.prepare(${JSON.stringify(archive)},"0.1.3",${JSON.stringify(checksum)});await installer.installOnQuit();process.stdout.write("ARMED\\n");process.stdin.once("data",()=>process.exit(0));process.stdin.resume();})().catch(e=>{console.error(e);process.exit(1)});
  `,
    );
    const electron = require("../apps/grimoire-desktop/node_modules/electron");
    const host = spawn(electron, [runner], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let errors = "";
    host.stderr.on("data", (data) => {
      errors += data;
    });
    try {
      await new Promise<void>((resolvePromise, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`Host timeout: ${errors}`)),
          15000,
        );
        host.stdout.on("data", (data) => {
          if (String(data).includes("ARMED")) {
            clearTimeout(timeout);
            resolvePromise();
          }
        });
        host.once("exit", (code) => {
          clearTimeout(timeout);
          reject(new Error(`Host exited ${code}: ${errors}`));
        });
      });
      const target = join(root, "Grimoire.app");
      expect(
        await readFile(join(target, "Contents/Info.plist"), "utf8"),
      ).toContain("0.1.2");
      host.stdin.write("quit");
      const resultFile = join(root, "profile/updates/result.json");
      await vi.waitFor(
        async () =>
          expect(JSON.parse(await readFile(resultFile, "utf8")).status).toBe(
            "installed",
          ),
        { timeout: 10000 },
      );
      expect(
        await readFile(join(target, "Contents/Info.plist"), "utf8"),
      ).toContain("0.1.3");
      const result = JSON.parse(await readFile(resultFile, "utf8"));
      expect(
        await readFile(
          join(result.root, "previous.app/Contents/Info.plist"),
          "utf8",
        ),
      ).toContain("0.1.2");
      await createLocalMacInstaller({
        app: appFixture(root, "0.1.3"),
      }).recover();
      await expect(stat(result.root)).rejects.toThrow();
      await expect(stat(resultFile)).rejects.toThrow();
    } finally {
      host.kill();
    }
  },
  30000,
);

it("waits for an update in progress before allowing a rapid restart", async () => {
  const root = await directory();
  const target = join(root, "Grimoire.app");
  await mkdir(join(root, "updates"));
  const file = join(root, "updates/result.json");
  await writeResult(file, { status: "installing", target, helperPid: 123 });
  const waiting = waitForLocalUpdate(root, target, { isAlive: () => true });
  const timer = setTimeout(() => {
    void writeResult(file, { status: "installed", target });
  }, 20);
  try {
    expect(await waiting).toBe(true);
  } finally {
    clearTimeout(timer);
  }
  expect(await waitForLocalUpdate(root, target)).toBe(false);
});
it("marks an interrupted helper as failed so the installed app can start and retry", async () => {
  const root = await directory();
  const target = join(root, "Grimoire.app");
  await mkdir(join(root, "updates"));
  const file = join(root, "updates/result.json");
  await writeResult(file, {
    status: "installing",
    target,
    helperPid: 123,
    version: "0.1.3",
  });
  expect(await waitForLocalUpdate(root, target, { isAlive: () => false })).toBe(
    false,
  );
  expect(JSON.parse(await readFile(file, "utf8")).status).toBe("failed");
});
it("does not start services if an update helper is still active past the startup deadline", async () => {
  const root = await directory();
  const target = join(root, "Grimoire.app");
  await mkdir(join(root, "updates"));
  await writeResult(join(root, "updates/result.json"), {
    status: "installing",
    target,
    helperPid: 123,
  });
  await expect(
    waitForLocalUpdate(root, target, { isAlive: () => true, timeout: 0 }),
  ).rejects.toThrow("update is still running");
});

it("honors a completed result published just before the helper PID disappears", async () => {
  const root = await directory();
  const target = join(root, "Grimoire.app");
  await mkdir(join(root, "updates"));
  const file = join(root, "updates/result.json");
  await writeResult(file, { status: "installing", target, helperPid: 123 });
  expect(
    await waitForLocalUpdate(root, target, {
      isAlive: () => {
        writeFileSync(file, JSON.stringify({ status: "installed", target }));
        return false;
      },
    }),
  ).toBe(true);
  expect(JSON.parse(await readFile(file, "utf8")).status).toBe("installed");
});
