import { research, type ResearchOptions } from "./research.js";
import type { ProspectResearch, ResearchInput } from "./schema.js";

export type BatchResult =
  | { input: ResearchInput; ok: true; result: ProspectResearch }
  | { input: ResearchInput; ok: false; error: string };

export interface BatchOptions extends Omit<ResearchOptions, "onProgress" | "signal"> {
  /** Parallel researches. Default 3 — friendly to API rate limits. */
  concurrency?: number;
  /** Called as each row settles (in completion order). */
  onRow?: (result: BatchResult, doneCount: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * Research many prospects with a bounded promise pool. Per-row failures are
 * isolated — one bad URL never aborts the batch.
 */
export async function researchMany(
  inputs: ResearchInput[],
  opts: BatchOptions = {},
): Promise<BatchResult[]> {
  const concurrency = Math.max(1, opts.concurrency ?? 3);
  const results: BatchResult[] = new Array(inputs.length);
  let next = 0;
  let done = 0;

  async function worker(): Promise<void> {
    for (;;) {
      if (opts.signal?.aborted) return;
      const i = next++;
      if (i >= inputs.length) return;
      const input = inputs[i]!;
      try {
        const result = await research(input, {
          anthropicApiKey: opts.anthropicApiKey,
          proxycurlApiKey: opts.proxycurlApiKey,
          model: opts.model,
          depth: opts.depth,
          webSearchMaxUses: opts.webSearchMaxUses,
          signal: opts.signal,
        });
        results[i] = { input, ok: true, result };
      } catch (err) {
        results[i] = {
          input,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      done += 1;
      opts.onRow?.(results[i]!, done, inputs.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker()),
  );
  return results;
}
