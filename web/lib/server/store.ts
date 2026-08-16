import { MemoryStore, PostgresStore, type Store } from "@parley/server";

/**
 * The one store the route handlers share.
 *
 * Held at module scope so a warm serverless instance reuses its connection
 * pool instead of opening one per request. Cold instances each build their
 * own, which is why `DATABASE_URL` in production should be a *pooled*
 * connection string — Neon's `-pooler` host, or Vercel Postgres' `POSTGRES_URL`
 * rather than `POSTGRES_URL_NON_POOLING`. Point this at a direct connection and
 * a burst of traffic will exhaust the server's connection limit.
 */
let pending: Promise<Store> | null = null;

export function getStore(): Promise<Store> {
  if (!pending) pending = open();
  return pending;
}

async function open(): Promise<Store> {
  const url = process.env.DATABASE_URL;

  if (!url) {
    // A missing database in production is a misconfiguration, not something to
    // paper over: MemoryStore would accept every write and lose all of it on
    // the next cold start, and the site would look like it worked.
    if (process.env.NODE_ENV === "production") {
      throw new Error("DATABASE_URL is not set");
    }
    return new MemoryStore();
  }

  const store = new PostgresStore(url);
  await store.init();
  return store;
}
