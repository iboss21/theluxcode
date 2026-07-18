import type { Metadata } from "next";
import { Marcellus, Montserrat } from "next/font/google";
import "./globals.css";

const display = Marcellus({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const sans = Montserrat({
  weight: ["300", "400", "500"],
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://likeaking.pro"),
  title: {
    default: "Like a King Inc. — Professional Business Services",
    template: "%s · Like a King Inc.",
  },
  description:
    "A practice built for business advisory and corporate technology — engineered, secured, and operated to the standard your enterprise runs on. AI engineering, digital platforms, cybersecurity, and cloud.",
  openGraph: {
    title: "Like a King Inc. — Professional Business Services",
    description:
      "Enterprise AI engineering, digital platforms, cybersecurity, and cloud — precise, quiet, and built to endure.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
