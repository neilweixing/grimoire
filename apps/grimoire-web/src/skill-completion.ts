import type {
  DirectiveFormatter,
  TriggerAdapter,
  TriggerMatcher,
} from "@assistant-ui/react";

export type SkillChoice = {
  name: string;
  description: string;
  enabled: boolean;
};
export const SKILL_TRIGGER = "/skill";

// Pi recognizes Skill commands only at the beginning of a prompt.
export const matchSkillTrigger: TriggerMatcher = (text, char, cursor) => {
  if (!text.startsWith(char) || cursor < char.length || cursor > text.length)
    return null;
  if (cursor === char.length) {
    if (text.length > cursor && !/[:\s]/u.test(text[cursor]!)) return null;
    let endOffset = cursor;
    if (text[cursor] === ":")
      while (endOffset < text.length && !/\s/u.test(text[endOffset]!))
        endOffset++;
    return { query: "", offset: 0, endOffset };
  }
  const separator = text[char.length];
  if (separator !== ":" && separator !== " ") return null;
  const start = char.length + 1;
  const query = text.slice(start, cursor);
  if (/\s/u.test(query)) return null;
  let endOffset = cursor;
  if (query || separator === ":") {
    while (endOffset < text.length && !/\s/u.test(text[endOffset]!))
      endOffset++;
  }
  return { query, offset: 0, endOffset };
};

export const skillFormatter: DirectiveFormatter = {
  serialize: (item) => `/skill:${item.id}`,
  parse: (text) => [{ kind: "text", text }],
};

export function skillCompletionAdapter(
  skills: readonly SkillChoice[],
): TriggerAdapter {
  const items = skills
    .filter((skill) => skill.enabled)
    .map((skill) => ({
      id: skill.name,
      type: "skill",
      label: skill.name,
      description: skill.description,
    }));
  return {
    categories: () => [],
    categoryItems: () => [],
    search: (query) => {
      const needle = query.toLowerCase();
      return items.filter((item) =>
        `${item.label} ${item.description}`.toLowerCase().includes(needle),
      );
    },
  };
}
