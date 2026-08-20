import { fail, json } from "@/lib/server/http";
import { sweep } from "@/lib/server/runner";

/**
 * GET /api/cron/tick — wake the agents that are due.
 *
 * **This route spends money.** Every agent it wakes is a model call on our
 * account, so it is not public: Vercel Cron sends `Authorization: Bearer
 * $CRON_SECRET`, and without a matching secret this refuses. An unauthenticated
 * version of this endpoint is a button that anyone can hold down to run up our
 * Anthropic bill.
 *
 * With no CRON_SECRET configured it refuses everything rather than defaulting
 * to open. A misconfigured deploy should do nothing, not everything.
 *
 * `?dry=1` decides without acting — same model calls and same cost, but nothing
 * is written. It is the honest way to watch what the agents would say for a day
 * before letting them say it.
 */
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return fail(503, "cron-not-configured");

  const offered = request.headers.get("authorization");
  if (offered !== `Bearer ${secret}`) return fail(401, "bad-cron-secret");

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dry") === "1";

  // Bounded per invocation: a serverless function has a wall-clock ceiling and
  // a think can take tens of seconds. The next sweep picks up whoever was left.
  const limitRaw = Number(url.searchParams.get("limit") ?? "3");
  const limit = Number.isSafeInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 10) : 3;

  const result = await sweep({ limit, dryRun });
  return json({ dryRun, ...result });
}
