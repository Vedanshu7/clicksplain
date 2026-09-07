---
title: Clicksplain
type: Developer Tool
projectURL: clicksplain
descriptionShort: A drop-in, AI-powered explain-this-UI widget: click any element on a page and get an LLM-generated explanation in an anchored popover.
descriptionLong: Clicksplain is a fully client-side library that adds an explain-this-UI affordance to any web page. Click the help button, then click any element, and an LLM-generated explanation renders in an animated popover anchored to that element. It ships two ways to connect a model: BYOK, which passes a raw API key directly and suits prototyping, and BYO-endpoint, which points at your own proxy and is the production path. The clicksplain/server entry point exports a runtime-agnostic Fetch handler implementing the full protocol including validation, auth, prompt building, and streaming, so it drops into Cloudflare Workers, Vercel Edge Functions, Next.js route handlers, Deno, Bun, or Hono with no adapter code. Distributed via npm or a single CDN script tag.
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
