/**
 * The name an operator reads for an agent, in the portal's current language.
 *
 * Ontology-compiled manifests ship `title_i18n` (`{ zh, en, … }`) next to the
 * single `title`; hand-authored manifests ship only `title`; a bare DB row may
 * have neither. Resolution: the exact language → its base language (`zh-CN`
 * → `zh`) → the manifest `title` → the technical `name`.
 */

export interface AgentTitleSource {
  name: string;
  title?: string | null;
  titleI18n?: Record<string, string> | null;
}

export function agentDisplayTitle(
  agent: AgentTitleSource,
  language: string | null | undefined,
): string {
  const localized = agent.titleI18n;
  if (localized && language) {
    const exact = localized[language]?.trim();
    if (exact) return exact;
    const base = language.split(/[-_]/)[0]?.toLowerCase();
    if (base) {
      for (const [tag, value] of Object.entries(localized)) {
        if (tag.toLowerCase().split(/[-_]/)[0] === base && value.trim()) {
          return value.trim();
        }
      }
    }
  }
  const title = agent.title?.trim();
  return title || agent.name;
}

/** Longest subtitle a node can carry before it crowds the card. */
const SUBTITLE_MAX = 22;
/** The compiler's category prefix — 【查】【算】【评】【行】 and the like. */
const CATEGORY_PREFIX = /^【[^】]{1,4}】\s*/;
/** Longest description a hover tooltip carries before it becomes a wall. */
const TOOLTIP_DESCRIPTION_MAX = 240;

/**
 * A one-line Chinese gloss for a node, from the agent's own description.
 *
 * The canvas shows manifest names — `collectChainExecutionData`,
 * `scoreOnTimeProbability` — which say what an agent is called, not what it
 * does. The description is right there in the definition, but it is a
 * paragraph: the useful part is its opening clause, up to the first break.
 *
 * Returns null rather than a truncated fragment when nothing short enough can
 * be salvaged; a node with no subtitle beats a node with a misleading one.
 */
export function agentSubtitle(description: string | undefined | null): string | null {
  const body = (description ?? "").trim().replace(CATEGORY_PREFIX, "");
  if (!body) return null;
  // First clause: Chinese and Latin sentence breaks alike.
  const clause = body.split(/[，。；：,.;:—\n]/)[0]?.trim() ?? "";
  if (!clause) return null;
  if (clause.length <= SUBTITLE_MAX) return clause;
  // A long opening clause is prose, not a label. Cut on a natural boundary if
  // there is one inside the budget, rather than mid-word.
  const clipped = clause.slice(0, SUBTITLE_MAX);
  const boundary = Math.max(clipped.lastIndexOf("、"), clipped.lastIndexOf("／"));
  return `${boundary > SUBTITLE_MAX / 2 ? clipped.slice(0, boundary) : clipped}…`;
}

/**
 * The human-facing half of an agent description, for a hover tooltip.
 *
 * Ontology-compiled descriptions are two things glued together: an opening
 * paragraph written for a person ("【析】按物料编码聚类…把 10-15 分钟的人工比对压到
 * 分钟级"), then blank-line-separated 【取数步骤】/【判定步骤】 blocks written for
 * the model — hundreds of characters of numbered prompt. Only the first
 * paragraph belongs in a tooltip; the rest would bury it.
 *
 * Keeps the 【x】 category prefix, which the card's subtitle drops: with room
 * for a whole sentence it reads as a label, not as noise.
 */
export function agentDescriptionText(
  description: string | undefined | null,
): string | null {
  const body = (description ?? "").trim();
  if (!body) return null;
  // Blank line = the boundary between prose and embedded model instructions.
  const paragraph = body.split(/\n\s*\n/)[0]?.replace(/\s*\n\s*/g, " ").trim() ?? "";
  if (!paragraph) return null;
  return paragraph.length <= TOOLTIP_DESCRIPTION_MAX
    ? paragraph
    : `${paragraph.slice(0, TOOLTIP_DESCRIPTION_MAX)}…`;
}

/**
 * The `title` text for a node card, so a clipped name or description is still
 * readable in full on hover.
 *
 * Both canvases size nodes to a fixed box and end-ellipsis whatever overflows,
 * which is right for the glance but leaves no way to read the rest. This is
 * that way. Native `title` rather than a styled popover on purpose: it needs no
 * hover state to manage, survives canvas panning, and every other tooltip on
 * these two surfaces already uses it.
 *
 * `identity` is ordered most-readable first and de-duplicated, so an agent
 * whose title IS its name (the common case for compiled manifests) shows that
 * name once, not three times.
 */
export function agentNodeTooltip(options: {
  identity: (string | null | undefined)[];
  description?: string | null;
  hint?: string | null;
}): string {
  const seen = new Set<string>();
  const identity: string[] = [];
  for (const raw of options.identity) {
    const value = raw?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    identity.push(value);
  }
  const description = agentDescriptionText(options.description);
  const hint = options.hint?.trim();
  // Blank lines separate the three registers — what it is called, what it does,
  // what clicking does — so the tooltip stays scannable at any length.
  return [identity.join("\n"), description, hint].filter(Boolean).join("\n\n");
}
