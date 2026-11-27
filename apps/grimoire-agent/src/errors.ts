const messages = {
  invalidOrigin: [
    "此来源无权访问本地服务",
    "This origin cannot access the local service.",
  ],
  invalidJson: ["请求不是有效的 JSON", "The request is not valid JSON."],
  serviceError: [
    "服务暂时不可用，请检查 Agent 服务日志。",
    "Service unavailable. Check the Agent service logs.",
  ],
  invalidProvider: [
    "请检查名称、模型和 API 地址是否填写正确。",
    "Check the provider name, model, and API URL.",
  ],
  missingProvider: ["供应商不存在", "Provider not found."],
  modelListUnavailable: [
    "无法读取供应商模型列表，仍可使用已配置的模型。",
    "Could not load the provider's model list. The configured model remains available.",
  ],
  invalidMessages: [
    "消息格式不正确，或已超过 200 条消息，请新建聊天。",
    "Invalid messages or more than 200 messages. Start a new chat.",
  ],
  missingMessage: ["缺少用户消息", "A user message is required."],
  missingKey: [
    "请先在设置中为供应商填写 API Key。",
    "Add an API key for this provider in Settings first.",
  ],
  unsupportedThinking: [
    "当前模型不支持所选思考深度，请选择其他档位或切换模型。",
    "This model does not support the selected thinking level. Choose another level or model.",
  ],
  aborted: [
    "请求已中断，请重试。",
    "The request was interrupted. Please try again.",
  ],
  agentFailed: ["Agent 运行失败", "The Agent run failed."],
} as const;

export function errorMessage(
  locale: string | undefined,
  key: keyof typeof messages,
): string {
  return messages[key][locale?.startsWith("en") ? 1 : 0];
}
