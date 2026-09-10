import { serverApiUrl } from "@/lib/server-api-url";

/** Read only public auth mode from Fastify; web owns neither secrets nor DB. */
export async function readAuthMode(): Promise<"accounts" | "local"> {
  const response = await fetch(`${serverApiUrl()}/v1/auth/config`, {
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Authentication service is unavailable");
  const payload: unknown = await response.json();
  if (
    !payload ||
    typeof payload !== "object" ||
    !("ok" in payload) ||
    payload.ok !== true ||
    !("data" in payload) ||
    !payload.data ||
    typeof payload.data !== "object" ||
    !("mode" in payload.data) ||
    (payload.data.mode !== "accounts" && payload.data.mode !== "local")
  )
    throw new Error("Authentication service returned invalid configuration");
  return payload.data.mode;
}
