import Nav from "@/components/site/Nav";
import Hero from "@/components/site/Hero";
import Practices from "@/components/site/Practices";
import AppliedIntelligence from "@/components/site/AppliedIntelligence";
import Faq from "@/components/site/Faq";
import ContactForm from "@/components/site/ContactForm";
import Footer from "@/components/site/Footer";
import Concierge from "@/components/site/Concierge";
import Reveal from "@/components/site/Reveal";

export default function Home() {
  return (
    <main className="relative">
      <Nav />
      <Hero />

      {/* manifesto band */}
      <section className="border-t border-white/10">
        <div className="mx-auto max-w-4xl px-6 py-24 text-center">
          <Reveal>
            <p className="font-display text-2xl leading-relaxed text-silver md:text-3xl">
              Innovation demonstrated at every step, not performed for its own sake. We build the
              quiet machinery enterprises depend on — and stand behind it.
            </p>
          </Reveal>
        </div>
      </section>

      <Practices />
      <AppliedIntelligence />

      {/* REGES-on-this-page band */}
      <section className="border-t border-white/10">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-24 md:grid-cols-[1.1fr_0.9fr] md:items-center">
          <Reveal>
            <div className="kicker">This site runs on our own AI</div>
            <h2 className="mt-5 font-display text-3xl leading-tight text-silver md:text-4xl">
              The concierge on this page is ours.
            </h2>
            <p className="mt-6 max-w-xl text-silver-dim">
              REGES is a live example of what we build — a scoped, guard-railed assistant that only
              speaks for the firm, never oversteps, and never handles what it shouldn&apos;t. It
              answers visitors, routes work to the right practice, and prices engagements. Ask it
              anything using the button in the corner.
            </p>
          </Reveal>
          <Reveal delay={100}>
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-8">
              <div className="flex items-center gap-3 text-sm text-silver-dim">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-gold opacity-75 animate-blink" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-gold" />
                </span>
                REGES · scoped &amp; guard-railed
              </div>
              <ul className="mt-6 space-y-3 text-sm text-silver-faint">
                <li>— Speaks only for Like a King Inc.</li>
                <li>— Routes enquiries to the right practice</li>
                <li>— Returns a preliminary estimate in seconds</li>
                <li>— Docks into your own AI brain (self-hosted or API)</li>
              </ul>
            </div>
          </Reveal>
        </div>
      </section>

      <Faq />
      <ContactForm />
      <Footer />
      <Concierge />
    </main>
  );
}
