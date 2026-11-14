/*
  A tiny in-memory stand-in for Upstash's Redis REST API, only for testing the Redis code path
  locally without an account. Implements just the commands lib/store-redis.ts uses.

    node scripts/fake-upstash.mjs [port]        (default 3489, token "local-test-token")
    UPSTASH_REDIS_REST_URL=http://localhost:3489 UPSTASH_REDIS_REST_TOKEN=local-test-token pnpm dev

  It is not Redis. Passing tests against it show the requests are well formed, not that a real
  Upstash database behaves the same.
*/
import { createServer } from "node:http";

const PORT = Number(process.argv[2] ?? 3489);
const TOKEN = "local-test-token";
const data = new Map(); // key -> { v, exp }
let calls = 0;

const now = () => Date.now();
function get(key) {
  const e = data.get(key);
  if (!e) return undefined;
  if (e.exp && e.exp <= now()) {
    data.delete(key);
    return undefined;
  }
  return e;
}

function run(cmd) {
  const [name, ...a] = cmd.map(String);
  const op = name.toUpperCase();
  switch (op) {
    case "GET":
      return get(a[0])?.v ?? null;
    case "SET": {
      const [key, value, ...opts] = a;
      const up = opts.map((o) => o.toUpperCase());
      const exists = get(key) !== undefined;
      if (up.includes("NX") && exists) return null;
      if (up.includes("XX") && !exists) return null;
      let exp = up.includes("KEEPTTL") ? get(key)?.exp ?? 0 : 0;
      const px = up.indexOf("PX");
      if (px >= 0) exp = now() + Number(opts[px + 1]);
      const ex = up.indexOf("EX");
      if (ex >= 0) exp = now() + Number(opts[ex + 1]) * 1000;
      data.set(key, { v: value, exp });
      return "OK";
    }
    case "DEL": {
      let n = 0;
      for (const k of a) if (get(k) !== undefined && data.delete(k)) n++;
      return n;
    }
    case "RPUSH": {
      const e = get(a[0]) ?? { v: [], exp: 0 };
      e.v.push(...a.slice(1));
      data.set(a[0], e);
      return e.v.length;
    }
    case "LLEN":
      return get(a[0])?.v.length ?? 0;
    case "LRANGE": {
      const list = get(a[0])?.v ?? [];
      const start = Number(a[1]);
      const stop = Number(a[2]);
      return list.slice(start, stop === -1 ? undefined : stop + 1);
    }
    case "HGET":
      return get(a[0])?.v[a[1]] ?? null;
    case "HSETNX": {
      const e = get(a[0]) ?? { v: {}, exp: 0 };
      data.set(a[0], e);
      if (a[1] in e.v) return 0;
      e.v[a[1]] = a[2];
      return 1;
    }
    case "INCR": {
      const e = get(a[0]) ?? { v: "0", exp: 0 };
      e.v = String(Number(e.v) + 1);
      data.set(a[0], e);
      return Number(e.v);
    }
    case "PEXPIRE": {
      const e = get(a[0]);
      if (!e) return 0;
      e.exp = now() + Number(a[1]);
      return 1;
    }
    case "PEXPIREAT": {
      const e = get(a[0]);
      if (!e) return 0;
      e.exp = Number(a[1]);
      return 1;
    }
    default:
      throw new Error(`ERR unknown command '${op}'`);
  }
}

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ error: "Unauthorized" }));
    }
    try {
      const parsed = JSON.parse(body);
      calls++;
      const one = (c) => {
        try {
          return { result: run(c) };
        } catch (e) {
          return { error: e.message };
        }
      };
      if (req.url === "/pipeline") return res.end(JSON.stringify(parsed.map(one)));
      const r = one(parsed);
      if (r.error) res.statusCode = 400;
      res.end(JSON.stringify(r));
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "bad request" }));
    }
  });
}).listen(PORT, () => console.log(`fake Upstash REST on http://localhost:${PORT}`));

process.on("SIGTERM", () => {
  console.log(`fake Upstash: ${calls} calls, ${data.size} keys`);
  process.exit(0);
});
