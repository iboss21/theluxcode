// RegesCore gateway generator. Brand and engineering by davidio.dev.
//
// Replaces the local model with any OpenAI-compatible /v1/chat/completions or
// Anthropic-compatible /v1/messages endpoint, streaming both text and tool
// calls back into LM Studio.

import { type GeneratorController, type Chat, type LLMTool } from "@lmstudio/sdk";
import { configSchematics, globalConfigSchematics } from "./config";
import { mapHistory, type MappedHistory, type WireMessage } from "./history";
import { ReasoningRouter } from "./reasoning";
import { readSse } from "./sse";
import { type DoctrineMode } from "./doctrine.generated";

interface Settings {
  baseUrl: string;
  apiFormat: "openai" | "anthropic";
  apiKey: string;
  extraHeaders: Record<string, string>;
  timeoutMs: number;
  model: string;
  temperature: number;
  maxTokens: number;
  sendTools: boolean;
  doctrineMode: DoctrineMode;
}

interface PendingToolCall {
  id: string;
  name: string;
  argumentsText: string;
  started: boolean;
  nameSent: boolean;
}

export async function generate(ctl: GeneratorController, history: Chat): Promise<void> {
  const settings = readSettings(ctl);
  const mapped = mapHistory(history, settings.doctrineMode);

  if (mapped.droppedAttachments > 0) {
    // GeneratorController has no status channel, so the notice goes into the
    // response itself. Saying nothing would mean silently dropping the user's
    // attachment and letting the model claim it cannot see an image that was
    // in fact never sent.
    ctl.fragmentGenerated(
      `[RegesCore gateway] ${mapped.droppedAttachments} message(s) carry file ` +
        "attachments. This gateway forwards text and tool calls only, so the " +
        "attachments were not sent upstream. Use a local vision model for images.\n\n",
    );
  }

  const tools = settings.sendTools ? ctl.getToolDefinitions() : [];
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), settings.timeoutMs);
  const signal = anySignal([ctl.abortSignal, timeout.signal]);

  try {
    const response = await fetch(buildUrl(settings), {
      method: "POST",
      headers: buildHeaders(settings),
      body: JSON.stringify(buildBody(settings, mapped, tools)),
      signal,
    });

    if (!response.ok || response.body === null) {
      throw new Error(await describeFailure(response));
    }

    if (settings.apiFormat === "anthropic") {
      await streamAnthropic(ctl, response.body, signal);
    } else {
      await streamOpenAI(ctl, response.body, signal);
    }
  } catch (error) {
    if (ctl.abortSignal.aborted) {
      return; // The user stopped generation; not a failure worth reporting.
    }
    if (timeout.signal.aborted) {
      throw new Error(
        `RegesCore gateway: no response within ${settings.timeoutMs / 1000}s from ` +
          `${settings.baseUrl}. Raise the timeout, or check that the endpoint streams.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function readSettings(ctl: GeneratorController): Settings {
  const config = ctl.getPluginConfig(configSchematics);
  const global = ctl.getGlobalPluginConfig(globalConfigSchematics);

  // A malformed header block is a configuration error, not something to
  // paper over: routing or tenancy headers that quietly vanish send the
  // request somewhere the user did not intend.
  const extraHeaders: Record<string, string> = {};
  const rawHeaders = global.get("extraHeaders").trim();
  if (rawHeaders.length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawHeaders);
    } catch (error) {
      throw new Error(
        `RegesCore gateway: extra headers are not valid JSON - ${(error as Error).message}`,
      );
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("RegesCore gateway: extra headers must be a JSON object");
    }
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      extraHeaders[key] = String(value);
    }
  }

  return {
    baseUrl: global.get("baseUrl").trim().replace(/\/+$/, ""),
    apiFormat: global.get("apiFormat") as "openai" | "anthropic",
    apiKey: global.get("apiKey").trim(),
    extraHeaders,
    timeoutMs: global.get("timeoutSeconds") * 1000,
    model: config.get("model").trim(),
    temperature: config.get("temperature"),
    maxTokens: config.get("maxTokens"),
    sendTools: config.get("sendTools"),
    doctrineMode: config.get("doctrineMode") as DoctrineMode,
  };
}

function buildUrl(settings: Settings): string {
  return settings.apiFormat === "anthropic"
    ? `${settings.baseUrl}/messages`
    : `${settings.baseUrl}/chat/completions`;
}

function buildHeaders(settings: Settings): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "text/event-stream",
    ...settings.extraHeaders,
  };
  if (settings.apiFormat === "anthropic") {
    headers["anthropic-version"] = "2023-06-01";
    if (settings.apiKey.length > 0) {
      headers["x-api-key"] = settings.apiKey;
    }
  } else if (settings.apiKey.length > 0) {
    headers.authorization = `Bearer ${settings.apiKey}`;
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

function buildBody(
  settings: Settings,
  mapped: MappedHistory,
  tools: Array<LLMTool>,
): Record<string, unknown> {
  return settings.apiFormat === "anthropic"
    ? buildAnthropicBody(settings, mapped, tools)
    : buildOpenAIBody(settings, mapped, tools);
}

function buildOpenAIBody(
  settings: Settings,
  mapped: MappedHistory,
  tools: Array<LLMTool>,
): Record<string, unknown> {
  const messages: Array<Record<string, unknown>> = [];
  if (mapped.system.length > 0) {
    messages.push({ role: "system", content: mapped.system });
  }

  for (const message of mapped.messages) {
    if (message.toolResults.length > 0) {
      for (const result of message.toolResults) {
        messages.push({
          role: "tool",
          tool_call_id: result.id,
          content: result.content,
        });
      }
      if (message.text.length === 0) {
        continue;
      }
    }
    if (message.role === "assistant") {
      const entry: Record<string, unknown> = {
        role: "assistant",
        content: message.text,
      };
      if (message.toolCalls.length > 0) {
        entry.tool_calls = message.toolCalls.map(call => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        }));
      }
      messages.push(entry);
      continue;
    }
    messages.push({ role: "user", content: message.text });
  }

  const body: Record<string, unknown> = {
    model: settings.model,
    messages,
    stream: true,
    temperature: settings.temperature,
    max_tokens: settings.maxTokens,
  };
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  return body;
}

function buildAnthropicBody(
  settings: Settings,
  mapped: MappedHistory,
  tools: Array<LLMTool>,
): Record<string, unknown> {
  const messages: Array<Record<string, unknown>> = [];

  for (const message of mapped.messages) {
    const content: Array<Record<string, unknown>> = [];
    for (const result of message.toolResults) {
      content.push({
        type: "tool_result",
        tool_use_id: result.id,
        content: result.content,
      });
    }
    if (message.text.length > 0) {
      content.push({ type: "text", text: message.text });
    }
    for (const call of message.toolCalls) {
      content.push({
        type: "tool_use",
        id: call.id,
        name: call.name,
        input: call.arguments,
      });
    }
    if (content.length === 0) {
      continue;
    }
    messages.push({ role: message.role, content });
  }

  const body: Record<string, unknown> = {
    model: settings.model,
    messages,
    stream: true,
    temperature: settings.temperature,
    // Required by the Anthropic Messages API, unlike the OpenAI format.
    max_tokens: settings.maxTokens,
  };
  if (mapped.system.length > 0) {
    body.system = mapped.system;
  }
  if (tools.length > 0) {
    body.tools = tools.map(tool => ({
      name: tool.function.name,
      description: tool.function.description ?? "",
      input_schema: tool.function.parameters ?? { type: "object", properties: {} },
    }));
  }
  return body;
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

async function streamOpenAI(
  ctl: GeneratorController,
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<void> {
  const router = new ReasoningRouter();
  const pending = new Map<number, PendingToolCall>();

  for await (const event of readSse(body, signal)) {
    if (event.data === "[DONE]") {
      break;
    }
    const chunk = parseJson(event.data);
    if (chunk === null) {
      continue;
    }
    const delta = chunk?.choices?.[0]?.delta;
    if (delta === undefined || delta === null) {
      continue;
    }

    // Qwen and DeepSeek style servers put reasoning in its own field.
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
      ctl.fragmentGenerated(delta.reasoning_content, { reasoningType: "reasoning" });
    }
    if (typeof delta.content === "string" && delta.content.length > 0) {
      emitSegments(ctl, router.push(delta.content));
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const raw of delta.tool_calls) {
        const index = typeof raw.index === "number" ? raw.index : 0;
        let call = pending.get(index);
        if (call === undefined) {
          call = {
            id: typeof raw.id === "string" ? raw.id : "",
            name: "",
            argumentsText: "",
            started: false,
            nameSent: false,
          };
          pending.set(index, call);
        }
        if (typeof raw.id === "string" && raw.id.length > 0) {
          call.id = raw.id;
        }
        if (!call.started) {
          ctl.toolCallGenerationStarted(
            call.id.length > 0 ? { toolCallId: call.id } : {},
          );
          call.started = true;
        }
        const name = raw.function?.name;
        if (typeof name === "string" && name.length > 0 && !call.nameSent) {
          call.name = name;
          ctl.toolCallGenerationNameReceived(name);
          call.nameSent = true;
        }
        const args = raw.function?.arguments;
        if (typeof args === "string" && args.length > 0) {
          call.argumentsText += args;
          ctl.toolCallGenerationArgumentFragmentGenerated(args);
        }
      }
    }
  }

  emitSegments(ctl, router.flush());
  finishToolCalls(ctl, [...pending.values()]);
}

async function streamAnthropic(
  ctl: GeneratorController,
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<void> {
  const router = new ReasoningRouter();
  const blocks = new Map<number, PendingToolCall>();

  for await (const event of readSse(body, signal)) {
    const payload = parseJson(event.data);
    if (payload === null) {
      continue;
    }
    const type = payload.type ?? event.event;

    if (type === "content_block_start") {
      const block = payload.content_block;
      if (block?.type === "tool_use") {
        const call: PendingToolCall = {
          id: typeof block.id === "string" ? block.id : "",
          name: typeof block.name === "string" ? block.name : "",
          argumentsText: "",
          started: true,
          nameSent: false,
        };
        blocks.set(payload.index, call);
        ctl.toolCallGenerationStarted(call.id.length > 0 ? { toolCallId: call.id } : {});
        if (call.name.length > 0) {
          ctl.toolCallGenerationNameReceived(call.name);
          call.nameSent = true;
        }
      }
      continue;
    }

    if (type === "content_block_delta") {
      const delta = payload.delta;
      if (delta?.type === "text_delta" && typeof delta.text === "string") {
        emitSegments(ctl, router.push(delta.text));
      } else if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
        ctl.fragmentGenerated(delta.thinking, { reasoningType: "reasoning" });
      } else if (
        delta?.type === "input_json_delta" &&
        typeof delta.partial_json === "string"
      ) {
        const call = blocks.get(payload.index);
        if (call !== undefined) {
          call.argumentsText += delta.partial_json;
          ctl.toolCallGenerationArgumentFragmentGenerated(delta.partial_json);
        }
      }
      continue;
    }

    if (type === "error") {
      throw new Error(
        `RegesCore gateway: upstream error - ${JSON.stringify(payload.error ?? payload)}`,
      );
    }

    if (type === "message_stop") {
      break;
    }
  }

  emitSegments(ctl, router.flush());
  finishToolCalls(ctl, [...blocks.values()]);
}

function emitSegments(
  ctl: GeneratorController,
  segments: ReturnType<ReasoningRouter["push"]>,
): void {
  for (const segment of segments) {
    ctl.fragmentGenerated(segment.text, { reasoningType: segment.reasoningType });
  }
}

function finishToolCalls(ctl: GeneratorController, calls: Array<PendingToolCall>): void {
  for (const call of calls) {
    if (!call.started) {
      continue;
    }
    if (call.name.length === 0) {
      ctl.toolCallGenerationFailed(
        new Error("upstream produced a tool call with no function name"),
      );
      continue;
    }
    const trimmed = call.argumentsText.trim();
    let args: Record<string, unknown> = {};
    if (trimmed.length > 0) {
      const parsed = parseJson(trimmed);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        ctl.toolCallGenerationFailed(
          new Error(
            `tool call ${call.name} produced arguments that are not a JSON object: ${trimmed}`,
          ),
        );
        continue;
      }
      args = parsed as Record<string, unknown>;
    }
    ctl.toolCallGenerationEnded({
      type: "function",
      id: call.id.length > 0 ? call.id : undefined,
      name: call.name,
      arguments: args,
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function describeFailure(response: Response): Promise<string> {
  let detail = "";
  try {
    detail = (await response.text()).slice(0, 2000);
  } catch {
    detail = "<no response body>";
  }
  return `RegesCore gateway: upstream returned ${response.status} ${response.statusText}. ${detail}`;
}

/** Node 18 lacks AbortSignal.any in some builds, so compose manually. */
function anySignal(signals: Array<AbortSignal>): AbortSignal {
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
}
