import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { getInitialI18nBundle } from "@/lib/i18n/server";
import { I18nBootstrapProvider } from "@/lib/i18n/bootstrap";
import "@/styles/tokens.css";
import "./global.css";

const sans = localFont({
  src: "./fonts/ibm-plex-sans-latin-wght-normal.woff2",
  variable: "--font-ibm-plex-sans",
  weight: "100 700",
  style: "normal",
  display: "swap",
});
const mono = localFont({
  src: [
    {
      path: "./fonts/ibm-plex-mono-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/ibm-plex-mono-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "./fonts/ibm-plex-mono-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
  ],
  variable: "--font-ibm-plex-mono",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});
const display = localFont({
  src: [
    {
      path: "./fonts/instrument-serif-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/instrument-serif-latin-400-italic.woff2",
      weight: "400",
      style: "italic",
    },
  ],
  variable: "--font-instrument-serif",
  display: "swap",
  preload: false,
  adjustFontFallback: "Times New Roman",
});

export const metadata: Metadata = {
  title: "Agentic Operator",
  description: "Event-driven agentic workflow runtime",
};

export const viewport: Viewport = {
  width: 1440,
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const initialI18n = await getInitialI18nBundle();
  return (
    <html
      lang={initialI18n.language}
      className={`${sans.variable} ${mono.variable} ${display.variable}`}
      data-theme="dark"
      data-density="default"
      suppressHydrationWarning
    >
      <body>
        <I18nBootstrapProvider initialBundle={initialI18n}>
          {children}
        </I18nBootstrapProvider>
      </body>
    </html>
  );
}
