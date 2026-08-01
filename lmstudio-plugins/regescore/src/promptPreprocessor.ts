// RegesCore // Fable 5 prompt preprocessor. Brand and engineering by davidio.dev.
//
// LM Studio runs this when the user hits Send, and stores whatever it returns
// in the chat history. That has two consequences the design follows:
//
//   1. Injection must be idempotent. A doctrine block prepended to every
//      message would be persisted every time and would fill the context window
//      within a handful of turns. So the full doctrine is expansion-triggered:
//      it goes in once, where the user asked for it, and stays there.
//   2. The preprocessor sees only the current user message, never the history.
//      There is no API to inspect earlier turns or to rewrite the system
//      prompt from here, so "inject once per chat" cannot be detected. The
//      trigger word is the detection mechanism.
//
// For an always-on system prompt use a preset, or the regescore-gateway
// plugin, which owns the whole request and injects the doctrine itself.

import { type ChatMessage, type PromptPreprocessorController } from "@lmstudio/sdk";
import { configSchematics, globalConfigSchematics } from "./config";
import { OPERATING_REMINDER, expandDirectives } from "./directives";
import { getDoctrine, type DoctrineMode } from "./doctrine.generated";

const CREDIT = "RegesCore // Fable 5 - davidio.dev";

export async function preprocess(
  ctl: PromptPreprocessorController,
  userMessage: ChatMessage,
): Promise<string> {
  const config = ctl.getPluginConfig(configSchematics);
  const globalConfig = ctl.getGlobalPluginConfig(globalConfigSchematics);

  let text = userMessage.getText();
  const notes: Array<string> = [];

  const trigger = config.get("doctrineTrigger").trim();
  const mode = config.get("doctrineMode") as DoctrineMode;
  if (trigger.length > 0 && text.includes(trigger)) {
    const doctrine = getDoctrine(mode);
    if (doctrine === null) {
      // The user kept the trigger but turned the doctrine off. Remove the
      // trigger rather than leaving a stray token in the prompt.
      text = text.split(trigger).join("").trim();
      notes.push("doctrine off");
    } else {
      const workspaceNote = globalConfig.get("workspaceNote").trim();
      const block =
        workspaceNote.length > 0
          ? `${doctrine}\n\n# STANDING PROJECT CONTEXT\n${workspaceNote}`
          : doctrine;
      text = text.split(trigger).join(block).trim();
      notes.push(`doctrine: ${mode}`);
    }
  }

  if (config.get("expandDirectives")) {
    const expansion = expandDirectives(text);
    if (expansion.applied.length > 0) {
      text = expansion.text;
      notes.push(...expansion.applied.map(directive => directive.label));
    }
  }

  if (config.get("operatingReminder")) {
    text = `${OPERATING_REMINDER}\n\n${text}`;
    notes.push("operating reminder");
  }

  if (notes.length > 0 && config.get("showStatus")) {
    const status = ctl.createStatus({
      status: "done",
      text: `${CREDIT} - ${notes.join(", ")}`,
    });
    // The status block belongs to this preprocessing pass only.
    ctl.onAborted(() => status.remove());
  }

  return text;
}
