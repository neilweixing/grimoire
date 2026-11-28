import { splitAttachmentReferences } from "@grimoire/core";
import { splitAssistantActivity } from "./assistant-activity";

export function splitSkillInvocation(source: string, originalText?: unknown) {
  const header = source.match(/^<skill name="([^\"]+)" location="[^\"]+">\n/);
  if (!header) return null;
  if (typeof originalText === "string") {
    const command = `/skill:${header[1]}`;
    if (originalText === command || originalText.startsWith(`${command} `)) {
      const query = originalText.slice(command.length).trim();
      const suffix = `\n</skill>${query ? `\n\n${query}` : ""}`;
      if (source.endsWith(suffix))
        return {
          name: header[1]!,
          instructions: source.slice(header[0].length, -suffix.length),
          query,
        };
    }
  }
  // Older transcripts did not retain the original input. Use the first native boundary.
  const legacy = source.match(
    /^<skill name="([^\"]+)" location="[^\"]+">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]*))?$/,
  );
  return legacy
    ? { name: legacy[1]!, instructions: legacy[2]!, query: legacy[3] ?? "" }
    : null;
}

export function userCopyText(source: string, originalText?: unknown): string {
  if (typeof originalText === "string")
    return splitAttachmentReferences(originalText).text;
  const skill = splitSkillInvocation(source);
  if (!skill) return splitAttachmentReferences(source).text;
  const args = splitAttachmentReferences(skill.query).text;
  return `/skill:${skill.name}${args ? ` ${args}` : ""}`;
}

export function assistantCopyText(
  parts: Parameters<typeof splitAssistantActivity>[0],
  status?: Parameters<typeof splitAssistantActivity>[1],
): string {
  return splitAssistantActivity(parts, status)
    .answer.flatMap((index) => {
      const part = parts[index]!;
      return part.type === "text" ? [part.text] : [];
    })
    .join("\n\n");
}
