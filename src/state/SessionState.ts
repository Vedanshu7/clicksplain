export type SessionMode = "idle" | "inspecting";

export interface ModeChangeEvent extends CustomEvent<{ mode: SessionMode }> {}

/**
 * Tracks inspect-mode on/off and owns the AbortController for the current
 * in-flight explain stream, so picking a new element always cancels the last one.
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
    this.dispatchEvent(new CustomEvent("modechange", { detail: { mode } }));
  }

  toggleInspectMode(): void {
    this.setMode(this.currentMode === "inspecting" ? "idle" : "inspecting");
  }

  /** Aborts any in-flight explain stream and returns a fresh signal for the new one. */
  beginExplain(): AbortSignal {
    this.activeAbort?.abort();
    this.activeAbort = new AbortController();
    return this.activeAbort.signal;
  }

  /**
   * Same single-abort-slot design as beginExplain — a chat submit cancels any
   * leftover explain stream or prior in-flight chat turn, and a new pick's
   * beginExplain() cancels any in-flight chat turn from the previous element.
   */
  beginChatTurn(): AbortSignal {
    this.activeAbort?.abort();
    this.activeAbort = new AbortController();
    return this.activeAbort.signal;
  }

  cancelActiveExplain(): void {
    this.activeAbort?.abort();
    this.activeAbort = null;
  }
}
