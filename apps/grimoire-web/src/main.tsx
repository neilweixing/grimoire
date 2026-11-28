import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { I18nProvider } from "./i18n";
import { DesktopUpdatesProvider } from "./desktop-updates";
import {
  UserPreferencesProvider,
  loadUserPreferences,
  applyAppearance,
} from "./preferences";
import "./styles.css";

const initialPreferences = await loadUserPreferences();
applyAppearance(initialPreferences.preferences.appearance);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UserPreferencesProvider initial={initialPreferences}>
      <I18nProvider>
        <DesktopUpdatesProvider>
          <App />
        </DesktopUpdatesProvider>
      </I18nProvider>
    </UserPreferencesProvider>
  </StrictMode>,
);
