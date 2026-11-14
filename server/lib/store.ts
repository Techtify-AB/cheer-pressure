/*
  Storage behind one small interface. Two implementations:
  - MemoryStore (default): for local development and tests. Lost on every restart, and on a
    serverless host each instance has its own copy, so a deployed service needs Redis.
  - RedisRestStore (lib/store-redis.ts): Upstash-compatible Redis over REST, used when
    UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set.
*/
import type { MessageEvent } from "./events";

export interface PairRecord {
  pair: string;
  createdAt: number; // ms
  expiresAt: number; // ms, createdAt + TTL. Everything for the pair is gone after this.
  userTokenHash: string;
  inviteTokenHash: string;
  trustedTokenHash: string | null;
  trustedName: string | null;
}

export interface AppendLimits {
  perMinute: number;
  cap: number;
  now: number;
}

export type AppendResult =
  | { status: "ok"; event: MessageEvent }
  | { status: "duplicate"; event: MessageEvent }
  | { status: "rate_limited" }
  | { status: "full" }
  | { status: "missing" }
  | { status: "retry" };

export interface Store {
  readonly kind: "memory" | "redis";
  /** False if the pair code is already taken. */
  createPair(rec: PairRecord): Promise<boolean>;
  /** Null when missing or expired. */
  getPair(pair: string, now: number): Promise<PairRecord | null>;
  setTrusted(pair: string, name: string, tokenHash: string, now: number): Promise<boolean>;
  /** Events oldest first. */
  listEvents(pair: string, now: number): Promise<MessageEvent[]>;
  /** Appends unless the same clientId was already stored for this pair (then returns the original). */
  appendEvent(pair: string, event: MessageEvent, limits: AppendLimits): Promise<AppendResult>;
  deletePair(pair: string): Promise<void>;
  /** Counts one hit for `key` in a fixed window. Returns the count in the current window. */
  hit(key: string, windowMs: number, now: number): Promise<number>;
}

interface MemoryEntry {
  rec: PairRecord;
  events: MessageEvent[];
  byClientId: Map<string, MessageEvent>;
}

export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private pairs = new Map<string, MemoryEntry>();
  private counters = new Map<string, { windowStart: number; count: number }>();

  private live(pair: string, now: number): MemoryEntry | null {
    const entry = this.pairs.get(pair);
    if (!entry) return null;
    if (entry.rec.expiresAt <= now) {
      this.pairs.delete(pair);
      return null;
    }
    return entry;
  }

  private sweep(now: number) {
    for (const [pair, entry] of this.pairs) if (entry.rec.expiresAt <= now) this.pairs.delete(pair);
    for (const [key, c] of this.counters) if (now - c.windowStart > 3_600_000) this.counters.delete(key);
  }

  async createPair(rec: PairRecord): Promise<boolean> {
    this.sweep(rec.createdAt);
    if (this.live(rec.pair, rec.createdAt)) return false;
    this.pairs.set(rec.pair, { rec: { ...rec }, events: [], byClientId: new Map() });
    return true;
  }

  async getPair(pair: string, now: number): Promise<PairRecord | null> {
    const entry = this.live(pair, now);
    return entry ? { ...entry.rec } : null;
  }

  async setTrusted(pair: string, name: string, tokenHash: string, now: number): Promise<boolean> {
    const entry = this.live(pair, now);
    if (!entry) return false;
    entry.rec.trustedName = name;
    entry.rec.trustedTokenHash = tokenHash;
    return true;
  }

  async listEvents(pair: string, now: number): Promise<MessageEvent[]> {
    const entry = this.live(pair, now);
    return entry ? entry.events.slice() : [];
  }

  async appendEvent(pair: string, event: MessageEvent, limits: AppendLimits): Promise<AppendResult> {
    const entry = this.live(pair, limits.now);
    if (!entry) return { status: "missing" };
    const existing = entry.byClientId.get(event.clientId);
    if (existing) return { status: "duplicate", event: existing };
    if ((await this.hit(`rate:${pair}`, 60_000, limits.now)) > limits.perMinute) return { status: "rate_limited" };
    if (entry.events.length >= limits.cap) return { status: "full" };
    entry.events.push(event);
    entry.byClientId.set(event.clientId, event);
    return { status: "ok", event };
  }

  async deletePair(pair: string): Promise<void> {
    this.pairs.delete(pair);
    for (const key of this.counters.keys()) if (key.endsWith(`:${pair}`)) this.counters.delete(key);
  }

  async hit(key: string, windowMs: number, now: number): Promise<number> {
    const c = this.counters.get(key);
    if (!c || now - c.windowStart >= windowMs) {
      this.counters.set(key, { windowStart: now, count: 1 });
      return 1;
    }
    c.count += 1;
    return c.count;
  }
}
