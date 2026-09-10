import type { ElementInfo } from "../src/shared/wire";

export const elementInfo: ElementInfo = {
  tagName: "button",
  role: "button",
  ariaLabel: null,
  id: null,
  classes: ["btn", "btn-primary"],
  nearbyText: "Save",
  placeholder: null,
  agentId: null,
};

export const explainBody = { elementInfo, docsContext: null, route: "/settings" };

/** A ReadableStream that emits each string as its own chunk. */
export function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}
