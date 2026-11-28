import { createContext, useContext, useState, type ReactNode } from "react";
import { userPreferencesSchema, type UserPreferences } from "@grimoire/core";
import { api } from "./api";

export function applyAppearance(appearance: UserPreferences["appearance"]) {
  document.documentElement.dataset.theme = appearance;
  document.documentElement.style.colorScheme = appearance;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", appearance === "dark" ? "#282c34" : "#fcfaf7");
}
export async function loadUserPreferences(): Promise<{
  preferences: UserPreferences;
  failed: boolean;
}> {
  try {
    const initial = document.getElementById(
      "grimoire-preferences",
    )?.textContent;
    const preferences = userPreferencesSchema.parse(
      initial
        ? JSON.parse(initial)
        : await api("/preferences", { signal: AbortSignal.timeout(5000) }),
    );
    return { preferences, failed: false };
  } catch {
    return {
      preferences: {
        appearance:
          document.documentElement.dataset.theme === "dark" ? "dark" : "light",
        language: document.documentElement.lang.startsWith("en") ? "en" : "zh",
        ignoreCertificateErrors: false,
      },
      failed: true,
    };
  }
}
const Context = createContext({
  preferences: {
    appearance: "light",
    language: "zh",
    ignoreCertificateErrors: false,
  } as UserPreferences,
  ready: false,
  pending: false,
  failed: false,
  update: async (_patch: Partial<UserPreferences>) => {},
  reload: async () => {},
});
export const useUserPreferences = () => useContext(Context);
export function UserPreferencesProvider({
  initial,
  children,
}: {
  initial: { preferences: UserPreferences; failed: boolean };
  children: ReactNode;
}) {
  const [preferences, setPreferences] = useState(initial.preferences);
  const [ready, setReady] = useState(!initial.failed);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(initial.failed);
  const accept = (value: UserPreferences) => {
    setPreferences(value);
    applyAppearance(value.appearance);
    setReady(true);
    setFailed(false);
  };
  const update = async (patch: Partial<UserPreferences>) => {
    if (pending || !ready) return;
    setPending(true);
    setFailed(false);
    try {
      accept(
        await api<UserPreferences>("/preferences", {
          method: "PUT",
          body: JSON.stringify(patch),
        }),
      );
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };
  const reload = async () => {
    setPending(true);
    try {
      accept(await api<UserPreferences>("/preferences"));
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };
  return (
    <Context.Provider
      value={{ preferences, ready, pending, failed, update, reload }}
    >
      {children}
    </Context.Provider>
  );
}
