import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const {
  browserPartition,
  createBrowserData,
} = require("../apps/grimoire-desktop/src/browser-data.cjs");
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "grimoire-browser-data-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const native = () => ({
    clearCache: vi.fn(async () => {}),
    clearCodeCaches: vi.fn(async () => {}),
    clearStorageData: vi.fn(async () => {}),
    clearAuthCache: vi.fn(async () => {}),
    closeAllConnections: vi.fn(async () => {}),
  });
  const entries = new Map<string, ReturnType<typeof native>>();
  const session = {
    defaultSession: native(),
    fromPartition: vi.fn((name: string) => {
      if (!entries.has(name)) entries.set(name, native());
      return entries.get(name)!;
    }),
  };
  const data = createBrowserData({ session, dataPath: root });
  const get = (name: string) => session.fromPartition(`persist:${name}`);
  return { session, data, get };
}
const a = { workspace: "/project", threadId: "a" };
const b = { workspace: "/project", threadId: "b" };
it("clears HTTP and generated code caches without touching cookies or website storage, including inactive partitions", async () => {
  const { data, session, get } = fixture();
  const one = browserPartition(a),
    two = browserPartition(b);
  data.register(one, a);
  mkdirSync(join(root, "Partitions", two), { recursive: true });
  await data.clearCache();
  for (const entry of [session.defaultSession, get(one), get(two)]) {
    expect(entry.clearCache).toHaveBeenCalledOnce();
    expect(entry.clearCodeCaches).toHaveBeenCalledWith({ urls: [] });
    expect(entry.clearStorageData).not.toHaveBeenCalled();
    expect(entry.clearAuthCache).not.toHaveBeenCalled();
    expect(entry.closeAllConnections).not.toHaveBeenCalled();
  }
});
it("remembers promoted draft partitions and both certificate variants after reopening the index", async () => {
  const { data, session, get } = fixture();
  const draft = { workspace: a.workspace, threadId: null };
  const one = browserPartition(draft),
    two = browserPartition(b);
  data.register(one, draft);
  data.register(`${one}-unverified`, draft);
  data.rebind(one, a);
  data.register(two, b);
  const reopened = createBrowserData({ session, dataPath: root });
  expect(reopened.partition(a)).toBe(one);
  expect(reopened.partition(b)).toBe(two);
  await reopened.clear(a);
  for (const name of [one, `${one}-unverified`]) {
    expect(get(name).clearStorageData).toHaveBeenCalledWith();
    expect(get(name).clearAuthCache).toHaveBeenCalledOnce();
  }
  expect(get(two).clearStorageData).not.toHaveBeenCalled();
  expect(session.defaultSession.clearStorageData).not.toHaveBeenCalled();
  const saved = JSON.parse(
    readFileSync(join(root, "browser-data.json"), "utf8"),
  );
  expect(Object.keys(saved.partitions)).toEqual([two]);
});
it("clears a legacy deterministic partition but retains a draft whose owner is unknown", async () => {
  const { data, get } = fixture();
  const legacy = browserPartition(a),
    orphan = browserPartition({ workspace: a.workspace, threadId: null });
  for (const name of [legacy, `${legacy}-unverified`, orphan])
    mkdirSync(join(root, "Partitions", name), { recursive: true });
  await data.clear(a);
  expect(get(legacy).clearStorageData).toHaveBeenCalledOnce();
  expect(get(`${legacy}-unverified`).clearStorageData).toHaveBeenCalledOnce();
  expect(get(orphan).clearStorageData).not.toHaveBeenCalled();
});
it("preserves the index after cleanup failure and allows retry", async () => {
  const { data, get } = fixture();
  const name = browserPartition(a);
  data.register(name, a);
  get(name).clearStorageData.mockRejectedValueOnce(new Error("busy"));
  await expect(data.clear(a)).rejects.toThrow("Could not clear");
  expect(
    JSON.parse(readFileSync(join(root, "browser-data.json"), "utf8"))
      .partitions[name],
  ).toEqual(a);
  await data.clear(a);
  expect(
    JSON.parse(readFileSync(join(root, "browser-data.json"), "utf8"))
      .partitions,
  ).toEqual({});
});
it("clears only the selected workspace and forbids stealing another chat's partition", async () => {
  const { data, get } = fixture();
  const one = browserPartition(a),
    other = { workspace: "/other", threadId: "a" },
    two = browserPartition(other);
  data.register(one, a);
  data.register(two, other);
  expect(() => data.register(one, b)).toThrow("owning chat");
  await data.clear({ workspace: a.workspace });
  expect(get(one).clearStorageData).toHaveBeenCalledOnce();
  expect(get(two).clearStorageData).not.toHaveBeenCalled();
});
it("reports partial cache failures instead of claiming success and remains retryable", async () => {
  const { data, session } = fixture();
  session.defaultSession.clearCache.mockRejectedValueOnce(new Error("busy"));
  await expect(data.clearCache()).rejects.toThrow("Could not clear every");
  await data.clearCache();
  expect(session.defaultSession.clearCache).toHaveBeenCalledTimes(2);
});

it("clears unindexed legacy project chats in one cleanup while preserving another project's data", async () => {
  const { data, get } = fixture();
  const one = browserPartition(a),
    two = browserPartition(b);
  const other = browserPartition({ workspace: "/other", threadId: a.threadId });
  for (const name of [one, `${one}-unverified`, two, other])
    mkdirSync(join(root, "Partitions", name), { recursive: true });
  await data.clear({
    workspace: a.workspace,
    threadIds: [a.threadId, b.threadId],
  });
  for (const name of [one, `${one}-unverified`, two])
    expect(get(name).clearStorageData).toHaveBeenCalledOnce();
  expect(get(other).clearStorageData).not.toHaveBeenCalled();
});
