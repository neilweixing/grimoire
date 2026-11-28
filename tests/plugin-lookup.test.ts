import { afterEach, expect, it, vi } from "vitest";
import {
  lookupPlugin,
  normalizeNpmSource,
} from "../apps/grimoire-agent/src/plugin-lookup";

const metadata = {
  name: "@scope/pi-tools",
  "dist-tags": { latest: "2.0.0", next: "3.0.0-beta.1" },
  versions: Object.fromEntries(
    ["1.0.0", "1.2.0", "2.0.0", "3.0.0-beta.1"].map((version) => [
      version,
      { name: "@scope/pi-tools", version },
    ]),
  ),
};
afterEach(() => {
  vi.unstubAllGlobals();
});
const registry = (status = 200, body: unknown = metadata) => {
  const fetcher = vi
    .fn()
    .mockImplementation(
      async () => new Response(JSON.stringify(body), { status }),
    );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};
it("normalizes package names, npm sources and package URLs without accepting arbitrary endpoints", () => {
  expect(normalizeNpmSource(" @scope/pi-tools ")).toBe("npm:@scope/pi-tools");
  expect(normalizeNpmSource("npm:pi-tools@next")).toBe("npm:pi-tools@next");
  expect(
    normalizeNpmSource("https://www.npmjs.com/package/@scope/pi-tools/v/1.2.0"),
  ).toBe("npm:@scope/pi-tools@1.2.0");
  expect(normalizeNpmSource("https://npmjs.com/package/pi-tools/")).toBe(
    "npm:pi-tools",
  );
  for (const input of [
    "",
    "-test",
    "file:/tmp/plugin",
    "git:host/repo",
    "https://evil.test/package/x",
    "https://npmjs.com.evil.test/package/x",
    "https://npmjs.com:4433/package/x",
    "https://user:pass@npmjs.com/package/x",
    "https://npmjs.com/package/x?url=localhost",
    "https://npmjs.com/package/x/../../private",
    "pi-tools;echo x",
    "npm:foo@$(whoami)",
  ]) {
    expect(() => normalizeNpmSource(input)).toThrow();
  }
});
it("looks up metadata only and retains unpinned sources for Pi updates", async () => {
  const fetcher = registry();
  expect(
    await lookupPlugin("https://www.npmjs.com/package/@scope/pi-tools"),
  ).toEqual({
    found: true,
    source: "npm:@scope/pi-tools",
    name: metadata.name,
    version: "2.0.0",
  });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][0]).toBe(
    "https://registry.npmjs.org/%40scope%2Fpi-tools",
  );
  expect(fetcher.mock.calls[0][1].method).toBeUndefined();
});
it("resolves versions, tags and ranges without installation", async () => {
  registry();
  expect(await lookupPlugin("npm:@scope/pi-tools@^1.0.0")).toMatchObject({
    found: true,
    source: "npm:@scope/pi-tools@^1.0.0",
    version: "1.2.0",
  });
  expect(await lookupPlugin("@scope/pi-tools@next")).toMatchObject({
    found: true,
    version: "3.0.0-beta.1",
  });
  expect(await lookupPlugin("@scope/pi-tools@1.0.0")).toMatchObject({
    found: true,
    version: "1.0.0",
  });
  expect(await lookupPlugin("@scope/pi-tools@4.0.0")).toEqual({ found: false });
});
it("returns not found for missing packages and rejects unavailable or invalid metadata", async () => {
  registry(404);
  expect(await lookupPlugin("missing-package")).toEqual({ found: false });
  registry(503);
  await expect(lookupPlugin("@scope/pi-tools")).rejects.toThrow("unavailable");
  registry(200, { ...metadata, name: "different" });
  await expect(lookupPlugin("@scope/pi-tools")).rejects.toThrow("unexpected");
  registry(200, {
    ...metadata,
    versions: { "2.0.0": { name: metadata.name, version: "wrong" } },
  });
  await expect(lookupPlugin("@scope/pi-tools")).rejects.toThrow("invalid");
});
it("rejects invalid input before making a network request and propagates network failures", async () => {
  const fetcher = registry();
  await expect(lookupPlugin("http://127.0.0.1/private")).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockRejectedValueOnce(new Error("network timeout"));
  await expect(lookupPlugin("pi-tools")).rejects.toThrow("network timeout");
});
