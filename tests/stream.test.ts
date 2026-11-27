import { describe, expect, it } from "vitest";
import {
  readAgentStream,
  type AgentStreamEvent,
} from "../packages/grimoire-core/src/index";

function streamFrom(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });
}

describe("SSE transport", () => {
  it("preserves Chinese characters split across byte boundaries", async () => {
    const payload = new TextEncoder().encode(
      'data: {"type":"text-delta","delta":"你好"}\n\ndata: {"type":"done"}\n\n',
    );
    const events: AgentStreamEvent[] = [];
    for await (const event of readAgentStream(
      streamFrom([...payload].map((byte) => new Uint8Array([byte]))),
    ))
      events.push(event);
    expect(events).toEqual([
      { type: "text-delta", delta: "你好" },
      { type: "done" },
    ]);
  });

  it("rejects a truncated stream instead of reporting success", async () => {
    const read = async () => {
      const body = streamFrom([
        new TextEncoder().encode(
          'data: {"type":"text-delta","delta":"partial"}\n\n',
        ),
      ]);
      for await (const _event of readAgentStream(body)) {
        /* Consume the stream. */
      }
    };
    await expect(read()).rejects.toThrow("STREAM_INTERRUPTED");
  });
});
