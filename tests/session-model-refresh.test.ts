import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createApp } from "../apps/grimoire-agent/src/app";
import { SettingsStore } from "../apps/grimoire-agent/src/settings";

let root: string;
let settings: SettingsStore;
let app: ReturnType<typeof createApp>;
let provider: Parameters<SettingsStore["save"]>[0];
let server: ReturnType<typeof createServer>;
let requests: Record<string, any>[];
let release: (() => void) | undefined;
let holdFirst = false;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "grimoire-session-model-"));
  mkdirSync(join(root, "workspace"));
  requests = [];
  server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push(JSON.parse(body));
    const index = requests.length;
    if (holdFirst && index === 1)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    if (response.destroyed) return;
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const base = {
      id: `fixture-${index}`,
      object: "chat.completion.chunk",
      created: 1,
      model: "model-a",
    };
    response.write(
      `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: `Answer ${index}` }, finish_reason: null }] })}\n\n`,
    );
    response.write(
      `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
    );
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  provider = {
    name: "Fixture",
    kind: "openai-compatible",
    model: "model-a",
    models: ["model-a"],
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    apiKey: "fixture-only",
    modelOverrides: {
      "model-a": {
        maxTokens: 1000,
        contextWindow: 10000,
        thinkingLevels: ["off", "low", "high"],
      },
    },
  };
  settings = new SettingsStore(join(root, "providers.json"));
  settings.save(provider, "fixture");
  settings.activate("fixture");
  app = createApp(settings, {
    workspace: join(root, "workspace"),
    dataDir: join(root, "data"),
    globalSkillRoot: join(root, "empty-global"),
  });
});
afterEach(async () => {
  release?.();
  release = undefined;
  holdFirst = false;
  await app.dispose();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});
const limit = (value?: Record<string, any>) =>
  value?.max_tokens ?? value?.max_completion_tokens;
const json = (value: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(value),
});
const snapshot = async (id: string) =>
  (await app.request(`/api/pi/threads/${id}`)).json();
const wait = async (check: () => Promise<boolean> | boolean) => {
  const end = Date.now() + 5000;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("Fixture did not settle");
    await new Promise((r) => setTimeout(r, 10));
  }
};
const create = async () =>
  (await (await app.request("/api/pi/threads", json({}))).json()).metadata
    .id as string;
const send = (id: string, content: string, streamingBehavior?: "followUp") =>
  app.request(
    `/api/pi/threads/${id}/messages`,
    json({
      input: { content, ...(streamingBehavior ? { streamingBehavior } : {}) },
    }),
  );
const saveCapabilities = () =>
  app.request("/api/providers/fixture", {
    ...json({
      ...provider,
      modelOverrides: {
        "model-a": {
          maxTokens: 200,
          contextWindow: 20000,
          thinkingLevels: ["off", "low", "high"],
        },
      },
    }),
    method: "PUT",
  });
it("applies saved capabilities to the next request in an existing chat while preserving history and thinking depth", async () => {
  const id = await create();
  expect(
    (
      await app.request(
        `/api/pi/threads/${id}/thinking`,
        json({ level: "high" }),
      )
    ).status,
  ).toBe(204);
  expect((await send(id, "First question")).status).toBe(204);
  await wait(async () => (await snapshot(id)).metadata.status === "idle");
  expect(limit(requests[0])).toBe(1000);
  expect((await saveCapabilities()).status).toBe(200);
  expect((await send(id, "Second question")).status).toBe(204);
  await wait(
    async () =>
      requests.length === 2 && (await snapshot(id)).metadata.status === "idle",
  );
  expect(limit(requests[1])).toBe(200);
  expect(requests[1]?.reasoning_effort).toBe("high");
  const current = await snapshot(id);
  expect(current.metadata.config.thinkingLevel).toBe("high");
  expect(current.metadata.contextUsage.contextWindow).toBe(20000);
  expect(JSON.stringify(current.messages)).toContain("First question");
  expect(JSON.stringify(current.messages)).toContain("Second question");
});
it("defers capability refresh during a run and keeps queued follow-ups intact", async () => {
  holdFirst = true;
  const id = await create();
  expect((await send(id, "First")).status).toBe(204);
  await wait(() => Boolean(release));
  expect((await saveCapabilities()).status).toBe(200);
  expect((await send(id, "Queued", "followUp")).status).toBe(204);
  expect((await snapshot(id)).metadata.status).toBe("running");
  release?.();
  await wait(
    async () =>
      requests.length === 2 && (await snapshot(id)).metadata.status === "idle",
  );
  expect(requests.map(limit)).toEqual([1000, 1000]);
  expect(JSON.stringify(requests[1])).toContain("Queued");
  expect((await send(id, "Next run")).status).toBe(204);
  await wait(
    async () =>
      requests.length === 3 && (await snapshot(id)).metadata.status === "idle",
  );
  expect(limit(requests[2])).toBe(200);
});

it("clamps the previous thinking depth through Pi when the saved model no longer supports it", async () => {
  const id = await create();
  expect(
    (
      await app.request(
        `/api/pi/threads/${id}/thinking`,
        json({ level: "high" }),
      )
    ).status,
  ).toBe(204);
  const saved = await app.request("/api/providers/fixture", {
    ...json({
      ...provider,
      modelOverrides: {
        "model-a": { maxTokens: 200, thinkingLevels: ["off", "low"] },
      },
    }),
    method: "PUT",
  });
  expect(saved.status).toBe(200);
  expect((await send(id, "Use the saved capabilities")).status).toBe(204);
  await wait(
    async () =>
      requests.length === 1 && (await snapshot(id)).metadata.status === "idle",
  );
  expect(requests[0]?.reasoning_effort).toBe("low");
  expect((await snapshot(id)).metadata.config.thinkingLevel).toBe("low");
});
