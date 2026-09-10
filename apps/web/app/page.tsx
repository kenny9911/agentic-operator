/**
 * `/` — product entry. Reuse an existing verified product session, otherwise
 * show the account dialog on this origin so the API owns its session cookie.
 */

import { redirect } from "next/navigation";
import type { Viewport } from "next";
import { readSession } from "@/lib/auth/session";
import { readAuthMode } from "@/lib/auth/config";
import { ProductEntry } from "./(auth)/product-entry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootIndex() {
  if (await readSession()) redirect("/portal");
  return <ProductEntry authMode={await readAuthMode()} />;
}
