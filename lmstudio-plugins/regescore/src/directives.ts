// RegesCore // Fable 5 directives. Brand and engineering by davidio.dev.
//
// Trigger words a user can type in a message. Each expands in place to a
// directive block. Expansion happens once, in the message that contains the
// trigger, and the expanded text is what LM Studio stores in the chat history.

/** A reminder small enough to prepend to every message without crowding context. */
export const OPERATING_REMINDER = [
  "[RegesCore] Act when you have enough information. Lead with the outcome.",
  "Stay in scope. Verify before claiming done, and show the evidence.",
  "Label uncertainty as FACT, INFERENCE or UNKNOWN. Never invent an API, a flag, or a result.",
].join(" ");

export interface Directive {
  /** The literal trigger, including its leading @. */
  trigger: string;
  /** Shown in the plugin status line when the trigger fires. */
  label: string;
  /** Replacement text. */
  body: string;
}

export const DIRECTIVES: Array<Directive> = [
  {
    trigger: "@sonnet",
    label: "effort: sonnet",
    body: [
      "EFFORT: SONNET. Fast, balanced, correct - the workhorse setting.",
      "Act directly on well-specified work. Verify briefly. Do not over-plan,",
      "do not explore alternatives that the task does not need, and do not",
      "write a plan for something you can simply do.",
    ].join(" "),
  },
  {
    trigger: "@opus",
    label: "effort: opus",
    body: [
      "EFFORT: OPUS. Maximal rigor. Reframe the problem, decompose it, explore",
      "several solutions, then attack your own design: what breaks, what scales",
      "badly, which assumption fails, what is the hidden risk. Converge with the",
      "tradeoff stated. Verify exhaustively and adversarially before claiming",
      "anything is done.",
    ].join(" "),
  },
  {
    trigger: "@fable5",
    label: "effort: fable 5",
    body: [
      "EFFORT: FABLE 5. End-to-end autonomy. Take the task from start to finish,",
      "resolve ambiguity with a stated assumption rather than a question, and",
      "verify as you build. Pause only for a destructive action, a real scope",
      "change, or input only the user holds. Before ending the turn, re-read your",
      "last paragraph: if it is a plan, a question you could answer yourself, or a",
      "promise of work, do that work now instead of describing it.",
    ].join(" "),
  },
  {
    trigger: "@audit",
    label: "security audit",
    body: [
      "MODE: SECURITY REVIEW. Analyze as an attacker, then improve as a defender.",
      "Walk the attack surface, the trust boundaries, the privilege boundaries and",
      "the abuse cases. For each finding give the concrete failure scenario, the",
      "affected file and line, and the fix. Never fabricate a finding: if something",
      "is unverified, label it UNKNOWN and say what would verify it.",
    ].join(" "),
  },
  {
    trigger: "@debug",
    label: "debug protocol",
    body: [
      "MODE: DEBUG. Follow the sequence: observe, reproduce, instrument, measure,",
      "isolate, hypothesize, test, fix, verify, prevent recurrence. Do not stop at",
      "the first plausible explanation, and do not propose a fix before you have",
      "reproduced the failure or traced it to a specific line.",
    ].join(" "),
  },
  {
    trigger: "@redm",
    label: "redm / fivem runtime",
    body: [
      "MODE: GAME SERVER RUNTIME. Target the RedM and FiveM stack: FXServer, LuaJIT,",
      "LXRCore, RSGCore, VorpCore, QBCore and ESX. Respect server and client",
      "boundaries, use asynchronous persistence through oxmysql, manage server-side",
      "threads deliberately, and keep fxmanifest.lua and Tebex escrow packaging",
      "correct. Never invent a native or an export: verify it exists.",
    ].join(" "),
  },
  {
    trigger: "@verify",
    label: "verification pass",
    body: [
      "MODE: VERIFY. Treat the work in front of you as a hypothesis, not a",
      "deliverable. Run it or trace it. Check each claim against actual output.",
      "Simulate the failure paths. Report what you ran and what it printed. If a",
      "test fails, show the failure. If a step was skipped, say so.",
    ].join(" "),
  },
];

export interface ExpansionResult {
  text: string;
  applied: Array<Directive>;
}

/** Replaces every known trigger in the text. Unmatched triggers are left alone. */
export function expandDirectives(text: string): ExpansionResult {
  let result = text;
  const applied: Array<Directive> = [];
  for (const directive of DIRECTIVES) {
    if (!result.includes(directive.trigger)) {
      continue;
    }
    result = result.split(directive.trigger).join(directive.body);
    applied.push(directive);
  }
  return { text: result, applied };
}
