import '@formatjs/intl-locale/polyfill-force.js';
import '@formatjs/intl-pluralrules/polyfill-force.js';

import { i18n } from '@lingui/core';
import { getLocales } from 'expo-localization';
import { messages as enMessages } from './locales/en/messages.po';
import { messages as viMessages } from './locales/vi/messages.po';

const SUPPORTED_LOCALES = ['en', 'vi'] as const;
type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
const DEFAULT_LOCALE: SupportedLocale = 'en';

function resolveSupportedLocale(): SupportedLocale {
  for (const { languageCode } of getLocales()) {
    const match = SUPPORTED_LOCALES.find((supported) => supported === languageCode);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}

const CATALOGS: Record<SupportedLocale, typeof enMessages> = {
  en: enMessages,
  vi: viMessages,
};

export const activeLocale = resolveSupportedLocale();

i18n.loadAndActivate({ locale: activeLocale, messages: CATALOGS[activeLocale] });

export { i18n };
