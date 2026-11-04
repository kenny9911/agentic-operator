"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { I18nBundle } from "./types";

const I18nBootstrapContext = createContext<I18nBundle | null>(null);

export function I18nBootstrapProvider({
  initialBundle,
  children,
}: {
  initialBundle: I18nBundle;
  children: ReactNode;
}) {
  return (
    <I18nBootstrapContext.Provider value={initialBundle}>
      {children}
    </I18nBootstrapContext.Provider>
  );
}

export function useI18nBootstrap(): I18nBundle | null {
  return useContext(I18nBootstrapContext);
}
