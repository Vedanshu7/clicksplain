import type { Labels } from "./labels";

export type ChatSubmitHandler = (question: string) => void;

/**
 * Follow-up text input + send button + rendered turn list, composed inside
 * PopoverRenderer's panel, same composition style as PickerController owning
 * ElementHighlighter. Hidden until the initial explanation (docs/cache/LLM)
 * settles; reset() clears it back to that hidden state for a new pick.
 */
export class ChatPanel {
  private readonly root: HTMLDivElement;
  private readonly turnsList: HTMLDivElement;
  private readonly form: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private readonly sendButton: HTMLButtonElement;
  private onSubmit: ChatSubmitHandler | null = null;
  private activeAssistantTurn: HTMLDivElement | null = null;
  private loadingTurn: HTMLDivElement | null = null;

  constructor(mount: HTMLElement, labels: Labels) {
    this.root = document.createElement("div");
    this.root.className = "oa-popover-chat";
    this.root.style.display = "none";

    this.turnsList = document.createElement("div");
    this.turnsList.className = "oa-popover-chat-turns";
    this.turnsList.setAttribute("aria-live", "polite");

    this.form = document.createElement("form");
    this.form.className = "oa-popover-chat-form";
    this.form.addEventListener("submit", this.handleSubmit);

    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.className = "oa-popover-chat-input";
    this.input.placeholder = labels.followUpPlaceholder;
    this.input.setAttribute("aria-label", labels.followUpInput);

    this.sendButton = document.createElement("button");
    this.sendButton.type = "submit";
    this.sendButton.className = "oa-popover-chat-send";
    this.sendButton.textContent = labels.followUpSend;

    this.form.append(this.input, this.sendButton);
    this.root.append(this.turnsList, this.form);
    mount.appendChild(this.root);
  }

  /** Reveals the follow-up form, arming it with the submit handler for this popover session. */
  show(onSubmit: ChatSubmitHandler): void {
    this.onSubmit = onSubmit;
    this.root.style.display = "block";
  }

  addUserTurn(text: string): void {
    const turn = document.createElement("div");
    turn.className = "oa-popover-chat-turn oa-popover-chat-turn-user";
    turn.textContent = text;
    this.turnsList.appendChild(turn);
  }

  /** Shows a small generative-blob placeholder turn while waiting for the first token. */
  private showLoadingTurn(): void {
    this.loadingTurn = document.createElement("div");
    this.loadingTurn.className = "oa-popover-chat-turn oa-popover-chat-turn-assistant oa-popover-chat-turn-loading";
    const blob = document.createElement("div");
    blob.className = "oa-loading-blob oa-loading-blob-sm";
    this.loadingTurn.appendChild(blob);
    this.turnsList.appendChild(this.loadingTurn);
  }

  private clearLoadingTurn(): void {
    this.loadingTurn?.remove();
    this.loadingTurn = null;
  }

  appendAssistantDelta(text: string): void {
    this.clearLoadingTurn();
    if (!this.activeAssistantTurn) {
      this.activeAssistantTurn = document.createElement("div");
      this.activeAssistantTurn.className = "oa-popover-chat-turn oa-popover-chat-turn-assistant";
      this.turnsList.appendChild(this.activeAssistantTurn);
    }
    this.activeAssistantTurn.textContent += text;
  }

  completeAssistantTurn(): void {
    this.activeAssistantTurn = null;
    this.setSubmitting(false);
    // Disabling the input mid-turn dropped its focus: give it back so a
    // keyboard user can ask the next question without hunting for the field.
    this.input.focus({ preventScroll: true });
  }

  setError(message: string): void {
    this.clearLoadingTurn();
    const turn = document.createElement("div");
    turn.className = "oa-popover-chat-turn oa-popover-chat-error";
    turn.textContent = message;
    this.turnsList.appendChild(turn);
    this.activeAssistantTurn = null;
    this.setSubmitting(false);
    this.input.focus({ preventScroll: true });
  }

  /** Hides the form and clears turns/input: called on close and on re-picking a new element. */
  reset(): void {
    this.onSubmit = null;
    this.activeAssistantTurn = null;
    this.loadingTurn = null;
    this.turnsList.replaceChildren();
    this.input.value = "";
    this.setSubmitting(false);
    this.root.style.display = "none";
  }

  private setSubmitting(submitting: boolean): void {
    this.input.disabled = submitting;
    this.sendButton.disabled = submitting;
    this.turnsList.setAttribute("aria-busy", String(submitting));
  }

  private handleSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    const question = this.input.value.trim();
    if (!question || !this.onSubmit) return;

    this.addUserTurn(question);
    this.input.value = "";
    this.setSubmitting(true);
    this.showLoadingTurn();
    this.onSubmit(question);
  };
}
