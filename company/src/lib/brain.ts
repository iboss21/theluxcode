/**
 * REGES brain — the pluggable AI layer.
 *
 * Talks to any OpenAI-compatible endpoint (Odysseus, LM Studio, vLLM, OpenAI,
 * Together, Groq…) or the Anthropic Messages API. Every caller degrades to a
 * deterministic fallback if the brain is `off` or unreachable, so the company
 * platform never blocks on a model.
 */

type Msg = { role: "system" | "user" | "assistant"; content: string };

interface BrainCfg {
  provider: "off" | "openai" | "anthropic";
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export function brainConfig(): BrainCfg {
  const provider = (process.env.BRAIN_PROVIDER || "off").toLowerCase() as BrainCfg["provider"];
  return {
    provider: ["off", "openai", "anthropic"].includes(provider) ? provider : "off",
    baseUrl: process.env.BRAIN_BASE_URL || "http://127.0.0.1:8000/v1",
    apiKey: process.env.BRAIN_API_KEY || "",
    model: process.env.BRAIN_MODEL || "local-model",
    timeoutMs: Number(process.env.BRAIN_TIMEOUT_MS || 25000),
  };
}

export function brainEnabled(): boolean {
  return brainConfig().provider !== "off";
}

async function withTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Low-level: send a chat completion, return the assistant text (or null on any
 * failure / when the brain is off).
 */
export async function brainComplete(
  messages: Msg[],
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<string | null> {
  const cfg = brainConfig();
  if (cfg.provider === "off") return null;
  try {
    if (cfg.provider === "anthropic") return await callAnthropic(cfg, messages, opts);
    return await callOpenAI(cfg, messages, opts);
  } catch {
    return null;
  }
}

async function callOpenAI(
  cfg: BrainCfg,
  messages: Msg[],
  opts: { temperature?: number; maxTokens?: number }
): Promise<string | null> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const res = await withTimeout(
    `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: cfg.model,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 512,
        messages,
      }),
    },
    cfg.timeoutMs
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? null;
}

async function callAnthropic(
  cfg: BrainCfg,
  messages: Msg[],
  opts: { temperature?: number; maxTokens?: number }
): Promise<string | null> {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));
  let base = (cfg.baseUrl || "").replace(/\/$/, "");
  if (!/\/v1$/.test(base)) base = "https://api.anthropic.com/v1";
  const res = await withTimeout(
    `${base}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": cfg.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: opts.maxTokens ?? 512,
        temperature: opts.temperature ?? 0.3,
        system,
        messages: rest,
      }),
    },
    cfg.timeoutMs
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data?.content?.[0]?.text ?? null;
}

/** Pull the first JSON object out of a model response. */
export function extractJson<T = any>(text: string | null): T | null {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}
