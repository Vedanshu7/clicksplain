import type { ElementInfo } from "../connectors/types";
import { deriveElementSignature } from "./elementSignature";

export interface CacheConfig {
  /** Default 30. */
  ttlDays?: number;
  /** Default 300. */
  maxEntries?: number;
}

interface CacheEntry {
  text: string;
  createdAt: number;
  expiresAt: number;
}

interface CacheStore {
  version: 1;
  entries: Record<string, Record<string, CacheEntry>>;
}

// Bump the version whenever the signature or prompts change meaning, so stale
// explanations from an older widget build are never served.
const STORAGE_KEY = "clicksplain:cache:v2";
const DEFAULT_TTL_DAYS = 30;
const DEFAULT_MAX_ENTRIES = 300;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * localStorage-backed cache of previously-generated explanations, keyed by
 * (route, element signature): mirrors DocsConfig's route -> key -> value shape
 * from taggingResolver.ts. Every read/write is wrapped in try/catch: a full or
 * unavailable localStorage (Safari private browsing, quota exceeded) degrades
 * to "always miss" rather than ever throwing into the pick flow.
 */
export class ExplanationCache {
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(config: CacheConfig = {}) {
    this.ttlMs = (config.ttlDays ?? DEFAULT_TTL_DAYS) * MS_PER_DAY;
    this.maxEntries = config.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  get(route: string, elementInfo: ElementInfo, pageLanguage: string | null): string | null {
    const signature = deriveElementSignature(elementInfo, pageLanguage);
    const store = readStore();
    const bySignature = store.entries[route];
    const entry = bySignature?.[signature];
    if (!bySignature || !entry) return null;

    if (entry.expiresAt <= Date.now()) {
      delete bySignature[signature];
      writeStore(store);
      return null;
    }

    return entry.text;
  }

  set(route: string, elementInfo: ElementInfo, pageLanguage: string | null, text: string): void {
    const signature = deriveElementSignature(elementInfo, pageLanguage);
    const store = readStore();
    const now = Date.now();

    store.entries[route] ??= {};
    store.entries[route][signature] = { text, createdAt: now, expiresAt: now + this.ttlMs };

    evictOverflow(store, this.maxEntries);

    if (!writeStore(store)) {
      // Likely QuotaExceededError: drop the oldest ~20% and retry once, then give up silently.
      evictOverflow(store, Math.floor(this.maxEntries * 0.8));
      writeStore(store);
    }
  }
}

function readStore(): CacheStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, entries: {} };
    const parsed = JSON.parse(raw) as CacheStore;
    if (parsed.version !== 1 || typeof parsed.entries !== "object") {
      return { version: 1, entries: {} };
    }
    return parsed;
  } catch {
    return { version: 1, entries: {} };
  }
}

function writeStore(store: CacheStore): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

// Evicts oldest-by-createdAt entries across the whole store (not per-route) until at/under the cap.
function evictOverflow(store: CacheStore, cap: number): void {
  const flat: { route: string; signature: string; createdAt: number }[] = [];
  for (const [route, bySignature] of Object.entries(store.entries)) {
    for (const [signature, entry] of Object.entries(bySignature)) {
      flat.push({ route, signature, createdAt: entry.createdAt });
    }
  }

  const overflow = flat.length - cap;
  if (overflow <= 0) return;

  flat.sort((a, b) => a.createdAt - b.createdAt);
  for (const { route, signature } of flat.slice(0, overflow)) {
    const bySignature = store.entries[route];
    if (!bySignature) continue;
    delete bySignature[signature];
    if (Object.keys(bySignature).length === 0) {
      delete store.entries[route];
    }
  }
}
