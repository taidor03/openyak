import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enCommon from "./locales/en/common.json";
import enChat from "./locales/en/chat.json";
import enSettings from "./locales/en/settings.json";
import enUsage from "./locales/en/usage.json";
import enPlugins from "./locales/en/plugins.json";
import enAutomations from "./locales/en/automations.json";
import enContentWorkbench from "./locales/en/contentWorkbench.json";

import zhCommon from "./locales/zh/common.json";
import zhChat from "./locales/zh/chat.json";
import zhSettings from "./locales/zh/settings.json";
import zhUsage from "./locales/zh/usage.json";
import zhPlugins from "./locales/zh/plugins.json";
import zhAutomations from "./locales/zh/automations.json";
import zhContentWorkbench from "./locales/zh/contentWorkbench.json";

i18n.use(initReactI18next).init({
  resources: {
    en: {
      common: enCommon,
      chat: enChat,
      settings: enSettings,
      usage: enUsage,
      plugins: enPlugins,
      automations: enAutomations,
      contentWorkbench: enContentWorkbench,
    },
    zh: {
      common: zhCommon,
      chat: zhChat,
      settings: zhSettings,
      usage: zhUsage,
      plugins: zhPlugins,
      automations: zhAutomations,
      contentWorkbench: zhContentWorkbench,
    },
  },
  fallbackLng: "en",
  lng: "zh",
  defaultNS: "common",
  ns: ["common", "chat", "settings", "usage", "plugins", "automations", "contentWorkbench"],
  interpolation: {
    escapeValue: false,
  },
});

export function getClientLanguagePreference(): "en" | "zh" {
  if (typeof window === "undefined") return "en";

  const stored = window.localStorage.getItem("openyak-language");
  if (stored === "en" || stored === "zh") return stored;

  return window.navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export default i18n;
