"use client";
import { useEffect, useRef, useState } from "react";

type Turn = { role: "user" | "assistant"; content: string };

const GREETING: Turn = {
  role: "assistant",
  content:
    "I'm REGES — the concierge for Like a King Inc. Tell me the challenge you're facing and I'll point you to where our work fits, or help you get a tailored estimate.",
};

export default function Concierge() {
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState<boolean | null>(null);
  const [msgs, setMsgs] = useState<Turn[]>([GREETING]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, open]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const history = msgs.filter((m) => m !== GREETING);
    setMsgs((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/reges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });
      const data = await res.json();
      setLive(!!data.live);
      setMsgs((m) => [...m, { role: "assistant", content: data.reply || "…" }]);
    } catch {
      setMsgs((m) => [
        ...m,
        {
          role: "assistant",
          content:
            "REGES is unavailable just now — please use the enquiry form and the team will follow up within a business day.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* launcher */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-full border border-gold/40 bg-ink-800/90 px-5 py-3 text-sm text-silver shadow-lg backdrop-blur transition-transform hover:-translate-y-0.5"
        aria-label="Ask REGES"
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-gold opacity-75 animate-blink" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-gold" />
        </span>
        {open ? "Close" : "Ask REGES"}
      </button>

      {open && (
        <div className="fixed bottom-24 right-6 z-50 flex h-[520px] w-[min(92vw,380px)] animate-chatpop flex-col overflow-hidden rounded-lg border border-white/12 bg-ink-900/95 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <div>
              <div className="font-display text-silver">REGES · Concierge</div>
              <div className="text-[11px] text-silver-faint">
                {live === false ? "Guided mode" : "Scoped · guard-railed"}
              </div>
            </div>
            <div className="text-[10px] tracking-[0.2em] text-gold">INC.</div>
          </div>

          <div ref={scrollRef} className="thin-scroll flex-1 space-y-4 overflow-y-auto px-5 py-5">
            {msgs.map((m, i) => (
              <div
                key={i}
                className={`max-w-[85%] text-sm leading-relaxed ${
                  m.role === "user"
                    ? "ml-auto rounded-lg rounded-br-sm bg-silver/10 px-4 py-2.5 text-silver"
                    : "mr-auto text-silver-dim"
                }`}
              >
                {m.content}
              </div>
            ))}
            {busy && <div className="text-sm text-silver-faint">REGES is thinking…</div>}
          </div>

          <div className="border-t border-white/10 p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                placeholder="Ask about our work…"
                className="f-textarea min-h-[40px] max-h-28 flex-1 border-0 border-b border-white/15 px-2 py-2 text-sm"
              />
              <button
                onClick={send}
                disabled={busy}
                className="bg-silver px-4 py-2 text-xs font-medium uppercase tracking-wide text-ink transition-colors hover:bg-white disabled:opacity-50"
              >
                Send
              </button>
            </div>
            <p className="mt-2 px-1 text-[10px] leading-snug text-silver-ghost">
              Illustrative only — not a proposal, quote, or professional advice.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
