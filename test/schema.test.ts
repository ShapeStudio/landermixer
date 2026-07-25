import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  prospectResearchSchema,
  researchToolSchema,
  researchInputSchema,
  prospectSearchSchema,
  prospectSearchToolSchema,
  prospectLeadSchema,
  searchInputSchema,
  stripNulls,
} from "../src/schema.js";
import { parseProspectsCsv, parseCsv } from "../src/cli/csv.js";
import { nameFromLinkedinUrl } from "../src/research.js";

test("sample-output.json parses against prospectResearchSchema", () => {
  const sample = JSON.parse(
    readFileSync(new URL("../examples/sample-output.json", import.meta.url), "utf8"),
  );
  const parsed = prospectResearchSchema.parse(sample);
  assert.equal(typeof parsed.person.full_name, "string");
  assert.ok(parsed.outreach.hooks.length >= 1);
  assert.equal(typeof parsed.meta.researched_at, "string");
});

test("tool schema accepts a minimal model output", () => {
  const minimal = {
    person: { full_name: "Jane Doe" },
    outreach: {
      role_summary: "Mid-market operator",
      likely_pain_points: ["manual research"],
      hooks: ["automation angle"],
    },
  };
  const parsed = researchToolSchema.parse(minimal);
  assert.equal(parsed.person.full_name, "Jane Doe");
});

test("tool schema truncates over-long strings instead of failing", () => {
  const parsed = researchToolSchema.parse({
    person: { full_name: "x".repeat(500) },
    outreach: {
      role_summary: "y".repeat(2000),
      likely_pain_points: ["p"],
      hooks: ["h"],
    },
  });
  assert.equal(parsed.person.full_name.length, 120);
  assert.equal(parsed.outreach.role_summary.length, 300);
});

test("tool schema caps over-long arrays instead of failing", () => {
  const parsed = researchToolSchema.parse({
    person: { full_name: "Jane" },
    competitors: Array.from({ length: 12 }, (_, i) => ({
      name: `Comp ${i}`,
      note: "note",
    })),
    outreach: {
      role_summary: "r",
      likely_pain_points: Array.from({ length: 12 }, (_, i) => `pain ${i}`),
      hooks: ["h"],
    },
  });
  assert.equal(parsed.competitors?.length, 5);
  assert.equal(parsed.outreach.likely_pain_points.length, 5);
});

test("null-emitting model output parses after stripNulls (live-run regression)", () => {
  // An early live run failed on "personal_site": null before stripNulls
  // existed — models emit explicit nulls for unfillable optional fields.
  const modelOutput = {
    person: {
      full_name: "Jane Doe",
      headline: null,
      social_links: { twitter: null, github: null, personal_site: null },
      education: null,
    },
    company: null,
    outreach: {
      role_summary: "r",
      likely_pain_points: ["p"],
      hooks: ["h"],
      tone_match: null,
    },
    meta: { confidence: "medium", sources: null },
  };
  const parsed = researchToolSchema.parse(stripNulls(modelOutput));
  assert.equal(parsed.person.full_name, "Jane Doe");
  assert.equal(parsed.person.headline, undefined);
  assert.equal(parsed.company, undefined);
});

test("input schema rejects non-LinkedIn URLs", () => {
  assert.throws(() => researchInputSchema.parse({ linkedin_url: "https://example.com/x" }));
  assert.doesNotThrow(() =>
    researchInputSchema.parse({ linkedin_url: "https://www.linkedin.com/in/jane-doe/" }),
  );
});

test("nameFromLinkedinUrl derives a pretty name and drops hash suffixes", () => {
  assert.equal(
    nameFromLinkedinUrl("https://www.linkedin.com/in/ziga-kerec-72b3a8"),
    "Ziga Kerec",
  );
  assert.equal(nameFromLinkedinUrl("not a url"), "Unknown");
});

test("csv parser handles quotes, commas, CRLF", () => {
  const rows = parseCsv('a,"b,1","c""q"\r\nd,e,f\n');
  assert.deepEqual(rows, [
    ["a", "b,1", 'c"q'],
    ["d", "e", "f"],
  ]);
});

// ---- prospect search --------------------------------------------------------

test("sample-search-output.json parses against prospectSearchSchema", () => {
  const sample = JSON.parse(
    readFileSync(
      new URL("../examples/sample-search-output.json", import.meta.url),
      "utf8",
    ),
  );
  const parsed = prospectSearchSchema.parse(sample);
  assert.ok(parsed.icp.buyer_titles.length >= 1);
  assert.ok(parsed.prospects.length >= 1);
  assert.equal(typeof parsed.meta.searched_at, "string");
  assert.ok(["inferred", "provided"].includes(parsed.icp.icp_source));
});

test("search tool schema accepts a minimal model output", () => {
  const parsed = prospectSearchToolSchema.parse({
    icp: {
      company_name: "Acme",
      what_they_sell: "Developer tooling for platform teams.",
      buyer_titles: ["VP Engineering"],
    },
    prospects: [],
  });
  assert.equal(parsed.prospects.length, 0);
});

test("search tool schema truncates and caps instead of failing", () => {
  const lead = {
    full_name: "Jane Doe",
    title: "VP Ops",
    company: "Acme",
    why_relevant: "w".repeat(2000),
    source_url: "https://acme.example/team",
    confidence: "high",
  };
  const parsed = prospectSearchToolSchema.parse({
    icp: {
      company_name: "Acme",
      what_they_sell: "s",
      buyer_titles: Array.from({ length: 12 }, (_, i) => `Title ${i}`),
    },
    prospects: Array.from({ length: 30 }, () => ({ ...lead })),
  });
  assert.equal(parsed.icp.buyer_titles.length, 8);
  assert.equal(parsed.prospects.length, 25);
  assert.equal(parsed.prospects[0]?.why_relevant.length, 400);
});

test("null-emitting search output parses after stripNulls", () => {
  const modelOutput = {
    icp: {
      company_name: "Acme",
      company_domain: null,
      what_they_sell: "s",
      buyer_titles: ["CTO"],
      buying_triggers: null,
    },
    prospects: [
      {
        full_name: "Jane Doe",
        title: "CTO",
        company: "Beta GmbH",
        linkedin_url: null,
        location: null,
        why_relevant: "matches ICP",
        source_url: "https://beta.example/about",
        signals: null,
        confidence: "medium",
      },
    ],
    meta: { confidence: "medium", sources: null },
  };
  const parsed = prospectSearchToolSchema.parse(stripNulls(modelOutput));
  assert.equal(parsed.prospects[0]?.linkedin_url, undefined);
  assert.equal(parsed.icp.company_domain, undefined);
});

test("prospect linkedin_url keeps /in/ profiles and drops everything else", () => {
  const base = {
    full_name: "Jane Doe",
    title: "VP Ops",
    company: "Acme",
    why_relevant: "matches ICP",
    source_url: "https://acme.example/team",
    confidence: "high",
  };
  const kept = prospectLeadSchema.parse({
    ...base,
    linkedin_url: "https://www.linkedin.com/in/jane-doe/",
  });
  assert.equal(kept.linkedin_url, "https://www.linkedin.com/in/jane-doe/");
  for (const bad of [
    "https://www.linkedin.com/company/acme",   // company page
    "https://example.com/in/jane",             // wrong host
    "https://evil-linkedin.com/in/jane",       // lookalike host
    "not a url",
  ]) {
    const parsed = prospectLeadSchema.parse({ ...base, linkedin_url: bad });
    assert.equal(parsed.linkedin_url, undefined, `should drop: ${bad}`);
  }
});

test("search input schema validates url and count bounds", () => {
  assert.doesNotThrow(() =>
    searchInputSchema.parse({ company_url: "https://acme.com", count: 25 }),
  );
  assert.throws(() => searchInputSchema.parse({ company_url: "not a url" }));
  assert.throws(() => searchInputSchema.parse({ company_url: "https://acme.com", count: 0 }));
  assert.throws(() => searchInputSchema.parse({ company_url: "https://acme.com", count: 26 }));
});

test("prospects csv requires linkedin_url header and maps optional columns", () => {
  const rows = parseProspectsCsv(
    "linkedin_url,company_url,name\nhttps://linkedin.com/in/a,https://a.com,Ann\nhttps://linkedin.com/in/b,,\n",
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.company_url, "https://a.com");
  assert.equal(rows[1]?.name, undefined);
  assert.throws(() => parseProspectsCsv("name\nAnn\n"), /linkedin_url/);
});
