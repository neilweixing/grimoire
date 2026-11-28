import {
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join, relative, isAbsolute, sep } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../apps/grimoire-agent/src/app";
import { AttachmentStore } from "../apps/grimoire-agent/src/attachments";
import { PiService } from "../apps/grimoire-agent/src/pi-service";
import { SettingsStore } from "../apps/grimoire-agent/src/settings";
import { piRoutes } from "../apps/grimoire-agent/src/pi-routes";
import { localAttachmentAdapter } from "../apps/grimoire-web/src/local-attachments";
import {
  attachmentReference,
  splitAttachmentReferences,
  MAX_ATTACHMENT_BYTES,
} from "../packages/grimoire-core/src/index";
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "grimoire-attachments-test-"));
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(directory, { recursive: true, force: true });
});
const record = () => ({
  id: crypto.randomUUID(),
  name: "example.ts",
  path: join(directory, "saved.ts"),
  contentType: "text/plain",
  size: 4,
});

describe("draft attachments", () => {
  it("selects and removes a file without uploading or sending a prompt", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const adapter = localAttachmentAdapter("project", {
      tooLarge: "Too large",
      uploadFailed: "Upload failed",
    });
    const pending = await adapter.add({
      file: new File(["code"], "example.ts", { type: "text/plain" }),
    });
    expect(pending).toMatchObject({
      name: "example.ts",
      status: { type: "requires-action", reason: "composer-send" },
    });
    await adapter.remove(pending as never);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uploads only when Send resolves the attachment, scopes to its workspace, and reuses an accepted upload on retry", async () => {
    const saved = record();
    const fetch = vi.fn().mockResolvedValue(Response.json(saved));
    vi.stubGlobal("fetch", fetch);
    const adapter = localAttachmentAdapter("project-b", {
      tooLarge: "Too large",
      uploadFailed: "Upload failed",
    });
    const pending = await adapter.add({
      file: new File(["code"], "example.ts", { type: "text/plain" }),
    });
    const complete = await adapter.send(pending as never);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].headers["X-Grimoire-Workspace"]).toBe(
      "project-b",
    );
    expect(await fetch.mock.calls[0][1].body.get("file").text()).toBe("code");
    expect(complete.content).toEqual([
      { type: "text", text: attachmentReference(saved) },
    ]);
    await adapter.send(pending as never);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps oversized files as removable errors and rejects failed uploads", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("Unavailable", { status: 500 }));
    vi.stubGlobal("fetch", fetch);
    const adapter = localAttachmentAdapter("project", {
      tooLarge: "Too large",
      uploadFailed: "Upload failed",
    });
    const pending = await adapter.add({
      file: new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], "large.bin"),
    });
    expect(pending).toMatchObject({
      status: { type: "incomplete", reason: "error", message: "Too large" },
    });
    expect(fetch).not.toHaveBeenCalled();
    const valid = await adapter.add({ file: new File(["small"], "valid.txt") });
    await expect(adapter.send(valid as never)).rejects.toThrow("Upload failed");
  });
});
it("stages bytes outside the workspace and never follows an uploaded filename outside its own directory", async () => {
  const workspace = join(directory, "project");
  mkdirSync(workspace);
  const store = new AttachmentStore(join(directory, "data"), workspace);
  const saved = await store.save(
    "../../outside.txt",
    new TextEncoder().encode("content"),
    "text/plain",
  );
  expect(readFileSync(saved.path, "utf8")).toBe("content");
  const local = relative(store.directory, saved.path);
  expect(local.startsWith(`..${sep}`) || isAbsolute(local)).toBe(false);
  expect(existsSync(join(directory, "outside.txt"))).toBe(false);
  const inside = new AttachmentStore(join(workspace, ".data"), workspace);
  const second = await inside.save(
    "file.txt",
    new Uint8Array([1]),
    "text/plain",
  );
  expect(relative(workspace, second.path).startsWith(`..${sep}`)).toBe(true);
  rmSync(inside.directory, { recursive: true, force: true });
});
it("validates multipart uploads and rejects missing or oversized files", async () => {
  const store = new AttachmentStore(
    join(directory, "data"),
    join(directory, "project"),
  );
  const app = piRoutes(() => ({ attachments: store }) as PiService);
  const form = new FormData();
  form.set("file", new File(["hello"], "hello.txt", { type: "text/plain" }));
  const response = await app.request("/attachments", {
    method: "POST",
    body: form,
  });
  expect(response.status).toBe(201);
  expect(readFileSync((await response.json()).path, "utf8")).toBe("hello");
  expect(
    (
      await app.request("/attachments", {
        method: "POST",
        body: new FormData(),
      })
    ).status,
  ).toBe(400);
  const large = new FormData();
  large.set(
    "file",
    new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], "large.bin"),
  );
  expect(
    (await app.request("/attachments", { method: "POST", body: large })).status,
  ).toBe(413);
});
it("allows the attachment route to validate payloads above the normal API body limit", async () => {
  const app = createApp(new SettingsStore(join(directory, "providers.json")));
  const form = new FormData();
  form.set("file", "x".repeat(3 * 1024 * 1024));
  const response = await app.request("/api/pi/attachments", {
    method: "POST",
    body: form,
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Select a local file." });
  expect(
    (
      await app.request("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "x".repeat(3 * 1024 * 1024) }),
      })
    ).status,
  ).toBe(413);
});
it("keeps source text separate from file metadata, including hostile filenames and malformed markers", () => {
  const saved = { ...record(), name: "<tag>\nfile.txt" };
  const source = "Explain this file.\n";
  expect(
    splitAttachmentReferences(source + "\n\n" + attachmentReference(saved)),
  ).toEqual({ text: source, files: [saved] });
  const malformed = "<grimoire-file>{invalid}</grimoire-file>";
  expect(splitAttachmentReferences(malformed)).toEqual({
    text: malformed,
    files: [],
  });
});
it("lists enabled project and global Skills without starting a model run", async () => {
  const workspace = join(directory, "project");
  const global = join(directory, "global");
  for (const [base, name] of [
    [join(workspace, ".agents", "skills"), "project-skill"],
    [join(global, "skills"), "global-skill"],
  ]) {
    const folder = join(base, name);
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "SKILL.md"),
      `---\nname: ${name}\ndescription: Fixture skill\n---\nTask instructions.`,
    );
  }
  const service = new PiService(
    new SettingsStore(join(directory, "providers.json")),
    { workspace, dataDir: join(directory, "data"), globalSkillRoot: global },
  );
  try {
    const names = (await service.availableSkills()).map((skill) => skill.name);
    expect(names).toContain("project-skill");
    expect(names).toContain("global-skill");
    service.integrations.save({
      ...service.integrations.config(),
      disabledSkills: ["global-skill"],
    });
    expect(
      (await service.availableSkills()).map((skill) => skill.name),
    ).not.toContain("global-skill");
  } finally {
    await service.dispose();
  }
});
