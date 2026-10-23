import { ProxyHttpError } from "../connectors/byoEndpoint/ByoEndpointConnector";
import type { Labels } from "./labels";

/** The text a visitor sees for a failed explain/chat call. */
export function errorMessageFor(err: unknown, labels: Labels, verbose: boolean): string {
  if (err instanceof ProxyHttpError) {
    if (verbose) console.error("[clicksplain]", err.message);
    return labels.genericError;
  }
  return err instanceof Error && err.message ? err.message : labels.genericError;
}
