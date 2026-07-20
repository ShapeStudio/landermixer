# landermixer

**Deep prospect research from any LinkedIn URL. Structured JSON out.**

One command runs a research agent that works through up to 12 targeted web searches — the person, their company, its competitors, funding, news, hiring, traffic, pricing — and returns a single validated JSON dossier you can pipe anywhere.

```bash
export ANTHROPIC_API_KEY=sk-ant-…
npx landermixer https://www.linkedin.com/in/zigakerec/ --company-url https://www.shape-labs.com
```

```jsonc
{
  "person": {
    "full_name": "Žiga Kerec",
    "current_role": { "title": "Founder & CTO", "company": "Shape (shape-labs.com)" },
    "recent_activity_themes": ["AI-native product development and agentic coding", "Venture studio model and co-building on equity terms"]
    // … headline, location, about, education, past_experience, skills, social_links
  },
  "company": {
    "name": "SHAPE",
    "domain": "shape-labs.com",
    "hq_location": "Ljubljana, Slovenia (also Berlin & New York)",
    "funding": { "total_raised_estimate": "Not publicly disclosed; no formal rounds found" },
    "hiring_signals": { "actively_hiring": false, "note": "Studio appears lean by design." },
    "recent_news": [{ "title": "Shape publishes 'agentic coding' editorial series", "why_it_matters": "Positioning for inbound from founder/operator buyers in 2026." }]
    // … summary, industry, founded_year, products, positioning, tech_stack
  },
  "competitors": [
    { "name": "Altar.io", "note": "Product studio building MVPs for startups…", "vs_positioning": "Shape runs its own products in production — proof-of-practice vs. pure services…" }
  ],
  "commercials": {
    "pricing_model": "project + retainer B2B, equity co-builds",
    "typical_price_points": ["Process automation: cuts ops cost from ~€2,000/mo to ~€300/mo"]
    // … web_traffic_estimate + numeric twins for downstream math
  },
  "outreach": {
    "likely_pain_points": ["Standing out against cheap offshore dev shops…"],
    "hooks": ["Every automation Shape sells has already survived production on its own P&L…"],
    "icebreakers": ["Saw the agentic-coding series — how much of Shape's client work ships through Claude Code these days?"]
    // … role_summary, talking_points, tone_match
  },
  "meta": {
    "confidence": "medium",
    "sources": [{ "label": "Shape — official site", "url": "https://www.shape-labs.com" }],
    "searches_used": 10, "schema_version": "1"
    // … profile_accessible, research_notes, researched_at, model
  }
}
```

Full example (a real, unedited run on our own founder's profile): [`examples/sample-output.json`](examples/sample-output.json).

## Install & use

```bash
# one-off
npx landermixer <linkedin-url>

# or install
npm i -g landermixer
landermixer <linkedin-url> --pretty
```

**Single prospect**

```bash
landermixer https://linkedin.com/in/jane-doe --company-url https://acme.com
landermixer https://linkedin.com/in/jane-doe --json | jq '.outreach.hooks'
landermixer https://linkedin.com/in/jane-doe --depth deep --out jane.json
```

**Batch (CSV)**

```bash
landermixer --csv prospects.csv --out results/ --concurrency 3
```

The CSV needs a `linkedin_url` column; `company_url`, `name`, `company`, `notes` are optional ([example](examples/prospects.example.csv)). One JSON file per prospect lands in `--out`; a bad row never aborts the batch (exit code `3` signals partial failure).

JSON goes to **stdout**, progress to **stderr** — pipe-safe by design.

## Library

```ts
import { research, researchMany, prospectResearchSchema } from "landermixer";

const dossier = await research(
  { linkedin_url: "https://linkedin.com/in/jane-doe", company_url: "https://acme.com" },
  { depth: "standard", onProgress: (e) => console.error(e) },
);
// dossier is fully typed (ProspectResearch) and already validated
```

`researchMany(inputs, { concurrency })` runs a bounded pool with per-row error isolation. The zod schemas (`prospectResearchSchema`, `researchInputSchema`) are exported — validate stored dossiers, generate types, build on top.

## Keys & cost

| Key | Required | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Runs the research agent (Claude + web search). [console.anthropic.com](https://console.anthropic.com) |
| `PROXYCURL_API_KEY` | no | Verified LinkedIn profile data — rescues member-gated profiles. [nubela.co/proxycurl](https://nubela.co/proxycurl) |

Keys load from env vars or a `.env` in the working directory. **Approximate cost per prospect** (you pay your providers directly, we take nothing):

| Depth | Web searches | Typical cost |
|---|---|---|
| `standard` | up to 12 | ~$0.30–0.45 |
| `deep` | up to 16 | ~$0.50–0.60 |

Made of: Anthropic tokens (~$0.20–0.35), web-search fees ($0.01/search), optional Proxycurl (~$0.01).

## How it sources data

The agent uses **public web search** (plus Proxycurl's API if you provide a key). It does not log into LinkedIn, does not scrape behind auth walls, and marks everything unverifiable as an estimate with its basis — or leaves it empty. `meta.sources` lists every page that informed the dossier; `meta.confidence` and `meta.research_notes` tell you how much to trust it.

## Schema stability

The output shape is versioned via `meta.schema_version` (currently `"1"`). Breaking shape changes bump it alongside a major package release.

## What's next

Personalized one-pagers and sales decks generated from this research + your own uploaded deck — the research layer you're holding is the foundation. Watch this repo.

## License

[MIT](LICENSE) · built by [SHAPE](https://www.shape-labs.com) · [landermixer.com](https://landermixer.com)
