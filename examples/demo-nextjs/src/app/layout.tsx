import type { Metadata } from "next";
import { ClicksplainWidget } from "./ClicksplainWidget";
import "./globals.css";

export const metadata: Metadata = {
  title: "clicksplain + Next.js example",
  description: "Reference integration of clicksplain in a Next.js App Router app",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        {children}
        <ClicksplainWidget />
      </body>
    </html>
  );
}
