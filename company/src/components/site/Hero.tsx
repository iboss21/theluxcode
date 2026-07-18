import Link from "next/link";

export default function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* ambient background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[560px] w-[560px] rounded-full bg-gold/10 blur-[120px]" />
        <div className="absolute top-1/3 -right-40 h-[420px] w-[420px] rounded-full bg-[#1b3a6b]/30 blur-[130px]" />
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(205,214,228,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(205,214,228,.5) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
            maskImage: "radial-gradient(ellipse at 50% 30%, #000 30%, transparent 75%)",
          }}
        />
      </div>

      <div className="relative mx-auto max-w-6xl px-6 pt-40 pb-28 md:pt-48 md:pb-36">
        <div className="grid items-center gap-16 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <div className="kicker">Professional Business Services</div>
            <h1 className="mt-6 font-display text-4xl leading-[1.08] text-silver sm:text-5xl md:text-6xl">
              We treat technology as an instrument of the enterprise —
              <span className="text-gold-light"> precise, quiet, and built to endure.</span>
            </h1>
            <p className="mt-8 max-w-xl text-base leading-relaxed text-silver-dim md:text-lg">
              A practice built for business advisory and corporate technology —
              engineered, secured, and operated to the standard your enterprise runs on.
              Innovation demonstrated at every step, not performed for its own sake.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Link
                href="/#contact"
                className="bg-silver text-ink hover:bg-white px-7 py-3.5 text-[13px] font-medium tracking-wide uppercase transition-colors"
              >
                Scope your engagement
              </Link>
              <Link
                href="/#practices"
                className="border border-white/25 hover:border-silver-muted hover:bg-white/[0.04] px-7 py-3.5 text-[13px] tracking-wide uppercase text-silver-dim transition-colors"
              >
                What we do
              </Link>
            </div>

            <div className="mt-14 flex flex-wrap gap-x-10 gap-y-4 text-[12px] text-silver-faint">
              <span>NIST · ISO 27001 · SOC 2 aligned</span>
              <span>AWS · Azure · Google Cloud</span>
              <span>Reply within one business day</span>
            </div>
          </div>

          {/* HUD crest */}
          <div className="relative mx-auto hidden aspect-square w-full max-w-sm lg:block">
            <div className="absolute inset-0 animate-floaty">
              <div className="absolute inset-6 rounded-full border border-gold/30" />
              <div className="absolute inset-16 rounded-full border border-white/10" />
              <div
                className="absolute inset-0 rounded-full border border-dashed border-white/10"
                style={{ animation: "spin 40s linear infinite" }}
              />
              <div className="absolute inset-0 grid place-items-center">
                <div className="text-center">
                  <div className="font-display text-7xl text-gold-light">♛</div>
                  <div className="mt-3 kicker">Like a King</div>
                </div>
              </div>
              <span className="absolute left-1/2 top-3 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-gold animate-blink" />
              <span className="absolute right-6 top-1/2 h-1 w-1 rounded-full bg-silver-muted animate-blink" />
            </div>
          </div>
        </div>
      </div>
      <style
        dangerouslySetInnerHTML={{
          __html: "@keyframes spin{to{transform:rotate(360deg)}}",
        }}
      />
    </section>
  );
}
