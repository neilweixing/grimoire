import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve, isAbsolute, sep } from "node:path";
import { tmpdir, homedir } from "node:os";
import { realpathSync } from "node:fs";
import { MAX_ATTACHMENT_BYTES, type LocalAttachment } from "@grimoire/core";
import { PolicyError } from "./permissions.js";

function physicalPath(path: string): string {
  let current = resolve(path);
  const rest: string[] = [];
  while (true) {
    try {
      return resolve(realpathSync(current), ...rest);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = resolve(current, "..");
      if (parent === current) throw error;
      rest.unshift(basename(current));
      current = parent;
    }
  }
}

export class AttachmentStore {
  readonly directory: string;
  constructor(dataDir: string, workspace: string) {
    const root = physicalPath(workspace);
    const key = createHash("sha256")
      .update(physicalPath(dataDir))
      .digest("hex")
      .slice(0, 24);
    const candidates = [
      resolve(dataDir, "attachments"),
      join(tmpdir(), "grimoire-attachments", key),
      join(homedir(), ".grimoire", "attachments", key),
    ].map(physicalPath);
    const outside = candidates.find((candidate) => {
      const local = relative(root, candidate);
      return (
        local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)
      );
    });
    if (!outside)
      throw new PolicyError(
        "Select a narrower project folder to keep attachments outside source files.",
      );
    this.directory = outside;
  }
  async save(
    name: string,
    data: Uint8Array,
    contentType: string,
  ): Promise<LocalAttachment> {
    if (data.byteLength > MAX_ATTACHMENT_BYTES)
      throw new PolicyError("Attachment exceeds the 8 MiB limit.");
    if (!name || name.length > 512 || contentType.length > 200)
      throw new PolicyError("Invalid attachment metadata.");
    const id = randomUUID();
    const filename = basename(name.replaceAll("\\", "/")).replace(
      /[\x00-\x1f<>:"|?*]/g,
      "_",
    );
    const folder = join(this.directory, id);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const path = join(
      folder,
      filename && filename !== "." && filename !== ".."
        ? filename
        : "attachment",
    );
    await writeFile(path, data, { flag: "wx", mode: 0o600 });
    return { id, name, path, contentType, size: data.byteLength };
  }
}
