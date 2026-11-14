# Cheer Pressure messages

A small messaging service and two phone pages. The person using the Cheer Pressure desktop app
can ask someone they trust (a sister, a friend) to get in touch, and that person can send a
short greeting or a simple question ("Walk after lunch?") from their own phone. The person
answers yes, no or with a few words.

Only these short messages ever reach this service. Never sensor data, typing measurements,
check-in answers or anything about health.

This folder is its own package (Next.js 16.3.5, App Router, TypeScript, pnpm) inside the desktop
app's repo.

## Run it

Needs Node 20 or newer and pnpm.

```bash
cd server
pnpm install
pnpm dev            # http://localhost:3480, listening on all interfaces
```

Other commands:

```bash
pnpm build && pnpm start      # production build on 3480, listening on all interfaces
pnpm lint
pnpm typecheck
npx tsx ../scripts/test-messages.mts http://localhost:3480   # from the repo root: the API, the refusals, the client
node scripts/drive-pages.mjs http://localhost:3480 [shots]   # the phone pages in a headless browser
```

`drive-pages.mjs` needs a Chromium headless shell for playwright-core
(`npx playwright-core install chromium-headless-shell`). It never opens a window.

To try it by hand: `curl -X POST localhost:3480/api/pairs`, then open `inviteUrl` in one browser
profile (the trusted person) and `userUrl` in another (the person's phone).

## A table demo over a phone hotspot

The laptop runs the service; the phones and the desktop app reach it over the hotspot's network.

1. Join the laptop and every phone to the same hotspot (or Wi-Fi without client isolation).
2. Find the laptop's address on it:

   ```bash
   ipconfig getifaddr en0        # macOS Wi-Fi, for example 192.168.1.20 (try en1 if empty)
   ```

3. Start the service (production is steadier for a demo than dev):

   ```bash
   cd server
   pnpm build && pnpm start      # or: pnpm dev
   ```

   Check it from a phone: open `http://192.168.1.20:3480` in its browser; it shows two sentences.
   If it does not load, macOS may have asked whether Node may accept incoming connections: allow it.
4. In the desktop app: **Settings**, **For the demo**, **Messages service**, type
   `http://192.168.1.20:3480` (or just `192.168.1.20`), **Save**.
5. **Settings**, **Someone you trust**, **Invite someone**. The QR code and link now point at
   `http://192.168.1.20:3480/t/...`: the trusted person scans it with their phone's camera.

Invite and user links use the host the request came in on, so they point at the address typed
in step 4 (unless `PUBLIC_BASE_URL` is set). The links are plain http on the local network;
that is fine for a demo, not for real use. Everything is in memory: restarting the service
ends every pair (set the Redis variables to keep them). Under `pnpm dev` the laptop's own
network addresses are allowed to load the dev scripts (`next.config.ts`); another host name
would need adding to `allowedDevOrigins`.

## The pages

| Address | Who | What |
| --- | --- | --- |
| `/` | anyone | Two sentences: what this is, and that pairing starts in the desktop app |
| `/t/<pair>?i=<inviteToken>` | the trusted person | First name, then home ("They asked you to get in touch" when they did), then "Send a few words" with three quick picks or free text, then waiting for the answer ("They said yes") |
| `/u/<pair>?u=<userToken>` | the person's own phone | The newest greeting or question with Yes / No / a short reply, and a quiet "Ask them to get in touch" |

On first load the token moves from the address into the phone's localStorage and the address is
cleaned. Every screen has "Need help now?" with 112 and a marked placeholder for the clinic.

Local first: the pages render the last known conversation from the phone at once, a message
shows as "Sending" the moment it is tapped, then "Sent", or "Waiting for connection" while the
network is down (it goes by itself when the network returns). A short offline line replaces
error messages.

Colours, type and spacing live in `styles/tokens.css`, copied once from the desktop app's
`../styles/tokens.css`; a designer can restyle that one file.

## API

All JSON, under `/api`. Errors are `{ "error": "<short text>" }`.

| Method and path | Auth | Does | Answers |
| --- | --- | --- | --- |
| `POST /api/pairs` | none | Creates a pair | 201 `{ pair, userToken, inviteToken, inviteUrl, userUrl, expiresAt }`; 429 after 20 pairs per hour from one client |
| `POST /api/pairs/<pair>/join` | `{ inviteToken, name }` in the body | The trusted person joins. Joining again replaces the name and issues a new trusted token (the old one stops working) | 200 `{ trustedToken, name }`; 400, 401, 404 |
| `POST /api/pairs/<pair>/events` | `Bearer <user or trusted token>` | Sends `{ type, clientId, text, kind?, replyTo?, answer? }`. The server sets `v`, `id`, `ts`, `pair`, `from`. Only the trusted person sends `greeting`; only the person sends `contact_request`; both send `reply` | 201 `{ event }`; 200 `{ event, duplicate: true }` for a repeated `clientId`; 400, 401, 403, 404, 413, 429 |
| `GET /api/pairs/<pair>/events?since=<event id or ISO time>` | Bearer, either role | Events after `since`, oldest first | 200 `{ events, role, trustedName, serverTime, expiresAt }`; 400, 401, 404 |
| `DELETE /api/pairs/<pair>` | Bearer, the person's token | Removes everything for the pair | 200; 401, 403, 404 |

Event shapes and the limits (text 1 to 280 characters, name 1 to 40) are in `lib/events.ts`.

Rules: tokens are 32 random bytes; the server stores only their SHA-256 hashes and compares them
in constant time. A pair and everything in it expires 48 hours after creation. At most 30 events
per minute and 500 events per pair. Bodies over 4 KB are refused (413). A repeated `clientId`
within a pair returns the original event, so a retry never creates a duplicate. Polling every
1.5 s is fine: a poll is one read of the pair and one of its events, no long-poll.

CORS allows GET, POST and DELETE with the Authorization header from `tauri://localhost`,
`http://tauri.localhost`, `http://localhost:3470` and every origin in `ALLOWED_ORIGINS`.

## What the server holds, and for how long

Per pair, for at most 48 hours from creation (then it is gone; DELETE removes it at once):

- the 6-character pair code, when it was created and when it expires
- SHA-256 hashes of the person's token, the invite token and the trusted person's token
- the trusted person's first name, as they typed it
- the messages: type, text (at most 280 characters), greeting or question, yes / no answer,
  which message a reply answers, who sent it (role only), time, and a random `clientId`
- a per-pair counter of events in the current minute

Per client, for an hour: a counter of pairs created, keyed by a truncated hash of the IP address.

It never receives sensor data, typing timings, activity times, check-in or weekly answers,
notes, the person's name, or anything about health. It does not log message text or tokens
(the dev server's request log is turned off because invite links carry a token).

## Storage

One small interface (`lib/store.ts`) with two implementations:

- **In memory** (default). For local development and tests. **It does not survive a restart,
  and on a serverless host each instance has its own memory, so pairs disappear at random. A
  deployed service needs the Redis variables.**
- **Redis over REST**, Upstash-compatible, with plain `fetch` and no SDK (`lib/store-redis.ts`).
  Used when both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set. All keys
  expire with the pair. `scripts/fake-upstash.mjs` is a tiny local stand-in used to test this
  path without an account; it is not Redis.

## Environment variables

| Name | Needed | What |
| --- | --- | --- |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | when deployed | Redis over REST. Without both, the in-memory store is used |
| `ALLOWED_ORIGINS` | no | Extra CORS origins, comma separated (for example the desktop app's web build) |
| `PUBLIC_BASE_URL` | no | The address used in `inviteUrl` and `userUrl`. Default: the address the request came in on |
| `PAIR_TTL_SECONDS` | no | Shortens the 48-hour lifetime (it can never lengthen it). Used to test expiry |

## Deploy to Vercel later

1. Import the repo in Vercel and set **Root Directory** to `server`. The framework is detected
   as Next.js; build command `pnpm build`.
2. Add an Upstash Redis database (Vercel Marketplace or upstash.com) and set
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. Set `ALLOWED_ORIGINS` if the desktop UI runs from an origin not in the built-in list.
4. Point the desktop app at it with `NEXT_PUBLIC_MESSAGES_URL=https://<your-deployment>`.

Not done yet: nothing has been deployed, and no Upstash database exists.

## Not built

- Push notifications. The phones poll every 1.5 s while the page is open.
- More than one trusted person per pair.
- Accounts, or anything that lasts longer than 48 hours.
- A share sheet for the links (the desktop app shows a QR code and a Copy button).
- Read receipts or typing indicators.
- A rate limit on polling (only on sending and on creating pairs).
- Translations. The pages are English only.
