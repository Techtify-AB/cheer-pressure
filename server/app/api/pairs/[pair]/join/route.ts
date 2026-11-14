import { checkName } from "../../../../../lib/events";
import { error, guarded, hashToken, json, loadPair, newToken, preflight, readJson, sameHash, store } from "../../../../../lib/service";

type Ctx = { params: Promise<{ pair: string }> };

// POST /api/pairs/[pair]/join { inviteToken, name }: the trusted person joins.
// One trusted person per pair. Joining again with the invite replaces the name and issues a
// new trusted token; the old one stops working.
export const POST = guarded(async (req: Request, ctx: Ctx) => {
  const { pair } = await ctx.params;
  const rec = await loadPair(req, pair);
  if (rec instanceof Response) return rec;
  const body = (await readJson(req)) as { inviteToken?: unknown; name?: unknown } | null;
  if (!body || typeof body !== "object") return error(req, 400, "body must be a JSON object");
  if (typeof body.inviteToken !== "string" || !sameHash(rec.inviteTokenHash, hashToken(body.inviteToken))) {
    return error(req, 401, "invite is not valid for this pair");
  }
  const name = checkName(body.name);
  if (!name.ok) return error(req, 400, name.error);
  const trustedToken = newToken();
  const ok = await store().setTrusted(pair, name.value, hashToken(trustedToken), Date.now());
  if (!ok) return error(req, 404, "pair not found");
  return json(req, 200, { trustedToken, name: name.value });
});

export const OPTIONS = (req: Request) => preflight(req);
