import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../apps/grimoire-web/src/api";

afterEach(() => vi.unstubAllGlobals());

describe("web API response handling", () => {
  it("accepts an empty successful DELETE response and preserves the workspace header", async () => {
    vi.stubGlobal("document", { documentElement: { lang: "en" } });
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      api<void>("/pi/threads/test", {
        method: "DELETE",
        headers: { "X-Grimoire-Workspace": "project-b" },
      }),
    ).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(
      "/api/pi/threads/test",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({
          "X-Grimoire-Workspace": "project-b",
        }),
      }),
    );
  });
  it("retains JSON payloads for ordinary successful responses", async () => {
    vi.stubGlobal("document", { documentElement: { lang: "zh-CN" } });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ id: "thread" })),
    );
    await expect(api("/pi/threads/test")).resolves.toEqual({ id: "thread" });
  });
  it("keeps a rejected deletion as an actionable error", async () => {
    vi.stubGlobal("document", { documentElement: { lang: "en" } });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: "Could not delete" }, { status: 409 }),
        ),
    );
    await expect(api("/pi/threads/test", { method: "DELETE" })).rejects.toThrow(
      "Could not delete",
    );
  });
});
