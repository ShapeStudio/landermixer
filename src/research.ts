import Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import { callStructured, DEFAULT_MODEL, type OnProgress } from "./anthropic.js";
import { fetchProxycurlProfile } from "./proxycurl.js";
import {
  prospectResearchSchema,
  researchInputSchema,
  researchToolSchema,
  stripNulls,
  SCHEMA_VERSION,
  type ProspectResearch,
  type ResearchInput,
} from "./schema.js";

export type ResearchDepth = "standard" | "deep";

export interface ResearchOptions {
  /** Defaults to process.env.ANTHROPIC_API_KEY. */
  anthropicApiKey?: string;
  /** Defaults to process.env.PROXYCURL_API_KEY. Optional — see README. */
  proxycurlApiKey?: string;
  /** Defaults to "claude-sonnet-4-6". */
  model?: string;
  /** standard = 12 web searches, deep = 16. */
  depth?: ResearchDepth;
  /** Override the search budget directly (wins over depth). */
  webSearchMaxUses?: number;
  onProgress?: OnProgress;
  signal?: AbortSignal;
}

const SEARCH_BUDGET: Record<ResearchDepth, number> = { standard: 12, deep: 16 };

const SYSTEM_PROMPT = `You are a prospect-research analyst. Input: a LinkedIn profile URL (plus optional company URL and seller notes). Output: a deep, structured research dossier on the PERSON and their COMPANY, recorded via the record_research tool.

The output is consumed programmatically (CRMs, outreach tooling, scripts) — completeness and honesty beat prose style. Fill every field you can verify; leave fields empty rather than guessing.

# Inputs you may receive
- linkedin_url (always) — the canonical person identifier
- company_url (optional but very valuable) — the prospect company's OWN website. When present, treat it as the CANONICAL company site: derive company.domain from it directly, anchor company searches on that exact domain, and base commercials on THAT site's pages. This kills the researching-a-same-named-different-company failure mode.
- name / company (optional hints; verify, don't trust)
- notes (optional seller context — factor into outreach angles)

# How to research

Use web_search aggressively. Plan your searches (budget shown in the user message):

1. \`site:linkedin.com/in "<name>"\` — the profile itself: headline, location, role, summary, education, past roles. Search engines often surface gated-profile content in snippets.
2. \`"<name>" "<company>"\` — articles, podcasts, talks, conference bios.
3. \`"<company>" about\` OR the company_url domain directly — official site, products, positioning, industry, HQ, founding year, employee count.
4. \`"<name>" twitter OR github OR substack\` — public social links + what they think about lately.
5. \`"<company>" competitors\` OR \`"<company>" vs\` — 2-5 DIRECT competitors (same market, same buyer). For each: where they stand, and how the researched company positions (or could position) against them.
6. \`similarweb "<domain>"\` OR \`"<company>" monthly visitors\` — traffic estimate. Also skim their product pages for price points → aov estimate + pricing model.
7. \`"<company>" funding OR crunchbase OR "raised"\` — funding block: total raised, last round, date, notable investors.
8. \`"<company>" news\` (current year) — 2-5 recent news items, each with a one-line why_it_matters for a seller.
9. \`"<company>" careers OR hiring\` — hiring signals: actively hiring? which roles?
10. \`"<domain>" builtwith OR "powered by"\` — tech stack, when discoverable.
11-12. Open follow-ups on the strongest signals the prior searches surfaced (a named project, a conference talk, an acquisition rumor).

With a deep budget, spend the extra searches on: a second news pass, executive-team context, and verifying the competitor list from a second angle.

# Field rules

- person.about: 2-4 sentences in your own voice — what this person does and is known for.
- person.photo_url: only a public URL you actually saw; never construct one.
- company.domain: cleanest root domain, no protocol/path. From company_url when given.
- company.logo_url: https://logo.clearbit.com/{domain} is acceptable once you know the domain.
- commercials: estimate strings ALWAYS carry their basis ("~80,000 monthly visits (SimilarWeb estimate)"). Numeric twins (monthly_traffic, aov) are plain numbers — fill both forms or neither. Never invent precision; empty + a research_notes line beats a made-up number.
- competitors[].note: grounded in something you read. competitors[].vs_positioning: how the researched company wins or differs — category-level reasoning is fine, invented facts are not.
- outreach: written FOR a seller approaching this person. likely_pain_points and hooks tie to the role + company stage. icebreakers are ready-to-send opening lines referencing something real from the research. talking_points cite researched specifics.
- meta.confidence: high / medium / low by how much you actually verified.
- meta.profile_accessible: set TRUE in all normal cases. Set FALSE only when the LinkedIn profile is member-gated AND every other angle also failed to surface verifiable role/company data.
- meta.sources: every page that informed the dossier (up to 12). Real URLs you retrieved via web_search only.
- meta.research_notes: 1-3 sentences on what was hard to find or where you're estimating.

# Rules
- Do not fabricate verifiable specifics (revenue, headcount, named clients, deal sizes). Unverified → leave empty, note it.
- Distinguish what you read from what you inferred.
- sources URLs must be pages you actually retrieved.
- Output ONLY via the record_research tool — no prose response.`;

const toolInputSchema = zodToJsonSchema(researchToolSchema, {
  $refStrategy: "none",
  target: "openApi3",
}) as Record<string, unknown>;

/**
 * Pretty-name fallback from the LinkedIn URL slug:
 *   linkedin.com/in/ziga-kerec-72b3a8 → "Ziga Kerec"
 * Research overrides this with the verified name.
 */
export function nameFromLinkedinUrl(url: string): string {
  try {
    const u = new URL(url);
    const slug = u.pathname.split("/in/")[1]?.split("/")[0] ?? "";
    const parts = slug.split("-").filter((p) => !/^\d+$|^[a-f0-9]{6,}$/i.test(p));
    const pretty = parts
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
      .join(" ")
      .slice(0, 60);
    return pretty || "Unknown";
  } catch {
    return "Unknown";
  }
}

/**
 * Research one prospect. Resolves to the full structured dossier;
 * throws on invalid input, missing API key, or model/API failure.
 */
export async function research(
  input: ResearchInput,
  opts: ResearchOptions = {},
): Promise<ProspectResearch> {
  const parsedInput = researchInputSchema.parse(input);

  const apiKey = opts.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing Anthropic API key. Set ANTHROPIC_API_KEY (get one at https://console.anthropic.com) or pass opts.anthropicApiKey.",
    );
  }
  const proxycurlKey = opts.proxycurlApiKey ?? process.env.PROXYCURL_API_KEY;
  const model = opts.model ?? DEFAULT_MODEL;
  const depth: ResearchDepth = opts.depth ?? "standard";
  const searchBudget = opts.webSearchMaxUses ?? SEARCH_BUDGET[depth];

  const client = new Anthropic({ apiKey });

  // Optional verified ground truth for gated profiles.
  const proxycurl = await fetchProxycurlProfile(parsedInput.linkedin_url, proxycurlKey);

  const nameHint = parsedInput.name ?? nameFromLinkedinUrl(parsedInput.linkedin_url);

  const userMessage = [
    `# Prospect`,
    `LinkedIn: ${parsedInput.linkedin_url}`,
    `Name hint (verify): ${nameHint}`,
    parsedInput.company ? `Company hint (verify): ${parsedInput.company}` : null,
    parsedInput.company_url
      ? `Company website (canonical — anchor company research here): ${parsedInput.company_url}`
      : null,
    parsedInput.notes ? `\n# Seller notes\n${parsedInput.notes}` : null,
    proxycurl
      ? [
          `\n# Verified LinkedIn data (Proxycurl)`,
          `Treat as ground truth for person identity/history fields. Set meta.profile_accessible: true.`,
          `Still web_search for company, competitors, commercials, news, and anything that looks stale.`,
          "```json",
          JSON.stringify(proxycurl, null, 2),
          "```",
        ].join("\n")
      : null,
    ``,
    `Search budget: up to ${searchBudget} web searches. Research deeply and call record_research with everything you can verify.`,
  ]
    .filter(Boolean)
    .join("\n");

  const { output, searchesUsed } = await callStructured<unknown>({
    client,
    model,
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    toolName: "record_research",
    toolDescription:
      "Record the structured prospect-research dossier: person, company, competitors, commercials, outreach angles, and meta/provenance.",
    toolInputSchema,
    cacheSystem: true,
    webSearch: true,
    webSearchMaxUses: searchBudget,
    maxTokens: 8192,
    onProgress: opts.onProgress,
    signal: opts.signal,
  });

  // Models emit explicit nulls for unfillable optional fields — strip them
  // before validation (see stripNulls docs).
  const parsed = researchToolSchema.parse(stripNulls(output));

  // Code-filled meta — never trusted to the model.
  const result: ProspectResearch = {
    ...parsed,
    meta: {
      ...(parsed.meta ?? {}),
      researched_at: new Date().toISOString(),
      model,
      searches_used: searchesUsed,
      schema_version: SCHEMA_VERSION,
    },
  };

  // Echo the input URL into the dossier for downstream joins.
  result.person.linkedin_url ??= parsedInput.linkedin_url;

  return prospectResearchSchema.parse(result);
}
