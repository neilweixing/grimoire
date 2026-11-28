import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { createGrimoireAgent } from "../apps/grimoire-agent/src/agent";
import { RunMetricsCollector } from "../apps/grimoire-agent/src/metrics";

it.each(["off", "low", "medium", "high", "native"] as const)(
  "passes %s thinking depth through Pi's OpenAI-compatible adapter",
  async (selection) => {
    const native = selection === "native";
    const thinkingLevel = native ? "high" : selection;
    const model = native ? "deepseek-flash" : "test-model";
    let request: {
      path?: string;
      authorization?: string;
      body?: Record<string, unknown>;
    } = {};
    const server = createServer(async (incoming, response) => {
      let payload = "";
      for await (const chunk of incoming) payload += chunk.toString();
      request = {
        path: incoming.url,
        authorization: incoming.headers.authorization,
        body: JSON.parse(payload),
      };
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      const chunk = {
        id: "test-completion",
        object: "chat.completion.chunk",
        created: 1,
        model: "test-model",
      };
      response.write(
        `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: { role: "assistant", content: "Connected through Pi" }, finish_reason: null }] })}\n\n`,
      );
      response.write(
        `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
      );
      response.write(
        `data: ${JSON.stringify({ ...chunk, choices: [], usage: { prompt_tokens: 100, completion_tokens: 3, total_tokens: 103, prompt_tokens_details: { cached_tokens: 40 } } })}\n\n`,
      );
      response.end("data: [DONE]\n\n");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const port = (server.address() as AddressInfo).port;
      const metrics = new RunMetricsCollector("test-model", "local-test", 1000);
      const agent = createGrimoireAgent(
        {
          id: "local-test",
          name: "Local test",
          kind: native ? "native" : "openai-compatible",
          nativeProvider: native ? "deepseek" : undefined,
          model,
          baseUrl: `http://127.0.0.1:${port}/v1`,
          apiKey: "fixture-key",
          modelOverrides: {
            [model]: {
              thinkingLevels: ["off", "low", "medium", "high"],
              contextWindow: 8192,
              maxTokens: 1024,
              input: ["text", "image"],
            },
          },
        },
        "en",
        thinkingLevel,
        (event) => metrics.observeProviderEvent(event),
      );
      expect(agent.state.model).toMatchObject({
        contextWindow: 8192,
        maxTokens: 1024,
        input: ["text", "image"],
      });
      agent.subscribe((event) => {
        metrics.observe(event);
      });
      await agent.prompt("Hello");
      expect(request.path).toBe("/v1/chat/completions");
      expect(request.authorization).toBe("Bearer fixture-key");
      expect(request.body?.model).toBe(model);
      expect(request.body?.stream).toBe(true);
      expect(request.body?.reasoning_effort).toBe(
        thinkingLevel === "off" ? undefined : thinkingLevel,
      );
      expect(JSON.stringify(request.body?.tools)).toContain("inspect_dataset");
      expect(agent.state.messages.at(-1)).toMatchObject({
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: "Connected through Pi" }],
      });
      expect(metrics.snapshot()).toMatchObject({
        totalTokens: 103,
        inputTokens: 60,
        outputTokens: 3,
        cacheReadTokens: 40,
        usageComplete: true,
        cacheComplete: true,
        contextInputTokens: 100,
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);
