import Anthropic from "@anthropic-ai/sdk";

export const DEFAULT_MODEL = "claude-sonnet-4-6";

export type ProgressEvent =
  | { type: "start"; model: string }
  | { type: "search"; query: string; index: number }
  | { type: "thinking" }
  | { type: "output_started" }
  | { type: "done"; searchesUsed: number };

export type OnProgress = (event: ProgressEvent) => void;

/**
 * Run a tool-use call where the model is expected to ultimately call a
 * specific structured-output tool. Returns that tool call's input.
 *
 * If `webSearch` is true, the server-side web_search tool is added and
 * `tool_choice` stays on "auto" so the model can search freely before
 * calling the output tool. (Forcing tool_choice to a specific tool blocks
 * web_search entirely — they're mutually exclusive.)
 *
 * If `webSearch` is false, `tool_choice` is forced to the output tool for
 * deterministic single-call structured generation.
 *
 * Streams the response so callers get live progress events (one per web
 * search the model issues) — the CLI spinner and the web playground both
 * feed off `onProgress`.
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
  maxTokens?: number;
  onProgress?: OnProgress;
  signal?: AbortSignal;
}): Promise<{ output: T; searchesUsed: number }> {
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

  const systemBlocks: Anthropic.TextBlockParam[] = args.cacheSystem
    ? [{ type: "text", text: args.systemPrompt, cache_control: { type: "ephemeral" } }]
    : [{ type: "text", text: args.systemPrompt }];

  const toolChoice: Anthropic.MessageCreateParams["tool_choice"] = args.webSearch
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
    { signal: args.signal },
  );

  // Surface per-search progress: each server_tool_use block is one web
  // search; its input.query streams in via input_json_delta. We buffer the
  // partial JSON per block and emit once the block closes.
  let searchesUsed = 0;
  const partialInputs = new Map<number, { kind: "search" | "other"; json: string }>();

  stream.on("streamEvent", (event) => {
    if (event.type === "content_block_start") {
      const block = event.content_block as { type?: string; name?: string };
      if (block.type === "server_tool_use" && block.name === "web_search") {
        partialInputs.set(event.index, { kind: "search", json: "" });
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
      }
    }
  });

  const response = await stream.finalMessage();
  args.onProgress?.({ type: "done", searchesUsed });

  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === args.toolName) {
      return { output: block.input as T, searchesUsed };
    }
  }
  throw new Error(
    `model did not call tool ${args.toolName}; stop_reason=${response.stop_reason}`,
  );
}
