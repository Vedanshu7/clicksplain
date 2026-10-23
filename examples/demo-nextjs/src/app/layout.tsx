import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import type { ReactNode } from "react";
import { ClicksplainWidget } from "./ClicksplainWidget";
import "./globals.css";

// The width axis is the page's one typographic device: wide for engraved
// faceplate labels and numerals, normal width for everything you read.
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo" });

export const metadata: Metadata = {
  title: "Crema: clicksplain + Next.js example",
  description: "Reference integration of clicksplain in a Next.js App Router app",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body>
        {children}
        <ClicksplainWidget />
      </body>
    </html>
  );
}
