import { describe, expect, it } from "vitest";
import { readStoredValue, storageKeys } from "../apps/grimoire-web/src/storage";

function memoryStorage(entries: Record<string, string> = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("Grimoire storage migration", () => {
  it.each([
    [
      "conversations",
      "datapi.conversations.v1",
      '[{"id":"existing-chat","messages":[]}]',
    ],
    ["locale", "datapi.locale", "zh"],
    ["thinkingLevel", "datapi.thinkingLevel", "high"],
  ] as const)(
    "migrates %s without changing the original value",
    (preference, legacyKey, value) => {
      const storage = memoryStorage({ [legacyKey]: value });
      expect(readStoredValue(preference, storage)).toBe(value);
      expect(storage.getItem(storageKeys[preference])).toBe(value);
      expect(storage.getItem(legacyKey)).toBe(value);
    },
  );

  it("prefers existing Grimoire data over legacy data", () => {
    const storage = memoryStorage({
      "grimoire.locale": "en",
      "datapi.locale": "zh",
    });
    expect(readStoredValue("locale", storage)).toBe("en");
    expect(storage.getItem("datapi.locale")).toBe("zh");
  });

  it("still reads legacy data when storage is full", () => {
    const storage = memoryStorage({ "datapi.locale": "zh" });
    storage.setItem = () => {
      throw new Error("Storage is full");
    };
    expect(readStoredValue("locale", storage)).toBe("zh");
  });

  it("returns null when no preference has been saved", () => {
    expect(readStoredValue("locale", memoryStorage())).toBeNull();
  });
});
