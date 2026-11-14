/*
  Redis over REST (Upstash-compatible), with plain fetch and no SDK.

  Keys, all expiring at the pair's expiresAt (48 hours after creation):
    cp:p:<pair>   the pair record (JSON: token hashes, trusted person's first name, times)
    cp:e:<pair>   list of events (JSON), oldest first
    cp:c:<pair>   hash clientId -> event id, so a retried send returns the original event
    cp:r:<key>    fixed-window counters for rate limits (expire after their window)
*/
import type { MessageEvent } from "./events";
import type { AppendLimits, AppendResult, PairRecord, Store } from "./store";

type Cmd = (string | number)[];
type Reply = { result?: unknown; error?: string };

export class RedisRestStore implements Store {
  readonly kind = "redis" as const;

  constructor(
    private url: string,
    private token: string,
  ) {
    this.url = url.replace(/\/+$/, "");
  }

  private async send(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(this.url + path, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`redis responded ${res.status}`);
    return res.json();
  }

  private async cmd(...args: Cmd): Promise<unknown> {
    const r = (await this.send("", args.map(String))) as Reply;
    if (r.error) throw new Error("redis command failed");
    return r.result;
  }

  private async pipeline(cmds: Cmd[]): Promise<unknown[]> {
    const r = (await this.send("/pipeline", cmds.map((c) => c.map(String)))) as Reply[];
    return r.map((x) => {
      if (x.error) throw new Error("redis command failed");
      return x.result;
    });
  }

  async createPair(rec: PairRecord): Promise<boolean> {
    const ttl = Math.max(1, rec.expiresAt - rec.createdAt);
    const r = await this.cmd("SET", `cp:p:${rec.pair}`, JSON.stringify(rec), "NX", "PX", ttl);
    return r === "OK";
  }

  async getPair(pair: string, now: number): Promise<PairRecord | null> {
    const raw = await this.cmd("GET", `cp:p:${pair}`);
    if (typeof raw !== "string") return null;
    const rec = JSON.parse(raw) as PairRecord;
    return rec.expiresAt > now ? rec : null;
  }

  async setTrusted(pair: string, name: string, tokenHash: string, now: number): Promise<boolean> {
    const rec = await this.getPair(pair, now);
    if (!rec) return false;
    const next: PairRecord = { ...rec, trustedName: name, trustedTokenHash: tokenHash };
    const r = await this.cmd("SET", `cp:p:${pair}`, JSON.stringify(next), "XX", "KEEPTTL");
    return r === "OK";
  }

  async listEvents(pair: string, now: number): Promise<MessageEvent[]> {
    void now; // the keys expire on their own
    const raw = await this.cmd("LRANGE", `cp:e:${pair}`, 0, -1);
    if (!Array.isArray(raw)) return [];
    return raw.map((s) => JSON.parse(String(s)) as MessageEvent);
  }

  async appendEvent(pair: string, event: MessageEvent, limits: AppendLimits): Promise<AppendResult> {
    const rec = await this.getPair(pair, limits.now);
    if (!rec) return { status: "missing" };
    const cKey = `cp:c:${pair}`;
    const eKey = `cp:e:${pair}`;

    const original = await this.cmd("HGET", cKey, event.clientId);
    if (typeof original === "string") return this.duplicate(pair, original, limits.now);

    if ((await this.hit(`rate:${pair}`, 60_000, limits.now)) > limits.perMinute) return { status: "rate_limited" };
    const length = Number(await this.cmd("LLEN", eKey));
    if (length >= limits.cap) return { status: "full" };

    // Claim the clientId first, so two concurrent retries cannot both append.
    const claimed = Number(await this.cmd("HSETNX", cKey, event.clientId, event.id));
    if (claimed !== 1) {
      const id = await this.cmd("HGET", cKey, event.clientId);
      return this.duplicate(pair, String(id), limits.now);
    }
    await this.pipeline([
      ["RPUSH", eKey, JSON.stringify(event)],
      ["PEXPIREAT", eKey, rec.expiresAt],
      ["PEXPIREAT", cKey, rec.expiresAt],
    ]);
    return { status: "ok", event };
  }

  private async duplicate(pair: string, id: string, now: number): Promise<AppendResult> {
    const events = await this.listEvents(pair, now);
    const event = events.find((e) => e.id === id);
    // The claim can briefly exist before the push lands: ask the sender to try again.
    return event ? { status: "duplicate", event } : { status: "retry" };
  }

  async deletePair(pair: string): Promise<void> {
    await this.cmd("DEL", `cp:p:${pair}`, `cp:e:${pair}`, `cp:c:${pair}`, `cp:r:rate:${pair}`);
  }

  async hit(key: string, windowMs: number, now: number): Promise<number> {
    void now;
    const k = `cp:r:${key}`;
    const count = Number(await this.cmd("INCR", k));
    if (count === 1) await this.cmd("PEXPIRE", k, windowMs);
    return count;
  }
}
