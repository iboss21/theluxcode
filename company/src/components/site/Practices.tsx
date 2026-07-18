import { PRACTICES } from "@/data/practices";
import Reveal from "./Reveal";

export default function Practices() {
  return (
    <section id="practices" className="scroll-mt-24 border-t border-white/10">
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-28">
        <div className="grid gap-4 md:grid-cols-[0.9fr_1.1fr] md:items-end">
          <div>
            <div className="kicker">What we do</div>
            <h2 className="mt-4 font-display text-3xl text-silver md:text-4xl">Four practices</h2>
          </div>
          <p className="max-w-lg text-silver-faint md:justify-self-end md:text-right">
            One firm, four disciplines that reinforce each other — so the AI you ship is
            secured, the platform it runs on scales, and the cloud beneath it stays up.
          </p>
        </div>

        <div className="mt-16 divide-y divide-white/10 border-y border-white/10">
          {PRACTICES.map((p, i) => (
            <Reveal key={p.no} delay={i * 60}>
              <article className="svc-row group grid gap-6 py-8 md:grid-cols-[auto_1fr_1.4fr] md:items-baseline md:gap-10">
                <div className="font-display text-2xl text-gold/70">{p.no}</div>
                <h3 className="svc-title font-display text-xl text-silver transition-colors md:text-2xl">
                  {p.title}
                </h3>
                <p className="text-sm leading-relaxed text-silver-faint">{p.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
