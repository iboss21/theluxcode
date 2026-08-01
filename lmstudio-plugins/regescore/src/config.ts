// RegesCore // Fable 5 plugin configuration. Brand and engineering by davidio.dev.

import { createConfigSchematics } from "@lmstudio/sdk";

export const configSchematics = createConfigSchematics()
  .field(
    "doctrineTrigger",
    "string",
    {
      displayName: "Doctrine trigger",
      hint:
        "Typing this word in a message expands it into the full RegesCore // Fable 5 " +
        "doctrine. Use it once at the start of a chat; the expansion is stored in the " +
        "chat history, so it does not need repeating.",
      placeholder: "@regescore",
    },
    "@regescore",
  )
  .field(
    "doctrineMode",
    "select",
    {
      displayName: "Doctrine size",
      hint:
        "How much of the doctrine the trigger inserts. Full is roughly 2,000 tokens. " +
        "Lean keeps identity, precedence, the truth law, effort calibration, the " +
        "operating principles and the final standard, at roughly 700 tokens.",
      options: [
        { value: "full", displayName: "Full" },
        { value: "lean", displayName: "Lean (small context windows)" },
        { value: "off", displayName: "Off" },
      ],
    },
    "full",
  )
  .field(
    "expandDirectives",
    "boolean",
    {
      displayName: "Expand directives",
      hint:
        "Expand @sonnet, @opus, @fable5, @audit, @debug, @redm and @verify into " +
        "their directive blocks.",
    },
    true,
  )
  .field(
    "operatingReminder",
    "boolean",
    {
      displayName: "Prepend operating reminder",
      hint:
        "Add a one-line reminder to every message: act when ready, lead with the " +
        "outcome, stay in scope, verify before claiming done, label uncertainty. " +
        "Costs about 60 tokens per message and is stored in the chat history.",
    },
    false,
  )
  .field(
    "showStatus",
    "boolean",
    {
      displayName: "Show status line",
      hint: "Report in the chat when the plugin rewrites a message.",
    },
    true,
  )
  .build();

export const globalConfigSchematics = createConfigSchematics()
  .field(
    "workspaceNote",
    "string",
    {
      displayName: "Standing project context",
      hint:
        "Appended to every doctrine expansion, in every chat. Use it for facts that " +
        "are always true of your environment, such as the stack you run, the paths " +
        "that matter, or the conventions you expect. Leave empty to disable.",
      isParagraph: true,
      placeholder:
        "Example: primary stack is Next.js on Coolify, Postgres 16, RedM servers run LXRCore.",
    },
    "",
  )
  .build();
