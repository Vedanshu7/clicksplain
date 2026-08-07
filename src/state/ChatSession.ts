import type { ChatTurn } from "../connectors/types";

/**
 * Holds one popover's chat turn history. Scoped to a single element/session —
 * reset when a different element is picked or the popover closes, never carried
 * across (see DocentInstance in index.ts for the two reset triggers).
 */
export class ChatSession {
  private turns: ChatTurn[] = [];

  get history(): ChatTurn[] {
    return this.turns;
  }

  addUserTurn(text: string): void {
    this.turns.push({ role: "user", text });
  }

  addAssistantTurn(text: string): void {
    this.turns.push({ role: "assistant", text });
  }

  reset(): void {
    this.turns = [];
  }
}
