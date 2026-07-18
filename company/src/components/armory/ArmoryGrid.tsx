"use client";
import { useState } from "react";
import { ARMORY, ARMORY_CATEGORIES } from "@/data/armory";

export default function ArmoryGrid() {
  const [cat, setCat] = useState<string>("All");
  const cats = ["All", ...ARMORY_CATEGORIES];
  const tools = cat === "All" ? ARMORY : ARMORY.filter((t) => t.category === cat);

  return (
    <div>
      {/* filter rail */}
      <div className="thin-scroll -mx-6 mb-10 flex gap-2 overflow-x-auto px-6 pb-1">
        {cats.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={`whitespace-nowrap border px-4 py-2 text-xs transition-colors ${
              cat === c
                ? "border-gold/60 bg-gold/10 text-silver"
                : "border-white/10 text-silver-faint hover:border-white/25 hover:text-silver-dim"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="grid gap-px overflow-hidden rounded border border-white/10 bg-white/5 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map((t) => (
          <a
            key={t.name}
            href={t.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex h-full flex-col bg-ink-800 p-6 transition-colors hover:bg-ink-700"
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-display text-lg text-silver group-hover:text-gold-light">
                {t.name}
              </h3>
              <span className="shrink-0 text-[11px] text-silver-faint">{t.stars}</span>
            </div>
            <p className="mt-1 text-[11px] uppercase tracking-wide text-gold/70">
              replaces {t.replaces}
            </p>
            <p className="mt-3 flex-1 text-sm leading-relaxed text-silver-faint">{t.desc}</p>
            <div className="mt-5 flex items-center justify-between border-t border-white/8 pt-3 text-[11px] text-silver-ghost">
              <span>{t.stack}</span>
              <span className="rounded-sm border border-white/10 px-2 py-0.5">{t.license}</span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
