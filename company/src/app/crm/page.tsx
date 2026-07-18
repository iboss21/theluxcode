import type { Metadata } from "next";
import CrmApp from "@/components/crm/CrmApp";

export const metadata: Metadata = {
  title: "Operations Cockpit",
  description: "REGES revenue & pipeline cockpit — team access only.",
  robots: { index: false, follow: false },
};

export default function CrmPage() {
  return <CrmApp />;
}
