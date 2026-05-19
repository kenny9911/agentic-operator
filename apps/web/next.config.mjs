import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_URL = process.env.AGENTIC_API_URL ?? "http://localhost:3501";

/**
 * Next 16 ships Turbopack as default for dev. The web workspace has no
 * native module deps (better-sqlite3 lives in apps/api only), so Turbopack
 * is safe here. The api still runs on Node 26 + better-sqlite3 12 directly.
 *
 * Web is UI-only. All data calls go through /v1/* which Next rewrites to
 * apps/api on :3501. Same-origin in dev; in prod a reverse proxy serves the
 * same paths.
 */
/** @type {import("next").NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: ["@agentic/contracts"],
  typedRoutes: true,
  reactStrictMode: true,
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/v1/:path*", destination: `${API_URL}/v1/:path*` },
        { source: "/health", destination: `${API_URL}/health` },
        { source: "/", destination: "/portal/index.html" },
      ],
      afterFiles: [],
      fallback: [
        { source: "/:path*", destination: "/portal/index.html" },
      ],
    };
  },
};

export default nextConfig;
