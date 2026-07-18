"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Inquiry, Status } from "@/lib/types";
import type { Metrics } from "@/lib/store";

const STATUSES: Status[] = ["new", "reviewing", "quoted", "won", "lost"];
const STATUS_LABEL: Record<Status, string> = {
  new: "New",
  reviewing: "Reviewing",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
};
const STATUS_TINT: Record<Status, string> = {
  new: "text-gold-light border-gold/40",
  reviewing: "text-[#9fb4d8] border-[#9fb4d8]/40",
  quoted: "text-silver border-white/30",
  won: "text-[#7fd1a3] border-[#7fd1a3]/40",
  lost: "text-silver-ghost border-white/15",
};

const money = (n: number | null | undefined) => "$" + Number(n || 0).toLocaleString("en-US");

async function api(action: string, extra: Record<string, unknown> = {}) {
  const res = await fetch("/api/crm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...extra }),
  });
  return res;
}

export default function CrmApp() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Status | "all">("all");

  const refresh = useCallback(async () => {
    const [l, m] = await Promise.all([api("list"), api("metrics")]);
    if (l.status === 401) {
      setAuthed(false);
      return;
    }
    const ld = await l.json();
    const md = await m.json();
    setInquiries(ld.inquiries || []);
    setMetrics(md);
    setAuthed(true);
  }, []);

  useEffect(() => {
    (async () => {
      const s = await (await api("session")).json();
      if (s.authed) refresh();
      else setAuthed(false);
    })();
  }, [refresh]);

  const selected = useMemo(
    () => inquiries.find((i) => i.id === selId) || null,
    [inquiries, selId]
  );

  const filtered = useMemo(
    () => (filter === "all" ? inquiries : inquiries.filter((i) => i.status === filter)),
    [inquiries, filter]
  );

  if (authed === null) {
    return <div className="grid min-h-screen place-items-center text-silver-faint">Loading…</div>;
  }
  if (!authed) {
    return <Login onSuccess={refresh} />;
  }

  return (
    <div className="min-h-screen">
      <TopBar
        metrics={metrics}
        onLogout={async () => {
          await api("logout");
          setAuthed(false);
        }}
      />

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          {/* list */}
          <div>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
                All · {inquiries.length}
              </FilterChip>
              {STATUSES.map((s) => (
                <FilterChip key={s} active={filter === s} onClick={() => setFilter(s)}>
                  {STATUS_LABEL[s]} · {metrics?.counts[s] || 0}
                </FilterChip>
              ))}
            </div>

            <div className="thin-scroll max-h-[calc(100vh-220px)] space-y-2 overflow-y-auto pr-1">
              {filtered.length === 0 && (
                <p className="py-16 text-center text-sm text-silver-faint">
                  No leads here yet. Submissions from the site land in <strong>New</strong>.
                </p>
              )}
              {filtered.map((inq) => (
                <button
                  key={inq.id}
                  onClick={() => setSelId(inq.id)}
                  className={`w-full rounded-md border p-4 text-left transition-colors ${
                    selId === inq.id
                      ? "border-gold/50 bg-gold/[0.06]"
                      : "border-white/10 bg-white/[0.02] hover:border-white/25"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-display text-silver">{inq.name}</div>
                      <div className="text-xs text-silver-faint">
                        {inq.company || "—"} · {inq.practice}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-sm border px-2 py-0.5 text-[10px] uppercase tracking-wide ${STATUS_TINT[inq.status]}`}
                    >
                      {STATUS_LABEL[inq.status]}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="text-silver-dim">
                      {money(inq.quote_amount ?? inq.ai_expected)}
                    </span>
                    <span className="text-silver-ghost">
                      {inq.ref} · {new Date(inq.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* detail */}
          <div>
            {selected ? (
              <Detail key={selected.id} inq={selected} onChange={refresh} />
            ) : (
              <div className="grid h-64 place-items-center rounded-lg border border-white/10 text-sm text-silver-faint">
                Select a lead to open the cockpit.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Login ─────────────────────────────────────────────────────────────────── */
function Login({ onSuccess }: { onSuccess: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid min-h-screen place-items-center px-6">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(false);
          const r = await (await api("login", { password: pw })).json();
          setBusy(false);
          if (r.ok) onSuccess();
          else setErr(true);
        }}
        className="w-full max-w-sm rounded-lg border border-white/10 bg-white/[0.02] p-8"
      >
        <div className="flex items-baseline gap-2">
          <span className="font-display text-xl text-silver">Like a King</span>
          <span className="text-[10px] tracking-[0.25em] text-gold">INC.</span>
        </div>
        <div className="kicker mt-4">Operations Cockpit</div>
        <p className="mt-2 text-sm text-silver-faint">REGES revenue &amp; pipeline. Team access only.</p>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Password"
          className={`f-input mt-6 ${err ? "f-err" : ""}`}
          autoFocus
        />
        {err && <p className="mt-2 text-xs text-[#c98a8a]">Incorrect password.</p>}
        <button
          type="submit"
          disabled={busy}
          className="mt-6 w-full bg-silver px-6 py-3 text-[13px] font-medium uppercase tracking-wide text-ink transition-colors hover:bg-white disabled:opacity-60"
        >
          {busy ? "Checking…" : "Enter"}
        </button>
      </form>
    </div>
  );
}

/* ── Top bar with metrics ──────────────────────────────────────────────────── */
function TopBar({ metrics, onLogout }: { metrics: Metrics | null; onLogout: () => void }) {
  return (
    <div className="border-b border-white/10 bg-ink-900/70 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-lg text-silver">Like a King</span>
          <span className="text-[10px] tracking-[0.25em] text-gold">INC.</span>
          <span className="ml-3 text-xs text-silver-faint">Operations Cockpit</span>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <Metric label="Pipeline" value={money(metrics?.pipeline_value)} />
          <Metric label="Won" value={money(metrics?.won_value)} />
          <Metric label="Conversion" value={`${metrics?.conversion ?? 0}%`} />
          <Metric label="Leads" value={String(metrics?.total ?? 0)} />
          <button
            onClick={onLogout}
            className="text-xs text-silver-faint underline hover:text-silver"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="font-display text-lg text-silver">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-silver-ghost">{label}</div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? "border-gold/60 bg-gold/10 text-silver"
          : "border-white/10 text-silver-faint hover:border-white/25"
      }`}
    >
      {children}
    </button>
  );
}

/* ── Detail panel ──────────────────────────────────────────────────────────── */
function Detail({ inq, onChange }: { inq: Inquiry; onChange: () => void }) {
  const [quote, setQuote] = useState(inq.quote_amount?.toString() ?? "");
  const [note, setNote] = useState("");
  const [remind, setRemind] = useState("");
  const [suggestion, setSuggestion] = useState<null | {
    action: string;
    why: string;
    draft: string;
    priority: string;
    live: boolean;
  }>(null);
  const [suggesting, setSuggesting] = useState(false);

  async function setStatus(status: Status) {
    await api("update", { id: inq.id, status });
    onChange();
  }
  async function saveQuote() {
    await api("update", { id: inq.id, quote_amount: quote === "" ? null : Number(quote) });
    onChange();
  }
  async function saveNote() {
    if (!note.trim()) return;
    await api("note", { id: inq.id, body: note.trim(), remind_at: remind || null });
    setNote("");
    setRemind("");
    onChange();
  }
  async function suggest() {
    setSuggesting(true);
    setSuggestion(null);
    const r = await (await api("suggest", { id: inq.id })).json();
    setSuggesting(false);
    if (r.suggestion) setSuggestion(r.suggestion);
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl text-silver">{inq.name}</h2>
          <p className="text-sm text-silver-faint">
            {inq.company || "—"} ·{" "}
            <a href={`mailto:${inq.email}`} className="hover:text-silver">
              {inq.email}
            </a>
            {inq.phone ? ` · ${inq.phone}` : ""}
          </p>
          <p className="mt-1 text-xs text-silver-ghost">
            {inq.ref} · {inq.practice} · via {inq.channel} ·{" "}
            {new Date(inq.created_at).toLocaleString()}
          </p>
        </div>
      </div>

      {/* status pills */}
      <div className="mt-5 flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-sm border px-3 py-1 text-[11px] uppercase tracking-wide transition-colors ${
              inq.status === s
                ? STATUS_TINT[s] + " bg-white/[0.05]"
                : "border-white/10 text-silver-faint hover:border-white/25"
            }`}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {/* estimate */}
      <div className="mt-6 rounded-md border border-gold/30 p-5">
        <div className="kicker text-gold-light">REGES estimate · {inq.ai_confidence} confidence</div>
        <div className="mt-3 font-display text-2xl text-silver">
          {money(inq.ai_low)} – {money(inq.ai_high)}
          <span className="ml-2 text-sm text-silver-faint">
            expected {money(inq.ai_expected)}
          </span>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-silver-faint">{inq.ai_rationale}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-silver-dim">
          <span className="text-silver-ghost">Budget: {inq.budget || "—"}</span>
          <span className="text-silver-ghost">Timeline: {inq.timeline || "—"}</span>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <span className="text-xs text-silver-faint">Human quote override</span>
          <input
            value={quote}
            onChange={(e) => setQuote(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="—"
            className="f-input max-w-[140px] py-1 text-sm"
          />
          <button
            onClick={saveQuote}
            className="border border-white/20 px-3 py-1 text-xs text-silver-dim hover:border-gold hover:text-silver"
          >
            Save
          </button>
        </div>
      </div>

      {/* REGES next-best-action */}
      <div className="mt-6 rounded-md border border-white/12 p-5">
        <div className="flex items-center justify-between">
          <div className="kicker">REGES · next best action</div>
          <button
            onClick={suggest}
            disabled={suggesting}
            className="border border-gold/40 px-3 py-1 text-xs text-gold-light hover:bg-gold/10 disabled:opacity-50"
          >
            {suggesting ? "Thinking…" : suggestion ? "Regenerate" : "Ask REGES"}
          </button>
        </div>
        {suggestion ? (
          <div className="mt-4">
            <div className="flex items-center gap-2">
              <span
                className={`rounded-sm border px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                  suggestion.priority === "high"
                    ? "border-gold/50 text-gold-light"
                    : suggestion.priority === "medium"
                    ? "border-[#9fb4d8]/40 text-[#9fb4d8]"
                    : "border-white/15 text-silver-ghost"
                }`}
              >
                {suggestion.priority} priority
              </span>
              <span className="font-display text-silver">{suggestion.action}</span>
              {!suggestion.live && (
                <span className="text-[10px] text-silver-ghost">· guided</span>
              )}
            </div>
            <p className="mt-2 text-sm text-silver-faint">{suggestion.why}</p>
            <div className="mt-3 rounded-md border border-white/10 bg-white/[0.02] p-4">
              <div className="text-[10px] uppercase tracking-wide text-silver-ghost">
                Suggested follow-up
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-silver-dim">
                {suggestion.draft}
              </p>
              <button
                onClick={() => navigator.clipboard?.writeText(suggestion.draft)}
                className="mt-3 text-xs text-silver-faint underline hover:text-silver"
              >
                Copy draft
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-silver-faint">
            Ask REGES what to do next with this lead — it reads the status, age, estimate, and your
            notes, then drafts the follow-up.
          </p>
        )}
      </div>

      {/* details */}
      <div className="mt-6">
        <div className="kicker mb-2">Project details</div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-silver-dim">{inq.details}</p>
      </div>

      {/* notes */}
      <div className="mt-6">
        <div className="kicker mb-3">Notes &amp; reminders</div>
        <div className="space-y-2">
          {inq.notes.length === 0 && (
            <p className="text-sm text-silver-ghost">No notes yet.</p>
          )}
          {inq.notes.map((n) => (
            <div key={n.id} className="rounded-md border border-white/8 bg-white/[0.02] p-3 text-sm">
              <p className="text-silver-dim">{n.body}</p>
              <div className="mt-1 text-[11px] text-silver-ghost">
                {new Date(n.created_at).toLocaleString()}
                {n.remind_at ? ` · remind ${n.remind_at}` : ""}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note…"
            className="f-textarea min-h-[60px] flex-1 text-sm"
          />
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={remind}
              onChange={(e) => setRemind(e.target.value)}
              className="f-input py-1 text-xs"
            />
            <button
              onClick={saveNote}
              className="bg-silver px-4 py-2 text-xs font-medium uppercase tracking-wide text-ink hover:bg-white"
            >
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
