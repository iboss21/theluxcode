import { APPLIED_INTELLIGENCE } from "@/data/practices";
import Reveal from "./Reveal";

const MODELS = ["OpenAI", "Anthropic", "Meta Llama", "Mistral", "Google", "Local / on-prem"];

export default function AppliedIntelligence() {
  return (
    <section id="intelligence" className="scroll-mt-24 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/4 top-0 h-96 w-96 rounded-full bg-gold/5 blur-[120px]" />
      </div>
      <div className="relative mx-auto max-w-6xl px-6 py-24 md:py-28">
        <Reveal>
          <div className="kicker">Applied Intelligence — 02</div>
          <h2 className="mt-5 max-w-3xl font-display text-3xl leading-tight text-silver md:text-5xl">
            AI that earns its place in the enterprise.
          </h2>
          <p className="mt-6 max-w-2xl text-silver-dim">
            We don&apos;t ship demos. We engineer AI systems that sit inside real workflows —
            measured, governed, and secured to the same standard as the rest of your infrastructure.
          </p>
        </Reveal>

        <div className="mt-16 grid gap-px overflow-hidden rounded border border-white/10 bg-white/5 md:grid-cols-3">
          {APPLIED_INTELLIGENCE.map((c, i) => (
            <Reveal key={c.title} delay={i * 80}>
              <div className="h-full bg-ink-800 p-8 transition-colors hover:bg-ink-700">
                <div className="mb-5 h-8 w-8 rounded-sm border border-gold/40 text-gold grid place-items-center text-sm">
                  {String(i + 1).padStart(2, "0")}
                </div>
                <h3 className="font-display text-lg text-silver">{c.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-silver-faint">{c.body}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <div className="mt-14">
          <div className="kicker mb-5">Built on the models that matter</div>
          <div className="flex flex-wrap gap-3">
            {MODELS.map((m) => (
              <span
                key={m}
                className="border border-white/10 bg-white/[0.02] px-4 py-2 text-xs text-silver-dim"
              >
                {m}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
