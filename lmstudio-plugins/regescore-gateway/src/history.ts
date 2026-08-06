// Chat history mapping. Brand and engineering by davidio.dev.

import { type Chat, type ChatMessage } from "@lmstudio/sdk";
import { getDoctrine, type DoctrineMode } from "./doctrine.generated";

export interface WireToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface WireToolResult {
  id: string;
  content: string;
}

export interface WireMessage {
  role: "user" | "assistant";
  text: string;
  toolCalls: Array<WireToolCall>;
  toolResults: Array<WireToolResult>;
}

export interface MappedHistory {
  /** Merged system text: doctrine first, host system prompt after it. */
  system: string;
  messages: Array<WireMessage>;
  /** Number of messages carrying file attachments, which are not forwarded. */
  droppedAttachments: number;
}

let toolCallCounter = 0;

function ensureId(id: string | undefined): string {
  if (id !== undefined && id.length > 0) {
    return id;
  }
  toolCallCounter += 1;
  return `regescore_call_${toolCallCounter}`;
}

/**
 * Flattens an LM Studio Chat into a transport-neutral shape.
 *
 * The doctrine goes first and the host system prompt after it, matching the
 * precedence the doctrine itself declares: the profile sets standards, the host
 * owns the protocol, and on conflict the host wins because it is read last.
 */
export function mapHistory(history: Chat, doctrineMode: DoctrineMode): MappedHistory {
  const systemParts: Array<string> = [];
  const doctrine = getDoctrine(doctrineMode);
  if (doctrine !== null) {
    systemParts.push(doctrine);
  }

  const messages: Array<WireMessage> = [];
  let droppedAttachments = 0;

  for (const message of history.getMessagesArray()) {
    const role = message.getRole();

    if (role === "system") {
      const text = message.getText().trim();
      if (text.length > 0) {
        systemParts.push(`# Host application instructions (authoritative)\n${text}`);
      }
      continue;
    }

    if (message.hasFiles()) {
      droppedAttachments += 1;
    }

    if (role === "tool") {
      const results = message.getToolCallResults().map(result => ({
        id: ensureId(result.toolCallId),
        content: result.content,
      }));
      if (results.length === 0) {
        continue;
      }
      appendToolResults(messages, results);
      continue;
    }

    if (role === "assistant") {
      const toolCalls = message.getToolCallRequests().map(request => ({
        id: ensureId(request.id),
        name: request.name,
        arguments: request.arguments ?? {},
      }));
      messages.push({
        role: "assistant",
        text: message.getText(),
        toolCalls,
        toolResults: [],
      });
      continue;
    }

    messages.push({
      role: "user",
      text: message.getText(),
      toolCalls: [],
      toolResults: [],
    });
  }

  return { system: systemParts.join("\n\n"), messages, droppedAttachments };
}

/**
 * Tool results belong to the user side of the exchange. Consecutive results are
 * merged into one user message so a parallel tool call round trips as a single
 * turn, which is what both wire formats expect.
 */
function appendToolResults(
  messages: Array<WireMessage>,
  results: Array<WireToolResult>,
): void {
  const last = messages[messages.length - 1];
  if (last !== undefined && last.role === "user" && last.text.length === 0) {
    last.toolResults.push(...results);
    return;
  }
  messages.push({ role: "user", text: "", toolCalls: [], toolResults: results });
}

export function isBlank(message: ChatMessage): boolean {
  return message.getText().trim().length === 0;
}
