import Link from "next/link";
import { SITE } from "@/lib/config";

export default function Footer() {
  return (
    <footer className="border-t border-white/10 mt-32">
      <div className="mx-auto max-w-6xl px-6 py-16 grid gap-10 md:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-xl text-silver">Like a King</span>
            <span className="text-[10px] tracking-[0.25em] text-gold">INC.</span>
          </div>
          <p className="mt-4 max-w-xs text-sm text-silver-faint leading-relaxed">
            A practice built for business advisory and corporate technology —
            engineered, secured, and operated to the standard your enterprise runs on.
          </p>
          <div className="mt-6 gold-rule w-24" />
        </div>

        <div className="text-sm">
          <div className="kicker mb-4">Practices</div>
          <ul className="space-y-2 text-silver-dim">
            <li>AI Engineering</li>
            <li>Digital Platforms</li>
            <li>Cybersecurity</li>
            <li>Cloud & Managed Services</li>
          </ul>
        </div>

        <div className="text-sm">
          <div className="kicker mb-4">Company</div>
          <ul className="space-y-2 text-silver-dim">
            <li>
              <Link href="/armory" className="hover:text-silver">
                The Armory
              </Link>
            </li>
            <li>
              <Link href="/crm" className="hover:text-silver">
                Operations Cockpit
              </Link>
            </li>
            <li>
              <Link href="/privacy" className="hover:text-silver">
                Privacy
              </Link>
            </li>
            <li>
              <a href={`mailto:${SITE.email}`} className="hover:text-silver">
                {SITE.email}
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/5">
        <div className="mx-auto max-w-6xl px-6 py-6 flex flex-col sm:flex-row justify-between gap-2 text-[11px] text-silver-ghost">
          <span>
            © {new Date().getFullYear()} {SITE.name}. All rights reserved.
          </span>
          <span>General information only — not legal, financial, or professional advice.</span>
        </div>
      </div>
    </footer>
  );
}
