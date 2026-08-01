// RegesCore gateway configuration. Brand and engineering by davidio.dev.

import { createConfigSchematics } from "@lmstudio/sdk";

export const configSchematics = createConfigSchematics()
  .field(
    "model",
    "string",
    {
      displayName: "Upstream model ID",
      hint:
        "The model identifier sent to the endpoint. For LM Studio this is the " +
        "model key; for a hosted gateway it is whatever that gateway names the model.",
      placeholder: "regescore-1.0-35b-moe",
    },
    "",
  )
  .field(
    "doctrineMode",
    "select",
    {
      displayName: "RegesCore doctrine",
      hint:
        "Prepends the RegesCore // Fable 5 doctrine to the system prompt on every " +
        "request. The host application's own system prompt is kept and placed after " +
        "it, where it stays authoritative.",
      options: [
        { value: "full", displayName: "Full" },
        { value: "lean", displayName: "Lean (small context windows)" },
        { value: "off", displayName: "Off" },
      ],
    },
    "full",
  )
  .field(
    "temperature",
    "numeric",
    {
      displayName: "Temperature",
      hint: "Sent as temperature. Leave at 0.7 unless the upstream model wants otherwise.",
      slider: { min: 0, max: 2, step: 0.05 },
    },
    0.7,
  )
  .field(
    "maxTokens",
    "numeric",
    {
      displayName: "Max output tokens",
      hint:
        "Upper bound on the response. Anthropic-format endpoints require this field, " +
        "so it is always sent.",
      slider: { min: 256, max: 131072, step: 256 },
    },
    8192,
  )
  .field(
    "sendTools",
    "boolean",
    {
      displayName: "Forward tool definitions",
      hint:
        "Pass the tools LM Studio offers through to the upstream endpoint. Turn off " +
        "when the upstream rejects the tool schema.",
    },
    true,
  )
  .build();

export const globalConfigSchematics = createConfigSchematics()
  .field(
    "baseUrl",
    "string",
    {
      displayName: "Endpoint base URL",
      hint:
        "Base URL including the version segment. The plugin appends " +
        "/chat/completions for the OpenAI format and /messages for the Anthropic " +
        "format.",
      placeholder: "http://127.0.0.1:1234/v1",
    },
    "http://127.0.0.1:1234/v1",
  )
  .field(
    "apiFormat",
    "select",
    {
      displayName: "API format",
      hint:
        "OpenAI speaks POST /v1/chat/completions. Anthropic speaks POST /v1/messages " +
        "and is what Claude Code itself uses.",
      options: [
        { value: "openai", displayName: "OpenAI - /v1/chat/completions" },
        { value: "anthropic", displayName: "Anthropic - /v1/messages" },
      ],
    },
    "openai",
  )
  .field(
    "apiKey",
    "string",
    {
      displayName: "API key",
      hint:
        "Sent as Authorization: Bearer for the OpenAI format and as x-api-key for " +
        "the Anthropic format. Leave empty for a local endpoint that does not check it.",
      isProtected: true,
    },
    "",
  )
  .field(
    "extraHeaders",
    "string",
    {
      displayName: "Extra headers",
      hint:
        "A JSON object of additional request headers, for gateways that need routing " +
        "or tenancy headers. Invalid JSON is reported and ignored.",
      isParagraph: true,
      placeholder: "{\"x-team-id\": \"lux\"}",
    },
    "",
  )
  .field(
    "timeoutSeconds",
    "numeric",
    {
      displayName: "Request timeout (seconds)",
      hint:
        "Aborts a request that produces no further output. Agent turns on a local " +
        "model with a large prompt can legitimately take minutes.",
      slider: { min: 30, max: 3600, step: 30 },
    },
    900,
  )
  .build();
