import { createClicksplainHandler, type Provider } from "clicksplain/server";

// Route Handlers already speak the standard Fetch API (Request in, Response
// out), so createClicksplainHandler mounts directly with zero adapter code.
// Every value is read from process.env here, not inside the handler itself:
// createClicksplainHandler never touches process.env on its own, since not
// every runtime it supports has one.
const handler = createClicksplainHandler({
  apiKey: process.env.API_KEY ?? "",
  provider: process.env.PROVIDER as Provider | undefined,
  model: process.env.MODEL,
  chatModel: process.env.CHAT_MODEL,
  widgetToken: process.env.WIDGET_TOKEN,
  allowedOrigin: process.env.ALLOWED_ORIGIN,
  portkeyGatewayUrl: process.env.PORTKEY_GATEWAY_URL,
  portkeyProvider: process.env.PORTKEY_PROVIDER,
});

export const POST = handler;
export const OPTIONS = handler;
