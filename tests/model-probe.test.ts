import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, expect, it } from "vitest";
import { probeModel } from "../apps/grimoire-agent/src/model-probe";
import { createApp } from "../apps/grimoire-agent/src/app";
import { SettingsStore } from "../apps/grimoire-agent/src/settings";
import type { StoredProvider } from "../apps/grimoire-agent/src/settings";
let server: Server;
let provider: StoredProvider;
let directory: string;
let status = 200;
let requests: { body: any; authorization?: string }[];
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "grimoire-probe-"));
  requests = [];
  status = 200;
  server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({ body, authorization: request.headers.authorization });
    const code =
      status !== 200 ? status : body.reasoning_effort === "medium" ? 400 : 200;
    if (code !== 200) {
      response.writeHead(code, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          error: {
            message: "Unsupported reasoning_effort fixture-secret",
            type: "invalid_request_error",
          },
        }),
      );
      return;
    }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const base = {
      id: "probe",
      object: "chat.completion.chunk",
      created: 1,
      model: "probe-model",
    };
    response.write(
      `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "45" }, finish_reason: null }] })}\n\n`,
    );
    response.write(
      `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 15, completion_tokens: 2, total_tokens: 17 } })}\n\n`,
    );
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  provider = {
    id: "fixture",
    name: "Fixture",
    kind: "openai-compatible",
    model: "probe-model",
    models: ["probe-model"],
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    apiKey: "fixture-secret",
    modelOverrides: {
      "probe-model": {
        thinkingLevels: ["off", "low", "medium", "max", "high", "xhigh"],
      },
    },
  };
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(directory, { recursive: true, force: true });
});
it("makes real Pi HTTP requests for all SDK candidates, preserves Max, and distinguishes explicit rejections", async () => {
  const result = await probeModel(provider);
  expect(requests.map((r) => r.body.reasoning_effort)).toEqual([
    undefined,
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]);
  expect(result.results.map((r) => [r.level, r.status, r.reason])).toEqual([
    ["off", "accepted", "accepted"],
    ["minimal", "accepted", "accepted"],
    ["low", "accepted", "accepted"],
    ["medium", "rejected", "invalidParameter"],
    ["high", "accepted", "accepted"],
    ["xhigh", "accepted", "accepted"],
    ["max", "accepted", "accepted"],
  ]);
  expect(result.results.find((r) => r.level === "max")?.parameter).toBe("max");
  expect(JSON.stringify(result)).not.toContain("fixture-secret");
  for (const { body } of requests) {
    expect(body.messages).toEqual([
      { role: "user", content: "What is 17 + 28? Reply with the number only." },
    ]);
    expect(body.tools).toBeUndefined();
    expect(body.max_completion_tokens ?? body.max_tokens).toBeLessThanOrEqual(
      2048,
    );
  }
});
it("stops after authentication failure without treating it as unsupported capability", async () => {
  status = 401;
  const result = await probeModel(provider);
  expect(requests).toHaveLength(1);
  expect(result.results[0]).toMatchObject({
    status: "inconclusive",
    reason: "authentication",
  });
  expect(result.results.slice(1).every((r) => r.reason === "notRun")).toBe(
    true,
  );
});
it("stops on rate limits without marking remaining levels as unsupported", async () => {
  status = 429;
  const result = await probeModel(provider);
  expect(requests).toHaveLength(1);
  expect(result.results[0]).toMatchObject({
    status: "inconclusive",
    reason: "rateLimited",
  });
  expect(result.results.slice(1).every((r) => r.reason === "notRun")).toBe(
    true,
  );
});
it("does not start a request after cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(probeModel(provider, controller.signal)).rejects.toThrow();
  expect(requests).toEqual([]);
});
it("reuses a saved key only for the same connection and never changes model settings", async () => {
  const settings = new SettingsStore(join(directory, "providers.json"));
  settings.save(
    {
      ...provider,
      modelOverrides: { "probe-model": { thinkingLevels: ["off"] } },
    },
    provider.id,
  );
  const before = settings.publicSettings();
  const app = createApp(settings);
  const request = (input: StoredProvider) =>
    app.request("/api/providers/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: provider.id,
        provider: {
          ...input,
          apiKey: "",
          modelOverrides: { "probe-model": { thinkingLevels: ["off"] } },
        },
      }),
    });
  const response = await request(provider);
  expect(response.status).toBe(200);
  expect(requests[0].authorization).toBe("Bearer fixture-secret");
  expect(await response.text()).not.toContain("fixture-secret");
  expect(settings.publicSettings()).toEqual(before);
  await request({ ...provider, baseUrl: provider.baseUrl + "/different" });
  expect(requests[7].authorization).not.toContain("fixture-secret");
});
