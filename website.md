---
title: Clicksplain
type: Developer Tool
projectURL: clicksplain
descriptionShort: A drop-in, AI-powered explain-this-UI widget: click any element on a page and get an LLM-generated explanation in an anchored popover.
descriptionLong: Clicksplain is a drop-in library that adds an explain-this-UI affordance to any web page, with no hosted backend. Click the help button, then click any element, and an LLM-generated explanation renders in an animated popover anchored to that element, with follow-up questions. It ships three ways to connect a model: BYO-endpoint, which points at your own server and is the production path; Puter, which needs no key or backend at all; and BYOK, a separate opt-in bundle for local development that passes a raw API key directly. The default widget is about 18 KB and contains no LLM SDK. The clicksplain/server entry point exports a runtime-agnostic Fetch handler implementing the full protocol including validation, auth, prompt building, and streaming, so it drops into Cloudflare Workers, Vercel Edge Functions, Next.js route handlers, Deno, Bun, or Hono with no adapter code. Distributed via npm or a single CDN script tag.
viewCodeUrl: https://github.com/Vedanshu7/clicksplain
viewProjectUrl:
projectImg: /project-image/clicksplain.svg
technologies:
  - TypeScript
  - JavaScript
  - Node.js
---

This file describes the project for vedanshujoshi.com. Pushing it triggers the
site webhook, which upserts the entry above into the portfolio.
