import Anthropic from "@anthropic-ai/sdk";

export const DEFAULT_MODEL = "claude-sonnet-4-6";

export type ProgressEvent =
  | { type: "start"; model: string }
  | { type: "search"; query: string; index: number }
  | { type: "fetch"; url: string; index: number }
  | { type: "thinking" }
  | { type: "output_started" }
  | { type: "done"; searchesUsed: number; fetchesUsed: number };

export type OnProgress = (event: ProgressEvent) => void;

/**
 * Run a tool-use call where the model is expected to ultimately call a
 * specific structured-output tool. Returns that tool call's input.
 *
 * If `webSearch` is true, the server-side web_search tool is added. If
 * `webFetch` is true, the server-side web_fetch tool is added — it retrieves
 * a specific URL directly, which rescues sites that search engines haven't
 * indexed (web_search can only find what's indexed). web_fetch only fetches
 * URLs already present in the conversation or in prior search results.
 *
 * With either server tool enabled, `tool_choice` stays on "auto" so the
 * model can search/fetch freely before calling the output tool. (Forcing
 * tool_choice to a specific tool blocks server tools entirely — they're
 * mutually exclusive.) Otherwise `tool_choice` is forced to the output tool
 * for deterministic single-call structured generation.
 *
 * Streams the response so callers get live progress events (one per web
 * search or fetch the model issues) — the CLI spinner and the web
 * playground both feed off `onProgress`.
 */
export async function callStructured<T>(args: {
  client: Anthropic;
  model?: string;
  systemPrompt: string;
  userMessage: string;
  toolName: string;
  toolDescription: string;
  toolInputSchema: Record<string, unknown>;
  cacheSystem?: boolean;
  webSearch?: boolean;
  webSearchMaxUses?: number;
  webFetch?: boolean;
  webFetchMaxUses?: number;
  maxTokens?: number;
  onProgress?: OnProgress;
  signal?: AbortSignal;
}): Promise<{ output: T; searchesUsed: number; fetchesUsed: number }> {
  const model = args.model ?? DEFAULT_MODEL;

  const tool = {
    name: args.toolName,
    description: args.toolDescription,
    input_schema: args.toolInputSchema as Anthropic.Tool.InputSchema,
  } as Anthropic.Tool;

  const tools: Anthropic.ToolUnion[] = [tool];
  if (args.webSearch) {
    tools.push({
      type: "web_search_20250305",
      name: "web_search",
      max_uses: args.webSearchMaxUses ?? 3,
    } as unknown as Anthropic.ToolUnion);
  }
  if (args.webFetch) {
    tools.push({
      type: "web_fetch_20250910",
      name: "web_fetch",
      max_uses: args.webFetchMaxUses ?? 4,
      // Bound the token cost of a single fetched page.
      max_content_tokens: 15000,
    } as unknown as Anthropic.ToolUnion);
  }

  const systemBlocks: Anthropic.TextBlockParam[] = args.cacheSystem
    ? [{ type: "text", text: args.systemPrompt, cache_control: { type: "ephemeral" } }]
    : [{ type: "text", text: args.systemPrompt }];

  const serverTools = Boolean(args.webSearch || args.webFetch);
  const toolChoice: Anthropic.MessageCreateParams["tool_choice"] = serverTools
    ? { type: "auto" }
    : { type: "tool", name: args.toolName };

  args.onProgress?.({ type: "start", model });

  const stream = args.client.messages.stream(
    {
      model,
      max_tokens: args.maxTokens ?? 4096,
      system: systemBlocks,
      tools,
      tool_choice: toolChoice,
      messages: [{ role: "user", content: args.userMessage }],
    },
    {
      signal: args.signal,
      // web_fetch shipped behind this beta header; harmless once GA.
      ...(args.webFetch
        ? { headers: { "anthropic-beta": "web-fetch-2025-09-10" } }
        : {}),
    },
  );

  // Surface per-search/per-fetch progress: each server_tool_use block is one
  // web search or one page fetch; its input streams in via input_json_delta.
  // We buffer the partial JSON per block and emit once the block closes.
  let searchesUsed = 0;
  let fetchesUsed = 0;
  const partialInputs = new Map<number, { kind: "search" | "fetch"; json: string }>();

  stream.on("streamEvent", (event) => {
    if (event.type === "content_block_start") {
      const block = event.content_block as { type?: string; name?: string };
      if (block.type === "server_tool_use" && block.name === "web_search") {
        partialInputs.set(event.index, { kind: "search", json: "" });
      } else if (block.type === "server_tool_use" && block.name === "web_fetch") {
        partialInputs.set(event.index, { kind: "fetch", json: "" });
      } else if (block.type === "tool_use") {
        args.onProgress?.({ type: "output_started" });
      }
    } else if (event.type === "content_block_delta") {
      const entry = partialInputs.get(event.index);
      if (entry && event.delta.type === "input_json_delta") {
        entry.json += event.delta.partial_json;
      }
    } else if (event.type === "content_block_stop") {
      const entry = partialInputs.get(event.index);
      if (entry?.kind === "search") {
        searchesUsed += 1;
        let query = "";
        try {
          query = (JSON.parse(entry.json || "{}") as { query?: string }).query ?? "";
        } catch {
          // partial JSON — leave query empty, still count the search
        }
        args.onProgress?.({ type: "search", query, index: searchesUsed });
        partialInputs.delete(event.index);
      } else if (entry?.kind === "fetch") {
        fetchesUsed += 1;
        let url = "";
        try {
          url = (JSON.parse(entry.json || "{}") as { url?: string }).url ?? "";
        } catch {
          // partial JSON — leave url empty, still count the fetch
        }
        args.onProgress?.({ type: "fetch", url, index: fetchesUsed });
        partialInputs.delete(event.index);
      }
    }
  });

  const response = await stream.finalMessage();
  args.onProgress?.({ type: "done", searchesUsed, fetchesUsed });

  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === args.toolName) {
      return { output: block.input as T, searchesUsed, fetchesUsed };
    }
  }
  throw new Error(
    `model did not call tool ${args.toolName}; stop_reason=${response.stop_reason}`,
  );
}
