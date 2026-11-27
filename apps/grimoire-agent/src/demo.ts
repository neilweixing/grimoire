import { setTimeout as delay } from "node:timers/promises";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Model,
} from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";

export const zeroUsage = () => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

export function assistantMessage(model: Model<Api>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: zeroUsage(),
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

export const demoModel: Model<"openai-completions"> = {
  id: "grimoire-demo",
  name: "Grimoire 演示",
  api: "openai-completions",
  provider: "demo",
  baseUrl: "http://localhost",
  reasoning: false,
  input: ["text"],
  contextWindow: 128000,
  maxTokens: 8192,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

// Exercise Pi's actual tool loop even when no model credentials are configured.
export const createDemoStream =
  (
    locale: "zh" | "en",
  ): ((...args: Parameters<StreamFn>) => AssistantMessageEventStream) =>
  (model, context, options) => {
    const stream = createAssistantMessageEventStream();
    const message = assistantMessage(model);
    void (async () => {
      try {
        options?.signal?.throwIfAborted();
        stream.push({ type: "start", partial: message });
        const last = context.messages.at(-1);
        if (last?.role !== "toolResult") {
          const user = [...context.messages]
            .reverse()
            .find((m) => m.role === "user");
          const prompt =
            user?.role === "user" ? JSON.stringify(user.content) : "";
          const toolCall = {
            type: "toolCall" as const,
            id: crypto.randomUUID(),
            name: "inspect_dataset",
            arguments: {
              dataset: /customer|客户/i.test(prompt) ? "customers" : "orders",
            },
          };
          message.content.push(toolCall);
          message.stopReason = "toolUse";
          stream.push({
            type: "toolcall_start",
            contentIndex: 0,
            partial: message,
          });
          stream.push({
            type: "toolcall_end",
            contentIndex: 0,
            toolCall,
            partial: message,
          });
        } else {
          const raw = last.content.find((p) => p.type === "text");
          const data = JSON.parse(raw?.type === "text" ? raw.text : "{}") as {
            dataset: string;
            columns: string[];
            rows: Record<string, string | number>[];
          };
          const table = [
            `| ${data.columns.join(" | ")} |`,
            `| ${data.columns.map(() => "---").join(" | ")} |`,
            ...data.rows.map(
              (row) => `| ${data.columns.map((key) => row[key]).join(" | ")} |`,
            ),
          ].join("\n");
          const total = data.rows.reduce(
            (sum, row) =>
              sum + (row.status === "paid" ? Number(row.amount || 0) : 0),
            0,
          );
          const text =
            locale === "en"
              ? `The tool loaded **${data.dataset}**, a fictional dataset with **${data.rows.length} records**.\n\n${table}\n\n${data.dataset === "orders" ? `Total paid order revenue: **¥${total.toLocaleString("en-US")}**.\n\n` : ""}This is a scripted demo using fictional data. Configure and activate a model in **Settings → Providers** to ask questions, write SQL, or analyze data with a real model.`
              : `已通过工具读取 **${data.dataset}** 演示数据，共 **${data.rows.length} 条记录**。\n\n${table}\n\n${data.dataset === "orders" ? `已支付订单金额合计 **¥${total.toLocaleString("zh-CN")}**。\n\n` : ""}这些是内置的虚构数据。当前为演示模式，回复由固定逻辑生成。你可以在 **设置 → 供应商** 中配置并启用真实模型，继续提问、编写 SQL 或分析数据。`;
          const part = { type: "text" as const, text: "" };
          message.content.push(part);
          stream.push({
            type: "text_start",
            contentIndex: 0,
            partial: message,
          });
          for (const delta of text.match(/.{1,12}|\n/gu) ?? []) {
            await delay(18, undefined, { signal: options?.signal });
            part.text += delta;
            stream.push({
              type: "text_delta",
              contentIndex: 0,
              delta,
              partial: message,
            });
          }
          stream.push({
            type: "text_end",
            contentIndex: 0,
            content: text,
            partial: message,
          });
        }
        stream.push({
          type: "done",
          reason: message.stopReason as "stop" | "toolUse",
          message,
        });
      } catch (error) {
        message.stopReason = options?.signal?.aborted ? "aborted" : "error";
        message.errorMessage =
          error instanceof Error ? error.message : "演示运行失败";
        stream.push({
          type: "error",
          reason: message.stopReason,
          error: message,
        });
      } finally {
        stream.end();
      }
    })();
    return stream;
  };
