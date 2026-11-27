export const storageKeys = {
  conversations: "grimoire.conversations.v1",
  locale: "grimoire.locale",
  thinkingLevel: "grimoire.thinkingLevel",
} as const;

const legacyKeys = {
  conversations: "datapi.conversations.v1",
  locale: "datapi.locale",
  thinkingLevel: "datapi.thinkingLevel",
} as const;

export function readStoredValue(
  preference: keyof typeof storageKeys,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): string | null {
  const current = storage.getItem(storageKeys[preference]);
  if (current !== null) return current;
  const legacy = storage.getItem(legacyKeys[preference]);
  if (legacy !== null) {
    try {
      storage.setItem(storageKeys[preference], legacy);
    } catch {
      // Existing data remains readable even if the migration cannot be saved.
    }
  }
  return legacy;
}
