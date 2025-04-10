"use client";

import { createInstance } from "i18next";
import type { TFunction, i18n } from "i18next";
import { useTranslation } from "react-i18next";

import { useAtomsContext } from "@calcom/atoms/hooks/useAtomsContext";

type UseLocaleReturnType = {
  i18n: i18n;
  t: TFunction;
  isLocaleReady: boolean;
};

// @internal
const useClientLocale = (namespace: Parameters<typeof useTranslation>[0] = "common"): UseLocaleReturnType => {
  const context = useAtomsContext();
  const { i18n, t } = useTranslation(namespace);
  const isLocaleReady = Object.keys(i18n).length > 0;
  if (context?.clientId) {
    return { i18n: context.i18n, t: context.t, isLocaleReady: true } as unknown as UseLocaleReturnType;
  }
  return {
    i18n,
    t,
    isLocaleReady,
  };
};

// @internal
const serverI18nInstances = new Map<string, UseLocaleReturnType>();

declare global {
  interface Window {
    APP_ROUTER_I18N?: { translations: Record<string, string>; ns: string; locale: string };
  }
}

export const useLocale = (): UseLocaleReturnType => {
  const clientI18n = useClientLocale();
  const i18nData =
    typeof window !== "undefined" && window.APP_ROUTER_I18N ? window.APP_ROUTER_I18N : undefined;

  if (i18nData) {
    const { translations, locale, ns } = i18nData;
    const instanceKey = `${locale}-${ns}`;

    // Check if we already have an instance for this locale and namespace
    if (!serverI18nInstances.has(instanceKey)) {
      const i18n = createInstance();
      i18n.init({
        lng: locale,
        resources: {
          [locale]: {
            [ns]: translations,
          },
        },
      });

      serverI18nInstances.set(instanceKey, {
        t: i18n.getFixedT(locale, ns),
        isLocaleReady: true,
        i18n,
      });
    }

    return serverI18nInstances.get(instanceKey)!;
  }

  console.warn("useLocale: window.APP_ROUTER_I18N not available, falling back to client-side i18n");
  return {
    t: clientI18n.t,
    isLocaleReady: clientI18n.isLocaleReady,
    i18n: clientI18n.i18n,
  };
};
