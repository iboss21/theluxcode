"use client";
import { useState } from "react";
import { FAQS } from "@/data/practices";

export default function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="scroll-mt-24 border-t border-white/10">
      <div className="mx-auto max-w-4xl px-6 py-24 md:py-28">
        <div className="kicker">Questions, answered</div>
        <h2 className="mt-4 font-display text-3xl text-silver md:text-4xl">
          The things enterprises ask first.
        </h2>

        <div className="mt-12 divide-y divide-white/10 border-y border-white/10">
          {FAQS.map((f, i) => {
            const isOpen = open === i;
            return (
              <div key={i}>
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between gap-6 py-6 text-left"
                >
                  <span className="font-display text-lg text-silver">{f.q}</span>
                  <span className={`text-gold transition-transform ${isOpen ? "rotate-45" : ""}`}>
                    +
                  </span>
                </button>
                <div
                  className={`grid transition-all duration-500 ${
                    isOpen ? "grid-rows-[1fr] pb-6 opacity-100" : "grid-rows-[0fr] opacity-0"
                  }`}
                >
                  <div className="overflow-hidden">
                    <p className="max-w-2xl text-sm leading-relaxed text-silver-faint">{f.a}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
