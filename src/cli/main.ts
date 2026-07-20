// landermixer CLI — deep prospect research from any LinkedIn URL.
//
//   npx landermixer <linkedin-url> [--company-url <url>] [--depth standard|deep]
//   npx landermixer --csv prospects.csv --out results/ --concurrency 3
//
// JSON goes to stdout (pipe-friendly); all progress goes to stderr.
// Exit codes: 0 ok · 1 usage/config error · 2 total failure · 3 partial batch failure.

import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import { research } from "../research.js";
import { researchMany } from "../batch.js";
import type { ResearchDepth } from "../research.js";
import type { ResearchInput } from "../schema.js";
import { parseProspectsCsv } from "./csv.js";
import { makeProgressRenderer, log, ok, fail } from "./progress.js";

loadDotenv();

const HELP = `landermixer — deep prospect research from any LinkedIn URL. Structured JSON out.

Usage:
  landermixer <linkedin-url> [options]         research one prospect
  landermixer --csv <file> --out <dir> [opts]  research a CSV of prospects

Options:
  --company-url <url>    the prospect company's website (anchors company research)
  --notes <text>         anything you already know — feeds the research
  --depth <d>            standard (13 searches, default) | deep (17 searches)
  --model <id>           Anthropic model id (default claude-sonnet-4-6)
  --csv <file>           batch mode: CSV with a linkedin_url column
                         (optional columns: company_url, name, company, notes)
  --out <file|dir>       write JSON to a file (single) or directory (batch)
  --concurrency <n>      parallel researches in batch mode (default 3)
  --json                 compact JSON output (default when piped)
  --pretty               pretty-printed JSON (default on a TTY)
  --quiet                no progress output
  -h, --help             show this help
  -v, --version          show version

Environment:
  ANTHROPIC_API_KEY      required — https://console.anthropic.com
  PROXYCURL_API_KEY      optional — verified LinkedIn data for gated profiles

Examples:
  landermixer https://www.linkedin.com/in/zigakerec/ --pretty
  landermixer https://linkedin.com/in/jane-doe --company-url https://acme.com | jq .outreach.hooks
  landermixer --csv prospects.csv --out results/ --concurrency 3
`;

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "prospect"
  );
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "company-url": { type: "string" },
      notes: { type: "string" },
      depth: { type: "string" },
      model: { type: "string" },
      csv: { type: "string" },
      out: { type: "string" },
      concurrency: { type: "string" },
      json: { type: "boolean" },
      pretty: { type: "boolean" },
      quiet: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });

  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (values.version) {
    // package.json is bundled one level above dist/cli/
    const pkg = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    process.stdout.write(pkg.version + "\n");
    return 0;
  }

  const depth = (values.depth ?? "standard") as ResearchDepth;
  if (depth !== "standard" && depth !== "deep") {
    fail(`--depth must be "standard" or "deep", got "${values.depth}"`);
    return 1;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    fail(
      "ANTHROPIC_API_KEY is not set.\n  Get a key at https://console.anthropic.com and either:\n    export ANTHROPIC_API_KEY=sk-ant-…\n  or put it in a .env file in this directory.",
    );
    return 1;
  }

  const pretty = values.pretty ?? (process.stdout.isTTY && !values.json);
  const serialize = (obj: unknown) =>
    pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj);

  // ---- batch mode ----------------------------------------------------------
  if (values.csv) {
    if (!existsSync(values.csv)) {
      fail(`CSV not found: ${values.csv}`);
      return 1;
    }
    let inputs: ResearchInput[];
    try {
      inputs = parseProspectsCsv(readFileSync(values.csv, "utf8"));
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
      return 1;
    }
    if (inputs.length === 0) {
      fail("CSV has no data rows");
      return 1;
    }
    const outDir = values.out ?? "results";
    mkdirSync(outDir, { recursive: true });
    const concurrency = Number(values.concurrency ?? 3) || 3;

    log(`researching ${inputs.length} prospects (concurrency ${concurrency})…`);
    const results = await researchMany(inputs, {
      depth,
      model: values.model,
      concurrency,
      onRow: (r, done, total) => {
        if (r.ok) {
          const name = r.result.person.full_name;
          const file = join(outDir, `${slugify(name)}.json`);
          writeFileSync(file, serialize(r.result) + "\n");
          ok(`[${done}/${total}] ${name} → ${file}`);
        } else {
          fail(`[${done}/${total}] ${r.input.linkedin_url}: ${r.error}`);
        }
      },
    });

    const failures = results.filter((r) => !r.ok).length;
    log("");
    log(`done: ${results.length - failures} ok, ${failures} failed`);
    if (failures === results.length) return 2;
    if (failures > 0) return 3;
    return 0;
  }

  // ---- single mode ---------------------------------------------------------
  const linkedinUrl = positionals[0];
  if (!linkedinUrl) {
    process.stderr.write(HELP);
    return 1;
  }

  try {
    const result = await research(
      {
        linkedin_url: linkedinUrl,
        company_url: values["company-url"],
        notes: values.notes,
      },
      {
        depth,
        model: values.model,
        onProgress: makeProgressRenderer(!!values.quiet),
      },
    );
    const out = serialize(result) + "\n";
    if (values.out) {
      writeFileSync(values.out, out);
      ok(`written to ${values.out}`);
    } else {
      process.stdout.write(out);
    }
    return 0;
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
    return 2;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    fail(err instanceof Error ? err.message : String(err));
    process.exit(2);
  },
);
