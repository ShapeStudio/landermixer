import { z } from "zod";

// ---------------------------------------------------------------------------
// The LanderMixer prospect-research schema — this shape IS the product.
//
// Design rules (learned in production, keep them):
//   - clip()/clipOpt(): truncate over-long model output instead of failing
//     the whole run on a max-length violation.
//   - Arrays cap via .transform(slice) instead of .max() for the same reason.
//   - Numbers use .min(0), NEVER .positive() — z.number().positive() emits a
//     boolean `exclusiveMinimum` under zod-to-json-schema's openApi3 target,
//     which the Anthropic API rejects (input_schema must be valid JSON
//     Schema draft 2020-12). test/check-tool-schemas.ts guards this.
//   - Estimate fields come in pairs: a display string WITH its basis
//     ("~80,000 monthly visits (SimilarWeb estimate)") and a plain numeric
//     twin for downstream math. Models must fill both or neither.
//   - Bump SCHEMA_VERSION on any breaking shape change once published.
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = "1";

/**
 * Models routinely emit explicit `null` for optional fields they couldn't
 * fill ("personal_site": null) — Zod rejects null on `.optional()` strings.
 * Strip nulls recursively BEFORE parsing so every optional field, present
 * and future, tolerates them. (No field in this schema treats null as
 * meaningful.)
 */
export function stripNulls(value: unknown): unknown {
  if (value === null) return undefined;
  if (Array.isArray(value)) {
    return value.map(stripNulls).filter((v) => v !== undefined);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const stripped = stripNulls(v);
      if (stripped !== undefined) out[k] = stripped;
    }
    return out;
  }
  return value;
}

const clip = (max: number) =>
  z.string().min(1).transform((s) => (s.length > max ? s.slice(0, max) : s));
const clipOpt = (max: number) =>
  z.string().transform((s) => (s.length > max ? s.slice(0, max) : s));

const url = z.string().url().max(2048);

// ---- person ---------------------------------------------------------------

export const educationItemSchema = z.object({
  school: clip(160),
  degree: clipOpt(160).optional(),
  years: clipOpt(40).optional(),
});

export const experienceItemSchema = z.object({
  title: clip(160),
  company: clip(160),
  years: clipOpt(40).optional(),
  note: clipOpt(280).optional(),
});

export const personSchema = z.object({
  full_name: clip(120),
  headline: clipOpt(280).optional(),
  location: clipOpt(120).optional(),
  /** 2-4 sentences in the researcher's own voice. */
  about: clipOpt(700).optional(),
  photo_url: url.optional(),
  linkedin_url: url.optional(),
  current_role: z
    .object({
      title: clip(160),
      company: clip(160),
      years_in_role: clipOpt(40).optional(),
    })
    .optional(),
  total_years_experience: clipOpt(40).optional(),
  education: z.array(educationItemSchema).optional().transform((a) => a?.slice(0, 6)),
  past_experience: z.array(experienceItemSchema).optional().transform((a) => a?.slice(0, 6)),
  skills: z.array(clip(120)).optional().transform((a) => a?.slice(0, 12)),
  recent_activity_themes: z.array(clip(240)).optional().transform((a) => a?.slice(0, 6)),
  social_links: z
    .object({
      twitter: url.optional(),
      github: url.optional(),
      personal_site: url.optional(),
    })
    .optional(),
});

// ---- company --------------------------------------------------------------

export const fundingSchema = z.object({
  total_raised_estimate: clipOpt(120).optional(),
  last_round: clipOpt(120).optional(),
  last_round_date: clipOpt(40).optional(),
  notable_investors: z.array(clip(120)).optional().transform((a) => a?.slice(0, 6)),
});

export const hiringSignalsSchema = z.object({
  actively_hiring: z.boolean().optional(),
  roles_hiring_for: z.array(clip(120)).optional().transform((a) => a?.slice(0, 8)),
  note: clipOpt(280).optional(),
});

export const newsItemSchema = z.object({
  title: clip(200),
  date: clipOpt(40).optional(),
  url: url.optional(),
  /** One line on why a seller should care. */
  why_it_matters: clipOpt(280).optional(),
});

export const companySchema = z.object({
  name: clip(160),
  /** Root domain, no protocol/path — e.g. "acme.com". Never truncated. */
  domain: z.string().max(240).optional(),
  logo_url: url.optional(),
  /** 2-3 sentences: what they do, positioning, stage. */
  summary: clipOpt(700).optional(),
  industry: clipOpt(120).optional(),
  founded_year: clipOpt(12).optional(),
  hq_location: clipOpt(120).optional(),
  employee_count_estimate: clipOpt(80).optional(),
  products: z.array(clip(160)).optional().transform((a) => a?.slice(0, 8)),
  positioning: clipOpt(400).optional(),
  funding: fundingSchema.optional(),
  hiring_signals: hiringSignalsSchema.optional(),
  tech_stack: z.array(clip(80)).optional().transform((a) => a?.slice(0, 12)),
  recent_news: z.array(newsItemSchema).optional().transform((a) => a?.slice(0, 5)),
});

// ---- competitors ----------------------------------------------------------

export const competitorSchema = z.object({
  name: clip(120),
  domain: z.string().max(240).optional(),
  /** Where they stand in the market (researched, not invented). */
  note: clip(320),
  /** How the researched company positions against them (or could). */
  vs_positioning: clipOpt(320).optional(),
});

// ---- commercials ----------------------------------------------------------

export const commercialsSchema = z.object({
  /** e.g. "~80,000 monthly visits (SimilarWeb estimate)". */
  web_traffic_estimate: clipOpt(200).optional(),
  /** Numeric twin of web_traffic_estimate. Fill both or neither. */
  monthly_traffic: z.number().min(0).optional(),
  /** e.g. "~$1,400 AUD — premium price points on site". */
  aov_estimate: clipOpt(200).optional(),
  /** Numeric twin of aov_estimate, in aov_currency. Fill both or neither. */
  aov: z.number().min(0).optional(),
  aov_currency: clipOpt(8).optional(),
  /** "e-commerce", "subscription", "project-based B2B", "usage-based", … */
  pricing_model: clipOpt(120).optional(),
  typical_price_points: z.array(clip(120)).optional().transform((a) => a?.slice(0, 6)),
});

// ---- outreach -------------------------------------------------------------

export const outreachSchema = z.object({
  /** Short summary of role + seniority, written for a seller. */
  role_summary: clip(300),
  likely_pain_points: z.array(clip(280)).min(1).transform((a) => a.slice(0, 5)),
  /** Concrete angles to lead with. */
  hooks: z.array(clip(280)).min(1).transform((a) => a.slice(0, 5)),
  /** Specific, citable talking points drawn from the research. */
  talking_points: z.array(clip(280)).optional().transform((a) => a?.slice(0, 5)),
  /** e.g. "direct, technical, results-focused". */
  tone_match: clipOpt(240).optional(),
  /** Ready-to-send opening lines, tailored to this person. */
  icebreakers: z.array(clip(320)).optional().transform((a) => a?.slice(0, 5)),
});

// ---- meta -----------------------------------------------------------------

export const sourceSchema = z.object({
  label: clip(160),
  url,
});

/** Model-fillable meta fields. */
const metaModelSchema = z.object({
  confidence: z.enum(["high", "medium", "low"]).optional(),
  /**
   * False only when the LinkedIn profile is member-gated AND no other
   * search angle surfaced verifiable role/company data. Callers should
   * treat false as "don't trust this output".
   */
  profile_accessible: z.boolean().optional(),
  sources: z.array(sourceSchema).optional().transform((a) => a?.slice(0, 12)),
  research_notes: clipOpt(900).optional(),
});

/** Code-filled meta fields — injected by research() after parse. */
const metaCodeSchema = z.object({
  researched_at: z.string(),
  model: z.string(),
  searches_used: z.number().min(0).optional(),
  schema_version: z.string(),
});

// ---- the tool schema (what the model outputs) -----------------------------

/**
 * Model-facing schema: everything EXCEPT the code-filled meta fields.
 * This is what becomes the Anthropic tool input_schema.
 */
export const researchToolSchema = z.object({
  person: personSchema,
  company: companySchema.optional(),
  competitors: z.array(competitorSchema).optional().transform((a) => a?.slice(0, 5)),
  commercials: commercialsSchema.optional(),
  outreach: outreachSchema,
  meta: metaModelSchema.optional(),
});

// ---- the full output shape ------------------------------------------------

export const prospectResearchSchema = researchToolSchema.extend({
  meta: metaModelSchema.merge(metaCodeSchema),
});

export type ProspectResearch = z.infer<typeof prospectResearchSchema>;
export type ResearchToolOutput = z.infer<typeof researchToolSchema>;
export type Person = z.infer<typeof personSchema>;
export type Company = z.infer<typeof companySchema>;
export type Competitor = z.infer<typeof competitorSchema>;
export type Commercials = z.infer<typeof commercialsSchema>;
export type Outreach = z.infer<typeof outreachSchema>;

// ---- input ----------------------------------------------------------------

export const researchInputSchema = z.object({
  linkedin_url: z
    .string()
    .url()
    .refine((u) => /linkedin\.com\/in\//i.test(u), {
      message: "must be a linkedin.com/in/… profile URL",
    }),
  /** The prospect company's website — anchors company research on the exact domain. */
  company_url: z.string().url().optional(),
  /** Known name; otherwise derived from the URL slug and verified by research. */
  name: z.string().max(120).optional(),
  /** Known company; otherwise resolved by research. */
  company: z.string().max(120).optional(),
  /** Anything you already know — feeds the research context. */
  notes: z.string().max(600).optional(),
});

export type ResearchInput = z.infer<typeof researchInputSchema>;
