import { createServer } from "node:http";
import { createClicksplainHandler, type Provider } from "clicksplain/server";
import { toNodeHandler } from "clicksplain/server/node";

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

const port = Number(process.env.PORT ?? 8788);
createServer(toNodeHandler(handler)).listen(port, () => {
  console.log(`clicksplain proxy listening on http://localhost:${port}`);
});
