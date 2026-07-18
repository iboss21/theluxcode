"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "/#practices", label: "Practices" },
  { href: "/#intelligence", label: "Applied AI" },
  { href: "/armory", label: "The Armory" },
  { href: "/#faq", label: "FAQ" },
];

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 inset-x-0 z-40 transition-all duration-500 ${
        scrolled ? "bg-ink/85 backdrop-blur-md border-b border-white/10" : "border-b border-transparent"
      }`}
    >
      <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-baseline gap-2 group">
          <span className="font-display text-lg tracking-wide text-silver">Like a King</span>
          <span className="text-[10px] tracking-[0.25em] text-gold">INC.</span>
        </Link>

        <nav className="hidden md:flex items-center gap-8 text-[13px] text-silver-dim">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-silver transition-colors">
              {l.label}
            </Link>
          ))}
          <Link
            href="/crm"
            className="text-[13px] text-silver-faint hover:text-gold transition-colors"
          >
            Cockpit
          </Link>
          <Link
            href="/#contact"
            className="border border-white/20 hover:border-gold hover:text-silver px-4 py-2 text-[12px] tracking-wide uppercase transition-colors"
          >
            Start a project
          </Link>
        </nav>

        <button
          className="md:hidden text-silver-dim text-sm"
          onClick={() => setOpen((o) => !o)}
          aria-label="Menu"
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>

      {open && (
        <div className="md:hidden bg-ink/95 border-b border-white/10 px-6 py-4 flex flex-col gap-4 text-silver-dim">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </Link>
          ))}
          <Link href="/crm" onClick={() => setOpen(false)}>
            Cockpit
          </Link>
          <Link href="/#contact" onClick={() => setOpen(false)} className="text-gold">
            Start a project →
          </Link>
        </div>
      )}
    </header>
  );
}
