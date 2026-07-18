"use client";
import { useState } from "react";
import Link from "next/link";
import {
  PRACTICE_OPTIONS,
  BUDGET_OPTIONS,
  TIMELINE_OPTIONS,
  SOURCE_OPTIONS,
} from "@/lib/config";

interface Result {
  ref: string;
  estimate: { low: number; expected: number; high: number; confidence: string; rationale: string };
}

const money = (n: number) => "$" + Number(n || 0).toLocaleString("en-US");

export default function ContactForm() {
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    setError("");
    const fd = new FormData(e.currentTarget);
    const payload = Object.fromEntries(fd.entries());
    try {
      const res = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.message || "Something went wrong. Please email info@likeaking.pro.");
        setStatus("error");
        return;
      }
      setResult(data);
      setStatus("done");
    } catch {
      setError("Network error. Please email info@likeaking.pro.");
      setStatus("error");
    }
  }

  return (
    <section id="contact" className="scroll-mt-24 border-t border-white/10">
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-28">
        <div className="contact-grid grid gap-16 lg:grid-cols-[1fr_1.1fr]">
          {/* aside */}
          <div className="contact-aside lg:sticky lg:top-28 lg:self-start">
            <div className="kicker">Let&apos;s scope your engagement</div>
            <h2 className="mt-5 font-display text-3xl leading-tight text-silver md:text-4xl">
              Let&apos;s talk.
            </h2>
            <p className="mt-6 max-w-md text-silver-dim">
              Share the shape of your project and we&apos;ll return a tailored estimate and next
              steps. We reply within one business day.
            </p>
            <ul className="mt-8 space-y-3 text-sm text-silver-faint">
              <li>· Confidential review. No obligation.</li>
              <li>· Enterprise NDAs on request.</li>
              <li>· A preliminary REGES estimate, by email, in seconds.</li>
            </ul>
            <div className="mt-10 gold-rule w-24" />
          </div>

          {/* form / result */}
          {status === "done" && result ? (
            <div className="rounded-lg border border-gold/40 bg-ink-800/60 p-8">
              <div className="kicker text-gold-light">Preliminary estimate · {result.ref}</div>
              <div className="mt-5 font-display text-4xl text-silver">
                {money(result.estimate.low)} – {money(result.estimate.high)}
              </div>
              <div className="mt-2 text-sm text-silver-faint">
                Expected {money(result.estimate.expected)} · {result.estimate.confidence} confidence
              </div>
              <p className="mt-6 text-sm leading-relaxed text-silver-dim">
                {result.estimate.rationale}
              </p>
              <p className="mt-6 text-xs leading-relaxed text-silver-ghost">
                We&apos;ve emailed you a copy and notified our team. A member of the team will follow
                up within one business day. This is an indicative range — not a formal quote or
                professional advice.
              </p>
            </div>
          ) : (
            <form
              onSubmit={onSubmit}
              className="rounded-lg border border-white/10 bg-white/[0.02] p-8 md:p-10"
            >
              {/* honeypot */}
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                className="hidden"
                aria-hidden
              />

              <div className="contact-form-grid grid gap-6 sm:grid-cols-2">
                <Field label="Name" req>
                  <input name="name" required className="f-input" placeholder="Your name" />
                </Field>
                <Field label="Work email" req>
                  <input
                    name="email"
                    type="email"
                    required
                    className="f-input"
                    placeholder="you@company.com"
                  />
                </Field>
                <Field label="Company">
                  <input name="company" className="f-input" placeholder="Company" />
                </Field>
                <Field label="Phone">
                  <input name="phone" className="f-input" placeholder="Optional" />
                </Field>
                <Field label="Practice" req>
                  <select name="practice" required defaultValue="" className="f-select">
                    <option value="" disabled>
                      Select a practice…
                    </option>
                    {PRACTICE_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Budget">
                  <select name="budget" defaultValue="" className="f-select">
                    <option value="">Select a range…</option>
                    {BUDGET_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Timeline">
                  <select name="timeline" defaultValue="" className="f-select">
                    <option value="">Select a timeline…</option>
                    {TIMELINE_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="How did you hear of us?">
                  <select name="source" defaultValue="" className="f-select">
                    <option value="">Optional…</option>
                    {SOURCE_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="mt-6">
                <Field label="Project details" req>
                  <textarea
                    name="details"
                    required
                    className="f-textarea"
                    placeholder="What are you trying to achieve? The more context, the sharper the estimate."
                  />
                </Field>
              </div>

              {status === "error" && (
                <p className="mt-4 text-sm text-[#c98a8a]">{error}</p>
              )}

              <button
                type="submit"
                disabled={status === "sending"}
                className="mt-8 w-full bg-silver px-8 py-4 text-[13px] font-medium uppercase tracking-wide text-ink transition-colors hover:bg-white disabled:opacity-60"
              >
                {status === "sending" ? "Sending…" : "Send & get my estimate"}
              </button>
              <p className="mt-4 text-[11px] leading-relaxed text-silver-ghost">
                Submitting sends your request to our team and returns a preliminary REGES estimate by
                email. By sending, you agree to our{" "}
                <Link href="/privacy" className="underline hover:text-silver-dim">
                  privacy policy
                </Link>
                .
              </p>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

function Field({
  label,
  req,
  children,
}: {
  label: string;
  req?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="f-field flex flex-col gap-2.5">
      <span className="text-[10px] font-normal uppercase tracking-[0.22em] text-silver-faint">
        {label} {req && <span className="text-[#9fb4d8]">*</span>}
      </span>
      {children}
    </label>
  );
}
