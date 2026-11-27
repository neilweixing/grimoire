import { createRequire } from "node:module";
import { readFile, readdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const {
  parseUpdateInfo,
  getFileList,
} = require("electron-updater/out/providers/Provider");
const root = fileURLToPath(new URL("../../../", import.meta.url));
const release = join(root, "release");
const { version } = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const manifests = (await readdir(release)).filter((name) =>
  /^latest(?:-mac)?\.yml$/.test(name),
);
assert.ok(manifests.length, "No update manifests generated");
for (const name of manifests) {
  const info = parseUpdateInfo(
    await readFile(join(release, name), "utf8"),
    name,
    new URL(`https://example.invalid/${name}`),
  );
  assert.equal(info.version, version);
  const files = getFileList(info);
  assert.ok(
    files.some((file) =>
      file.url.endsWith(name === "latest-mac.yml" ? ".zip" : ".exe"),
    ),
    "Missing auto-update payload",
  );
  for (const file of files) {
    const filename = decodeURIComponent(file.url);
    assert.equal(
      filename,
      basename(filename),
      "Update payload must be a local filename",
    );
    const path = join(release, filename);
    assert.equal((await stat(path)).size, file.size);
    const hash = createHash("sha512");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    assert.equal(
      hash.digest("base64"),
      file.sha512,
      `Invalid payload checksum: ${filename}`,
    );
  }
  console.log(
    `Verified ${name}: version, payloads, sizes and SHA-512 checksums`,
  );
}
