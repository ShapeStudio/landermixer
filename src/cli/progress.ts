// Stderr progress reporting — TTY-aware. stdout is reserved for JSON.

import type { ProgressEvent } from "../anthropic.js";

const isTTY = process.stderr.isTTY;

const dim = (s: string) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s);
const cyan = (s: string) => (isTTY ? `\x1b[36m${s}\x1b[0m` : s);
const green = (s: string) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s);
const red = (s: string) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s);

export function log(msg: string): void {
  process.stderr.write(msg + "\n");
}

export function ok(msg: string): void {
  log(green("✓ ") + msg);
}

export function fail(msg: string): void {
  log(red("✗ ") + msg);
}

/** Progress renderer for a single research run. */
export function makeProgressRenderer(quiet: boolean): (e: ProgressEvent) => void {
  if (quiet) return () => {};
  return (e) => {
    switch (e.type) {
      case "start":
        log(dim(`researching with ${e.model}…`));
        break;
      case "search":
        log(`  ${cyan("⌕")} ${e.query ? e.query : `search #${e.index}`}`);
        break;
      case "output_started":
        log(dim("  writing dossier…"));
        break;
      case "done":
        log(dim(`  ${e.searchesUsed} searches used`));
        break;
    }
  };
}
