export type SessionMode = "idle" | "inspecting";

/**
 * Tracks inspect-mode on/off and owns the AbortController for the current
 * in-flight explain or chat stream, so picking a new element always cancels the last one.
 */
export class SessionState extends EventTarget {
  private currentMode: SessionMode = "idle";
  private activeAbort: AbortController | null = null;

  get mode(): SessionMode {
    return this.currentMode;
  }

  setMode(mode: SessionMode): void {
    if (this.currentMode === mode) return;
    this.currentMode = mode;
    this.dispatchEvent(new Event("modechange"));
  }

  toggleInspectMode(): void {
    this.setMode(this.currentMode === "inspecting" ? "idle" : "inspecting");
  }

  /**
   * Aborts any in-flight explain or chat stream and returns a fresh signal for
   * the new one: one slot, so a new pick also cancels a pending chat turn.
   */
  beginRequest(): AbortSignal {
    this.activeAbort?.abort();
    this.activeAbort = new AbortController();
    return this.activeAbort.signal;
  }

  cancelActive(): void {
    this.activeAbort?.abort();
    this.activeAbort = null;
  }
}
