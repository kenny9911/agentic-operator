/**
 * Best-effort secret stripping for log lines and error payloads.
 *
 * Not a security boundary — keys should already be absent from caller-side
 * inputs to the gateway. This is a last-resort filter for prose error
 * messages that may quote a header value or a URL.
 */

const KEY_PATTERNS: RegExp[] = [
  /sk-ant-api[\w-]+/g,            // Anthropic
  /sk-proj-[\w-]+/g,              // OpenAI project keys
  /sk-or-v\d-[\w-]+/g,            // OpenRouter
  /sk-or-[\w-]+/g,                // OpenRouter (older format)
  /AIza[\w-]{30,}/g,              // Google
  /gsk_[\w-]{20,}/g,              // Groq
  /sk-[\w-]{20,}/g,               // generic sk-* (DeepSeek, Qwen, etc.)
  /AKIA[A-Z0-9]{16}/g,            // AWS access key id
];

export function redact(input: string): string {
  let out = input;
  for (const re of KEY_PATTERNS) {
    out = out.replace(re, (m) => `${m.slice(0, 6)}…<redacted>`);
  }
  return out;
}

export function redactObject<T>(value: T): T {
  const json = JSON.stringify(value, (_k, v) =>
    typeof v === "string" ? redact(v) : v,
  );
  return JSON.parse(json) as T;
}
