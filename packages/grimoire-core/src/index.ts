import { z } from "zod";

export const browserDataContextSchema = z
  .object({
    workspace: z.string().min(1).max(4096),
    threadId: z.string().min(1).max(200).optional(),
    threadIds: z.array(z.string().min(1).max(200)).optional(),
  })
  .strict();
export type BrowserDataContext = z.infer<typeof browserDataContextSchema>;

export const appearanceSchema = z.enum(["light", "dark"]);
export const cacheCleanupDaysSchema = z.number().int().min(0).max(365);
export const userPreferencesSchema = z.object({
  appearance: appearanceSchema,
  language: z.enum(["zh", "en"]),
  ignoreCertificateErrors: z.boolean(),
  cacheCleanupDays: cacheCleanupDaysSchema,
});
export type UserPreferences = z.infer<typeof userPreferencesSchema>;

export const permissionModeSchema = z.enum(["read-only", "workspace", "full"]);
export type PermissionMode = z.infer<typeof permissionModeSchema>;
export type ExecutionSettings = {
  mode: PermissionMode;
  workspace: string;
  executor: string;
  shellAvailable: boolean;
  fullAccessAvailable: boolean;
};

export type IntegrationConfig = {
  mcp: {
    mcpServers: Record<string, Record<string, unknown>>;
    autoEnableCodemode?: boolean;
  };
  skillPaths: string[];
  disabledSkills: string[];
};
export type IntegrationSnapshot = {
  config: IntegrationConfig;
  skills: {
    name: string;
    description: string;
    filePath: string;
    enabled: boolean;
    modelInvocable: boolean;
  }[];
  diagnostics: { path?: string; message: string }[];
  tools: { name: string; description: string }[];
  packages: { source: string; enabled: boolean }[];
  pendingReloads: number;
};
export type PluginUpdate = {
  source: string;
  displayName: string;
  type: "npm" | "git";
  scope: "user" | "project";
};
export type PluginLookup =
  | { found: false }
  | { found: true; source: string; name: string; version: string };
export type PluginCatalog = {
  packages: {
    name: string;
    description: string;
    version: string;
    url: string;
  }[];
  total: number;
};

export const thinkingLevelSchema = z.enum([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
export type ThinkingLevel = z.infer<typeof thinkingLevelSchema>;
export const modelCapabilitiesSchema = z.object({
  contextWindow: z.number().int().positive().max(10_000_000).optional(),
  maxTokens: z.number().int().positive().max(10_000_000).optional(),
  input: z
    .array(z.enum(["text", "image"]))
    .min(1)
    .max(2)
    .optional(),
  thinkingLevels: z.array(thinkingLevelSchema).min(1).max(7).optional(),
});
export type ModelCapabilities = z.infer<typeof modelCapabilitiesSchema>;

export const providerKindSchema = z.enum([
  "openai",
  "anthropic",
  "openai-compatible",
  "native",
]);
export type ProviderKind = z.infer<typeof providerKindSchema>;

export const providerInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    kind: providerKindSchema,
    nativeProvider: z.string().trim().min(1).max(80).optional(),
    model: z.string().trim().min(1).max(200),
    models: z
      .array(z.string().trim().min(1).max(200))
      .min(1)
      .max(200)
      .optional(),
    baseUrl: z
      .union([z.url({ protocol: /^https?$/ }), z.literal("")])
      .optional(),
    apiKey: z.string().trim().max(4096).optional(),
    contextWindow: z.number().int().positive().max(10_000_000).optional(),
    modelOverrides: z
      .record(z.string().min(1).max(200), modelCapabilitiesSchema)
      .optional(),
    modelMetadata: z
      .record(z.string().min(1).max(200), modelCapabilitiesSchema)
      .optional(),
  })
  .refine(
    (value) =>
      !value.models ||
      (value.models.includes(value.model) &&
        new Set(value.models).size === value.models.length),
    {
      message:
        "Configured models must be unique and include the default model.",
      path: ["models"],
    },
  )
  .refine((value) => value.kind !== "native" || Boolean(value.nativeProvider), {
    message: "A native provider is required.",
    path: ["nativeProvider"],
  });
export type ProviderInput = z.infer<typeof providerInputSchema>;
export function configuredModelIds(
  provider: Pick<ProviderInput, "model" | "models">,
): string[] {
  return provider.models ?? [provider.model];
}
export type PublicProvider = Omit<ProviderInput, "apiKey"> & {
  id: string;
  hasApiKey: boolean;
};
export type ProviderSettings = {
  providers: PublicProvider[];
  activeProviderId: string;
  activeModel?: string;
  thinkingLevels?: ThinkingLevel[];
};
export type ProviderModel = {
  id: string;
  name: string;
  thinkingLevels: ThinkingLevel[];
  contextWindow?: number;
  maxTokens?: number;
  input?: ("text" | "image")[];
  source?: "sdk" | "remote" | "custom";
};
export type ProviderCatalog = {
  providers: {
    id: string;
    name: string;
    baseUrl: string;
    models: ProviderModel[];
  }[];
};
export type ProviderModelList = { models: ProviderModel[] };
export type ModelProbeResult = {
  model: string;
  results: {
    level: ThinkingLevel;
    status: "accepted" | "rejected" | "inconclusive";
    reason:
      | "accepted"
      | "invalidParameter"
      | "authentication"
      | "rateLimited"
      | "timeout"
      | "requestFailed"
      | "noEffortParameter"
      | "notRun";
    parameter?: string;
    httpStatus?: number;
    outputTokens: number | null;
    reasoningTokens: number | null;
    durationMs: number;
  }[];
};
export const modelSelectionSchema = z.object({
  providerId: z.string().min(1),
  model: z.string().trim().min(1).max(200),
});
export const DEMO_PROVIDER_ID = "demo";

export const chatPartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(100_000) }),
  z.object({
    type: z.literal("tool-call"),
    toolCallId: z.string().max(200),
    toolName: z.string().max(200),
    args: z.record(z.string(), z.json()),
    result: z.unknown().optional(),
    isError: z.boolean().optional(),
  }),
]);
export type ChatPart = z.infer<typeof chatPartSchema>;

const metricCount = z.number().nonnegative();
export const runMetricsSchema = z.object({
  model: z.string(),
  providerId: z.string(),
  modelCalls: metricCount.int(),
  toolCalls: metricCount.int(),
  totalTokens: metricCount.nullable(),
  inputTokens: metricCount.nullable(),
  outputTokens: metricCount.nullable(),
  cacheReadTokens: metricCount.nullable(),
  cacheWriteTokens: metricCount.nullable(),
  usageComplete: z.boolean(),
  cacheComplete: z.boolean(),
  modelDurationMs: metricCount.nullable(),
  durationMs: metricCount,
  contextWindow: metricCount.positive().nullable(),
  contextInputTokens: metricCount.nullable(),
});
export type RunMetrics = z.infer<typeof runMetricsSchema>;

export const chatMessageSchema = z.object({
  id: z.string().max(200),
  role: z.enum(["user", "assistant"]),
  content: z.array(chatPartSchema).max(200),
  status: z
    .enum(["complete", "running", "cancelled", "error"])
    .default("complete"),
  error: z.string().optional(),
  metrics: runMetricsSchema.optional(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export const chatRequestSchema = z
  .object({
    messages: z.array(chatMessageSchema).min(1).max(200),
    thinkingLevel: thinkingLevelSchema.default("off"),
  })
  .refine((value) => {
    const last = value.messages.at(-1);
    return (
      last?.role === "user" &&
      last.content.some((p) => p.type === "text" && p.text.trim())
    );
  }, "最后一条消息必须是非空的用户消息");

export const conversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.number(),
  messages: z.array(chatMessageSchema),
});
export type Conversation = z.infer<typeof conversationSchema>;
export const conversationsSchema = z.array(conversationSchema);

export type AgentStreamEvent =
  | { type: "metrics"; metrics: RunMetrics }
  | { type: "text-delta"; delta: string }
  | {
      type: "tool-start";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool-result";
      toolCallId: string;
      result: unknown;
      isError: boolean;
    }
  | { type: "error"; message: string }
  | { type: "done" };

export async function* readAgentStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AgentStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6))
          .join("\n");
        if (!data) continue;
        const event = JSON.parse(data) as AgentStreamEvent;
        yield event;
        if (event.type === "done") return;
      }
      if (done) throw new Error("STREAM_INTERRUPTED");
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export { summarizeConversation } from "./metrics.js";

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const localAttachmentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(512),
  path: z.string().min(1).max(8192),
  contentType: z.string().max(200),
  size: z.number().int().nonnegative().max(MAX_ATTACHMENT_BYTES),
});
export type LocalAttachment = z.infer<typeof localAttachmentSchema>;

export function attachmentReference(file: LocalAttachment): string {
  const json = JSON.stringify(file)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e");
  return `<grimoire-file>${json}</grimoire-file>`;
}

export function splitAttachmentReferences(input: string) {
  const files: LocalAttachment[] = [];
  const text = input.replace(
    /(?:\n\n)?<grimoire-file>([^\n]*?)<\/grimoire-file>/g,
    (match, json) => {
      try {
        const file = localAttachmentSchema.safeParse(JSON.parse(json));
        if (file.success) {
          files.push(file.data);
          return "";
        }
      } catch {}
      return match;
    },
  );
  return { text, files };
}
