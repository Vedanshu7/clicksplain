import type { AgentConnector } from "./types";

/**
 * Wraps a connector so an answer that stops arriving (a stalled proxy, a
 * dropped connection, an ignored sign-in popup) ends in a visible error
 * instead of a loading indicator that spins forever. The limit is per chunk,
 * not per answer, so a long but steadily streaming answer is never cut off.
 */
export function withIdleTimeout(connector: AgentConnector, timeoutMs: number, message: string): AgentConnector {
  return {
    explain: (element, req, signal) =>
      guard((inner) => connector.explain(element, req, inner), signal, timeoutMs, message),
    chat: (element, req, signal) => guard((inner) => connector.chat(element, req, inner), signal, timeoutMs, message),
  };
}

async function* guard(
  start: (signal: AbortSignal) => AsyncIterable<string>,
  outer: AbortSignal,
  timeoutMs: number,
  message: string
): AsyncIterable<string> {
  // A separate controller, so timing out also stops the underlying request.
  const inner = new AbortController();
  const forwardAbort = () => inner.abort();
  if (outer.aborted) inner.abort();
  outer.addEventListener("abort", forwardAbort, { once: true });
  const iterator = start(inner.signal)[Symbol.asyncIterator]();

  try {
    while (true) {
      const next = iterator.next();
      // Once we time out, this promise is abandoned and later rejects with the
      // abort; without a handler that becomes an unhandled-rejection warning.
      next.catch(() => {});
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), timeoutMs);
      });
      const step = await Promise.race([next, timedOut]).finally(() => clearTimeout(timer));
      if (step === "timeout") throw new Error(message);
      if (step.done) return;
      yield step.value;
    }
  } finally {
    outer.removeEventListener("abort", forwardAbort);
    inner.abort();
  }
}
