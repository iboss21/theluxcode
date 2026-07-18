import type { Metadata } from "next";
import Nav from "@/components/site/Nav";
import Footer from "@/components/site/Footer";
import { SITE } from "@/lib/config";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Like a King Inc. collects, uses, and protects the information you share.",
};

export default function PrivacyPage() {
  return (
    <main>
      <Nav />
      <section className="mx-auto max-w-3xl px-6 pt-36 pb-24 md:pt-44">
        <div className="kicker">Privacy Policy</div>
        <h1 className="mt-5 font-display text-4xl text-silver">Your information, handled plainly.</h1>
        <p className="mt-4 text-sm text-silver-ghost">
          General information only — not legal, financial, or professional advice. This is a template
          and should be reviewed by qualified counsel before publication.
        </p>

        <div className="prose mt-12 space-y-8 text-silver-dim">
          <Block title="What we collect">
            When you submit the enquiry form or chat with REGES, we collect the details you provide —
            name, email, company, and your project description — plus basic technical metadata such as
            your IP address for spam prevention.
          </Block>
          <Block title="How we use it">
            To respond to your enquiry, produce a preliminary estimate, and follow up about a
            possible engagement. The REGES concierge and pricing engine may process your message
            through an AI model we operate or a model provider we have contracted; we do not sell your
            data.
          </Block>
          <Block title="Where it lives">
            Enquiries are stored on infrastructure we control and are accessible only to our team
            through a password-protected operations cockpit. We retain them only as long as needed to
            serve you and meet our records obligations.
          </Block>
          <Block title="Cookies">
            We use essential cookies to run the site (including your CRM session if you are a team
            member) and, optionally, privacy-respecting analytics to understand how the site is used.
          </Block>
          <Block title="Your choices">
            You can ask us to access, correct, or delete the information you&apos;ve shared. Email{" "}
            <a href={`mailto:${SITE.email}`} className="text-gold-light underline">
              {SITE.email}
            </a>{" "}
            and we&apos;ll take care of it.
          </Block>
        </div>
      </section>
      <Footer />
    </main>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="font-display text-xl text-silver">{title}</h2>
      <p className="mt-3 text-sm leading-relaxed text-silver-faint">{children}</p>
    </div>
  );
}
