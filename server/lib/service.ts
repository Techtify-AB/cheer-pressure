/*
  Shared pieces for the API routes: settings, the store, tokens, CORS, body limits and errors.
  Nothing here logs message text or tokens. Errors are short JSON objects: { error }.
*/
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { PAIR_ALPHABET, PAIR_LENGTH, isValidPair, type Role } from "./events";
import { MemoryStore, type PairRecord, type Store } from "./store";
import { RedisRestStore } from "./store-redis";

const HOURS_48 = 48 * 60 * 60;

/** Pair lifetime. PAIR_TTL_SECONDS can only shorten it (used to test expiry). */
export const PAIR_TTL_MS = (() => {
  const raw = Number(process.env.PAIR_TTL_SECONDS);
  const s = Number.isFinite(raw) && raw > 0 ? Math.min(Math.max(Math.floor(raw), 2), HOURS_48) : HOURS_48;
  return s * 1000;
})();
export const EVENTS_PER_MINUTE = 30;
export const EVENT_CAP = 500;
export const BODY_LIMIT = 4096;
export const PAIRS_PER_HOUR_PER_CLIENT = 20;

// One store per server process, kept on globalThis so every route bundle shares it in dev.
const g = globalThis as { __cheerPressureStore?: Store };
export function store(): Store {
  if (!g.__cheerPressureStore) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    g.__cheerPressureStore = url && token ? new RedisRestStore(url, token) : new MemoryStore();
  }
  return g.__cheerPressureStore;
}

// --- Tokens ---------------------------------------------------------------------------

export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
export const newEventId = () => "e" + randomBytes(12).toString("base64url");

export function newPairCode(): string {
  let s = "";
  for (let i = 0; i < PAIR_LENGTH; i++) s += PAIR_ALPHABET[randomInt(PAIR_ALPHABET.length)];
  return s;
}

/** Constant-time comparison of two hex hashes of equal length. */
export function sameHash(a: string | null, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  const m = h ? /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(h.trim()) : null;
  return m ? m[1] : null;
}

/** Which role the bearer token has in this pair, or null. Both hashes are always compared. */
export function roleFor(rec: PairRecord, token: string): Role | null {
  const h = hashToken(token);
  const isUser = sameHash(rec.userTokenHash, h);
  const isTrusted = sameHash(rec.trustedTokenHash ?? "0".repeat(64), h);
  if (isUser) return "user";
  if (isTrusted && rec.trustedTokenHash) return "trusted";
  return null;
}

// --- CORS -----------------------------------------------------------------------------

const BUILT_IN_ORIGINS = ["tauri://localhost", "http://tauri.localhost", "http://localhost:3470"];

function allowedOrigins(): Set<string> {
  const extra = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return new Set([...BUILT_IN_ORIGINS, ...extra]);
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const h: Record<string, string> = { Vary: "Origin" };
  if (origin && allowedOrigins().has(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    h["Access-Control-Max-Age"] = "600";
  }
  return h;
}

export function json(req: Request, status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(req),
      ...extra,
    },
  });
}

export const error = (req: Request, status: number, message: string, extra: Record<string, string> = {}) =>
  json(req, status, { error: message }, extra);

export function preflight(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

// --- Bodies ---------------------------------------------------------------------------

export class BodyError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Reads a JSON body of at most BODY_LIMIT bytes without buffering anything larger. */
export async function readJson(req: Request): Promise<unknown> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > BODY_LIMIT) throw new BodyError(413, "body is larger than 4 KB");
  if (!req.body) throw new BodyError(400, "body is missing");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > BODY_LIMIT) {
      await reader.cancel();
      throw new BodyError(413, "body is larger than 4 KB");
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    buf.set(c, at);
    at += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(buf));
  } catch {
    throw new BodyError(400, "body is not valid JSON");
  }
}

// --- Common lookups -------------------------------------------------------------------

/** The pair record, or a 404 response. */
export async function loadPair(req: Request, pair: string): Promise<PairRecord | Response> {
  if (!isValidPair(pair)) return error(req, 404, "pair not found");
  const rec = await store().getPair(pair, Date.now());
  return rec ?? error(req, 404, "pair not found");
}

/** The pair and the caller's role, or a 401/404 response. */
export async function authorize(req: Request, pair: string): Promise<{ rec: PairRecord; role: Role } | Response> {
  const token = bearer(req);
  if (!token) return error(req, 401, "missing or malformed bearer token");
  const rec = await loadPair(req, pair);
  if (rec instanceof Response) return rec;
  const role = roleFor(rec, token);
  if (!role) return error(req, 401, "token is not valid for this pair");
  return { rec, role };
}

/** Where links point: PUBLIC_BASE_URL if set, otherwise the address this request came in on. */
export function publicBase(req: Request): string {
  const env = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "");
  if (env) return env;
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** A coarse, unlogged client key for limiting pair creation. Only a hash is kept. */
export function clientKey(req: Request): string {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

/** Wraps a handler so unexpected failures become a short 500 without details in the log. */
export function guarded<A extends unknown[]>(fn: (req: Request, ...rest: A) => Promise<Response>) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    try {
      return await fn(req, ...rest);
    } catch (e) {
      if (e instanceof BodyError) return error(req, e.status, e.message);
      console.error("messages service: request failed", e instanceof Error ? e.name : "unknown");
      return error(req, 500, "something went wrong");
    }
  };
}
