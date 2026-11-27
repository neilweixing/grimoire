import {
  Agent,
  type AgentMessage,
  type StreamFn,
} from "@earendil-works/pi-agent-core";
import {
  getSupportedThinkingLevels,
  type Api,
  type Model,
  type AssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import { streamSimple as streamOpenAI } from "@earendil-works/pi-ai/api/openai-responses";
import { streamSimple as streamCompatible } from "@earendil-works/pi-ai/api/openai-completions";
import { streamSimple as streamAnthropic } from "@earendil-works/pi-ai/api/anthropic-messages";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import {
  thinkingLevelSchema,
  type ChatMessage,
  type ThinkingLevel,
} from "@grimoire/core";
import { assistantMessage, demoModel, createDemoStream } from "./demo.js";
import type { StoredProvider } from "./settings.js";
import { systemPrompt, tools } from "./tools.js";
import { errorMessage } from "./errors.js";

export function providerRuntime(
  provider?: StoredProvider,
  locale: "zh" | "en" = "zh",
  thinkingLevel: ThinkingLevel = "off",
  onProviderEvent?: (event: unknown) => void,
): {
  model: Model<Api>;
  streamFn: (...args: Parameters<StreamFn>) => AssistantMessageEventStream;
} {
  if (!provider)
    return { model: demoModel, streamFn: createDemoStream(locale) };
  if (provider.kind !== "openai-compatible" && !provider.apiKey)
    throw new Error(errorMessage(locale, "missingKey"));
  const catalog =
    provider.kind === "anthropic" ? anthropicProvider() : openaiProvider();
  const known = catalog.getModels().find((m) => m.id === provider.model);
  if (!modelThinkingLevels(provider).includes(thinkingLevel)) {
    throw new Error(errorMessage(locale, "unsupportedThinking"));
  }
  const api =
    provider.kind === "anthropic"
      ? "anthropic-messages"
      : provider.kind === "openai"
        ? "openai-responses"
        : "openai-completions";
  const model: Model<Api> = {
    ...(known ?? demoModel),
    id: provider.model,
    name: provider.model,
    provider: provider.id,
    api,
    reasoning: known?.reasoning ?? thinkingLevel !== "off",
    baseUrl:
      provider.baseUrl ||
      (provider.kind === "anthropic"
        ? "https://api.anthropic.com"
        : "https://api.openai.com/v1"),
  };
  const streamFn = (
    requestModel: Model<Api>,
    context: Parameters<StreamFn>[1],
    options: Parameters<StreamFn>[2],
  ) => {
    const authenticatedOptions = {
      ...options,
      apiKey: provider.apiKey || "local",
      onProviderStreamEvent: onProviderEvent ?? options?.onProviderStreamEvent,
    };
    if (api === "anthropic-messages")
      return streamAnthropic(
        requestModel as Model<"anthropic-messages">,
        context,
        authenticatedOptions,
      );
    if (api === "openai-responses")
      return streamOpenAI(
        requestModel as Model<"openai-responses">,
        context,
        authenticatedOptions,
      );
    return streamCompatible(
      requestModel as Model<"openai-completions">,
      context,
      authenticatedOptions,
    );
  };
  return { model, streamFn };
}

export function modelThinkingLevels(
  provider?: StoredProvider,
): ThinkingLevel[] {
  if (!provider) return ["off"];
  const catalog =
    provider.kind === "anthropic" ? anthropicProvider() : openaiProvider();
  const known = catalog
    .getModels()
    .find((model) => model.id === provider.model);
  if (!known) return ["off", "minimal", "low", "medium", "high"];
  const levels = getSupportedThinkingLevels(known);
  return thinkingLevelSchema.options.filter(
    (level) => level === "off" || levels.includes(level),
  );
}

export function modelContextWindow(provider?: StoredProvider): number | null {
  if (!provider) return null;
  if (provider.contextWindow) return provider.contextWindow;
  const catalog =
    provider.kind === "anthropic" ? anthropicProvider() : openaiProvider();
  return (
    catalog.getModels().find((model) => model.id === provider.model)
      ?.contextWindow ?? null
  );
}

export function toPiMessages(
  messages: ChatMessage[],
  model: Model<Api>,
): AgentMessage[] {
  const result: AgentMessage[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      result.push({
        role: "user",
        content: message.content.filter((p) => p.type === "text"),
        timestamp: Date.now(),
      });
      continue;
    }
    let assistant = assistantMessage(model);
    for (const part of message.content) {
      if (part.type === "text") {
        assistant.content.push(part);
        continue;
      }
      assistant.content.push({
        type: "toolCall",
        id: part.toolCallId,
        name: part.toolName,
        arguments: part.args,
      });
      assistant.stopReason = "toolUse";
      result.push(assistant, {
        role: "toolResult",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        content: [
          {
            type: "text",
            text: JSON.stringify(part.result ?? "工具执行已中断"),
          },
        ],
        isError: part.isError || part.result === undefined,
        timestamp: Date.now(),
      });
      assistant = assistantMessage(model);
    }
    if (assistant.content.length) result.push(assistant);
  }
  return result;
}

export function createGrimoireAgent(
  provider?: StoredProvider,
  locale: "zh" | "en" = "zh",
  thinkingLevel: ThinkingLevel = "off",
  onProviderEvent?: (event: unknown) => void,
) {
  const { model, streamFn } = providerRuntime(
    provider,
    locale,
    thinkingLevel,
    onProviderEvent,
  );
  let turns = 0;
  const agent = new Agent({
    initialState: {
      systemPrompt: `${systemPrompt}\nRespond in ${locale === "en" ? "English" : "Simplified Chinese"}.`,
      model,
      tools,
      thinkingLevel: provider ? thinkingLevel : "off",
    },
    streamFn,
    finishTurn: () => {
      if (++turns >= 10) return { action: "end" };
    },
  });
  return agent;
}
