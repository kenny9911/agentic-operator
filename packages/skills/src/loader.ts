/**
 * SKILL.md loader. Mirrors Anthropic's "Skills" progressive-disclosure
 * pattern: each skill lives in `<root>/<skill-name>/SKILL.md` with a YAML
 * frontmatter block carrying `name` + `description` + arbitrary metadata.
 *
 * Boot-time we list every SKILL.md and read ONLY the frontmatter (cheap —
 * ~kilobytes per tenant). The body is loaded lazily on `load_skill(name)`
 * so a tenant with 50 skills doesn't burn memory + tokens advertising
 * 50 full bodies.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";

export interface SkillDescriptor {
  /** Canonical id — kebab folder name unless frontmatter overrides. */
  name: string;
  /** One-liner shown to the LLM in the `list_skills` response. */
  description: string;
  /** Absolute path to SKILL.md; consumed by `load_skill`. */
  path: string;
  /** Frontmatter metadata verbatim (any extra keys the author wants to surface). */
  metadata?: Record<string, unknown>;
}

/**
 * Walk `<root>/<skill-name>/SKILL.md` files and return a descriptor per
 * skill. Subdirectories without a SKILL.md are skipped silently — lets a
 * tenant keep helper scripts under `skills/<name>/` without polluting
 * the listing.
 *
 * `root` is resolved relative to `process.cwd()` when relative. Missing
 * `root` returns an empty array — a tenant with no skills shouldn't fail
 * to boot.
 */
export function loadSkillsFromDirectory(root: string): SkillDescriptor[] {
  const absRoot = resolve(process.cwd(), root);
  if (!existsSync(absRoot)) return [];
  const entries = readdirSync(absRoot);
  const out: SkillDescriptor[] = [];
  for (const entry of entries) {
    const skillDir = join(absRoot, entry);
    if (!statSync(skillDir).isDirectory()) continue;
    const skillFile = join(skillDir, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    const raw = readFileSync(skillFile, "utf8");
    const { metadata, body: _body } = parseFrontmatter(raw);
    // Default name = folder name; frontmatter `name` wins when present.
    const name = stringOr(metadata?.name, basename(skillDir));
    const description = stringOr(
      metadata?.description,
      `Skill '${name}' (no description provided)`,
    );
    out.push({
      name,
      description,
      path: skillFile,
      metadata,
    });
  }
  // Stable order so list_skills returns the same list on every boot — keeps
  // prompt caching effective.
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Read a skill's full body. Caller is responsible for matching the name
 * against the loaded descriptors first; this helper only reads the file.
 */
export function readSkillBody(path: string): string {
  const raw = readFileSync(path, "utf8");
  return parseFrontmatter(raw).body;
}

/**
 * Minimal YAML-ish frontmatter parser. Accepts:
 *   ---
 *   name: foo
 *   description: |
 *     multi-line
 *     description
 *   custom_key: value
 *   ---
 *   body...
 *
 * No external YAML dep — we only care about top-level string + scalar
 * values and a single multi-line `|` block. Anything more exotic
 * (nested objects, arrays) falls through as a raw string. Tenants that
 * need structured metadata can keep it inside the body.
 */
export function parseFrontmatter(source: string): {
  metadata: Record<string, unknown> | undefined;
  body: string;
} {
  if (!source.startsWith("---")) {
    return { metadata: undefined, body: source };
  }
  const end = source.indexOf("\n---", 3);
  if (end < 0) return { metadata: undefined, body: source };
  const header = source.slice(3, end).trim();
  // Body starts after the closing `---\n` (or `---` at EOF).
  const after = end + "\n---".length;
  let body = source.slice(after);
  if (body.startsWith("\n")) body = body.slice(1);

  const metadata: Record<string, unknown> = {};
  const lines = header.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!;
    let value: string = m[2]!.trim();
    if (value === "|" || value === ">") {
      // Multi-line block — consume indented continuation lines.
      const parts: string[] = [];
      let j = i + 1;
      while (j < lines.length && /^\s+/.test(lines[j]!)) {
        parts.push(lines[j]!.replace(/^\s+/, ""));
        j++;
      }
      metadata[key] = parts.join(value === "|" ? "\n" : " ").trim();
      i = j - 1;
    } else {
      // Strip surrounding quotes if present.
      const unquoted = value.replace(/^["'](.*)["']$/, "$1");
      metadata[key] = unquoted;
    }
  }
  return {
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    body: body.trim(),
  };
}

function stringOr(v: unknown, fallback: string): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}
