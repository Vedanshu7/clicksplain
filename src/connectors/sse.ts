/** Parses a fetch Response body into the data payload of each SSE frame. */
export async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let pendingCr = "";
  let finished = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      // The SSE spec allows CRLF, CR, or LF line endings (proxies like nginx
      // may rewrite them), so normalize before looking for the blank line. A
      // trailing "\r" waits for the next chunk: it may be half of a split "\r\n".
      buffer += pendingCr + (done ? decoder.decode() : decoder.decode(value, { stream: true }));
      pendingCr = !done && buffer.endsWith("\r") ? "\r" : "";
      if (pendingCr) buffer = buffer.slice(0, -1);
      buffer = buffer.replace(/\r\n?/g, "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = parseFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (frame !== null) yield frame;
        boundary = buffer.indexOf("\n\n");
      }

      if (done) {
        // A final frame without its trailing blank line is still a frame.
        const frame = parseFrame(buffer);
        if (frame !== null) yield frame;
        finished = true;
        return;
      }
    }
  } finally {
    // Callers stop early (on "done" or "tool-call"): cancel so the connection
    // is released now rather than whenever the server closes it.
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// Only data lines carry anything this protocol uses; event, id and retry
// fields are ignored, as the spec allows.
function parseFrame(raw: string): string | null {
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("data:")) dataLines.push(fieldValue(line, "data:"));
  }
  return dataLines.length === 0 ? null : dataLines.join("\n");
}

// Per the spec, exactly one leading space after the colon is stripped, no more.
function fieldValue(line: string, prefix: string): string {
  const value = line.slice(prefix.length);
  return value.startsWith(" ") ? value.slice(1) : value;
}
