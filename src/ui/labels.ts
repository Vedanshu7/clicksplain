/** Every user-visible string the widget itself renders, for localization. */
export interface Labels {
  /** Accessible name of the floating "?" button. */
  fab: string;
  /** Badge on the hover outline while inspecting. */
  highlightBadge: string;
  /** Accessible name of the explanation popover. */
  popover: string;
  close: string;
  followUpPlaceholder: string;
  /** Accessible name of the follow-up input. */
  followUpInput: string;
  followUpSend: string;
  /** Shown when no part of an answer arrives within `timeoutMs`. */
  timeout: string;
  /** Shown when an answer finishes without any text. */
  emptyAnswer: string;
  /** Shown for any failure that doesn't come with a message of its own. */
  genericError: string;
}

const DEFAULT_LABELS: Labels = {
  fab: "Explain this UI",
  highlightBadge: "Click to explain",
  popover: "Explanation",
  close: "Close explanation",
  followUpPlaceholder: "Ask a follow-up…",
  followUpInput: "Ask a follow-up question",
  followUpSend: "Ask",
  timeout: "This is taking longer than expected. Please try again.",
  emptyAnswer: "I couldn't come up with an explanation for this. Please try again.",
  genericError: "Something went wrong. Please try again.",
};

export function resolveLabels(overrides: Partial<Labels> | undefined): Labels {
  return { ...DEFAULT_LABELS, ...overrides };
}
