import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/site/Nav";
import Footer from "@/components/site/Footer";
import Concierge from "@/components/site/Concierge";
import ArmoryGrid from "@/components/armory/ArmoryGrid";
import { ARMORY } from "@/data/armory";

export const metadata: Metadata = {
  title: "The Armory — Open-Source Arsenal",
  description:
    "Own the whole stack. Pay for none of it. A curated arsenal of self-hostable open-source tools that replace the SaaS bills — CRM, marketing, support, automation, local AI, and infra.",
};

export default function ArmoryPage() {
  const starter = ["n8n", "Ollama", "Twenty", "Coolify"];

  return (
    <main className="relative">
      <Nav />

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-32 left-1/3 h-[420px] w-[420px] rounded-full bg-gold/8 blur-[120px]" />
        </div>
        <div className="relative mx-auto max-w-6xl px-6 pt-36 pb-16 md:pt-44">
          <div className="kicker">The Armory · Open-Source Arsenal</div>
          <h1 className="mt-6 max-w-3xl font-display text-4xl leading-[1.05] text-silver md:text-6xl">
            Own the whole stack. <span className="text-gold-light">Pay for none of it.</span>
          </h1>
          <p className="mt-7 max-w-2xl text-silver-dim md:text-lg">
            The same tools we deploy for clients — {ARMORY.length} self-hostable, open-source systems
            that replace the SaaS bills. Stand a few up on one small VPS and cover most of what you
            were renting. We&apos;ll architect, deploy, secure, and operate them for you.
          </p>
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[12px] text-silver-ghost">
            <span>Star counts approximate · verify live on GitHub</span>
            <span>Check each license before commercial use</span>
          </div>
        </div>
      </section>

      {/* starter stack callout */}
      <section className="border-y border-white/10 bg-white/[0.02]">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <div className="grid gap-6 md:grid-cols-[auto_1fr] md:items-center">
            <div className="kicker text-gold-light">Recommended starter stack · one 8–16GB VPS</div>
            <p className="text-sm text-silver-faint">
              Don&apos;t boil the ocean. Stand up four tools first —{" "}
              <span className="text-silver">{starter.join(" · ")}</span> (automation + private AI +
              CRM + one-click deploy) — and you cover 90% of what the SaaS bills were doing. Add the
              rest as you feel the pinch.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <ArmoryGrid />

        <div className="mt-16 rounded-lg border border-gold/30 bg-ink-800/50 p-8 text-center md:p-12">
          <h2 className="font-display text-2xl text-silver md:text-3xl">
            No better way to expand your business opportunities.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-silver-dim">
            We&apos;ll pick the right tools for your needs, deploy them on infrastructure you own,
            wire them together, and keep them running — so you get enterprise capability without the
            enterprise invoice.
          </p>
          <Link
            href="/#contact"
            className="mt-8 inline-block bg-silver px-8 py-3.5 text-[13px] font-medium uppercase tracking-wide text-ink transition-colors hover:bg-white"
          >
            Have us build your stack
          </Link>
        </div>
      </section>

      <Footer />
      <Concierge />
    </main>
  );
}
