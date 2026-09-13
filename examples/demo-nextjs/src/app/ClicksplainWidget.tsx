"use client";

import Script from "next/script";
import type { InitConfig } from "clicksplain";

declare global {
  interface Window {
    Clicksplain?: { init: (config: InitConfig) => void };
  }
}

/**
 * Loads the pre-built widget bundle (copied into public/ by the predev/prebuild
 * scripts, see package.json) and initializes it once loaded. Calling init()
 * explicitly from onLoad, rather than relying on the plain
 * <script data-connector="..."> auto-init path, sidesteps next/script's
 * dynamic-insertion quirks around document.currentScript.
 */
export function ClicksplainWidget() {
  return (
    <Script
      src="/clicksplain.global.js"
      strategy="afterInteractive"
      onLoad={() => {
        window.Clicksplain?.init({
          connector: "byo-endpoint",
          endpoint: "/api/clicksplain",
          token: process.env.NEXT_PUBLIC_CLICKSPLAIN_TOKEN,
          siteContext:
            "Crema, the companion app for a home espresso machine: brew profile settings, shot history, and maintenance.",
          // Elements tagged with data-agent-id get this text instantly, with
          // no model call: for answers you want to word exactly yourself.
          docsConfig: {
            "/": {
              descale:
                "Runs a cleaning cycle that dissolves limescale from the boiler and pipes. It takes about 20 minutes and needs descaling solution in the water tank.",
            },
          },
        });
      }}
    />
  );
}
