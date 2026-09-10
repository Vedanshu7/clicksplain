import { ByokConnector, type ByokConnectorConfig } from "./connectors/byok/ByokConnector";
import type { AgentConnector } from "./connectors/types";

/**
 * Calls the LLM provider straight from the browser with a raw API key, for
 * local development and internal tools only: see ByokConnector for the
 * origin checks. Pass the result as `init({ connector: byok({...}) })`.
 */
export function byok(config: ByokConnectorConfig): AgentConnector {
  return new ByokConnector(config);
}

export type { ByokConnectorConfig };
