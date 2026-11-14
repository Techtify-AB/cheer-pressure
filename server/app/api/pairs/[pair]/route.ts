import { authorize, error, guarded, json, preflight, store } from "../../../../lib/service";

type Ctx = { params: Promise<{ pair: string }> };

// DELETE /api/pairs/[pair]: the person (user token) removes everything for the pair.
export const DELETE = guarded(async (req: Request, ctx: Ctx) => {
  const { pair } = await ctx.params;
  const auth = await authorize(req, pair);
  if (auth instanceof Response) return auth;
  if (auth.role !== "user") return error(req, 403, "only the person can delete the pair");
  await store().deletePair(pair);
  return json(req, 200, { deleted: true });
});

export const OPTIONS = (req: Request) => preflight(req);
