import {
  PAIR_TTL_MS,
  PAIRS_PER_HOUR_PER_CLIENT,
  clientKey,
  error,
  guarded,
  hashToken,
  json,
  newPairCode,
  newToken,
  preflight,
  publicBase,
  store,
} from "../../../lib/service";

// POST /api/pairs: creates a pair. Returns the tokens once; the server keeps only their hashes.
export const POST = guarded(async (req: Request) => {
  const now = Date.now();
  if ((await store().hit(`create:${clientKey(req)}`, 3_600_000, now)) > PAIRS_PER_HOUR_PER_CLIENT) {
    return error(req, 429, "too many pairs created, try again later", { "Retry-After": "3600" });
  }
  const userToken = newToken();
  const inviteToken = newToken();
  for (let attempt = 0; attempt < 8; attempt++) {
    const pair = newPairCode();
    const created = await store().createPair({
      pair,
      createdAt: now,
      expiresAt: now + PAIR_TTL_MS,
      userTokenHash: hashToken(userToken),
      inviteTokenHash: hashToken(inviteToken),
      trustedTokenHash: null,
      trustedName: null,
    });
    if (!created) continue;
    const base = publicBase(req);
    return json(req, 201, {
      pair,
      userToken,
      inviteToken,
      inviteUrl: `${base}/t/${pair}?i=${inviteToken}`,
      userUrl: `${base}/u/${pair}?u=${userToken}`,
      expiresAt: new Date(now + PAIR_TTL_MS).toISOString(),
    });
  }
  return error(req, 503, "could not create a pair, try again");
});

export const OPTIONS = (req: Request) => preflight(req);
