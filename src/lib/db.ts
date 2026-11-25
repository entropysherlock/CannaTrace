import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";

const globalForDb = globalThis as unknown as { pool?: Pool };

const pool =
  globalForDb.pool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: process.env.NODE_ENV === "production" ? 5 : 10,
  });

if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

// A connection the database drops while it sits idle (a restart, a failover, a pooler timeout) is reported on the
// pool as an "error" event. With nobody listening Node treats that as an uncaught exception and ends the process,
// so log it and let the pool open a fresh connection on the next query.
if (pool.listenerCount("error") === 0) {
  pool.on("error", (error) => {
    console.error("[db] an idle database connection was lost; the pool will reconnect:", error.message);
  });
}

// The pool's listener above only covers connections sitting idle. A connection that dies while a query or
// transaction is using it emits "error" on the client itself, and with no listener Node ends the process even
// though the running query already fails normally. Give every client a permanent listener so a dropped
// connection only fails the work it was serving. (Apex finding APEX-31, found by CI.)
const guarded = pool as Pool & { __clientGuard?: boolean };
if (!guarded.__clientGuard) {
  guarded.__clientGuard = true;
  pool.on("connect", (client) => {
    client.on("error", (error) => {
      console.error("[db] a database connection was lost while in use:", error.message);
    });
  });
}

const base = drizzle(pool, { schema });

export type Db = typeof base;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * The transaction a multi-step job (a Tally plan, or an undo) is running in. While one is open,
 * every query through `db` uses it, and each inner `db.transaction` becomes a savepoint inside it,
 * so the whole job saves together or not at all, and later steps see what earlier steps made.
 * Outside a job, `db` behaves exactly as plain Drizzle.
 */
const ambient = new AsyncLocalStorage<Tx>();

function transaction<T>(fn: (tx: Tx) => Promise<T>, config?: Parameters<Db["transaction"]>[1]): Promise<T> {
  const outer = ambient.getStore();
  if (!outer) return base.transaction(fn, config);
  return outer.transaction((tx) => ambient.run(tx, () => fn(tx)));
}

export const db = new Proxy(base, {
  get(target, prop) {
    if (prop === "transaction") return transaction;
    const current = ambient.getStore() ?? target;
    const value = Reflect.get(current, prop, current);
    return typeof value === "function" ? value.bind(current) : value;
  },
}) as Db;

/** Run fn as one all-or-nothing unit. Nested calls become savepoints. */
export function atomically<T>(fn: () => Promise<T>): Promise<T> {
  const outer = ambient.getStore();
  if (outer) return outer.transaction((tx) => ambient.run(tx, fn));
  return base.transaction((tx) => ambient.run(tx, fn));
}

class DryRunDone<T> extends Error {
  constructor(readonly result: T) {
    super("dry run");
  }
}

/**
 * Run fn for real inside a transaction, then roll everything back. Used to check a whole plan
 * with the same code and rules that will run on Confirm, without saving anything.
 */
export async function dryRun<T>(fn: () => Promise<T>): Promise<T> {
  try {
    await atomically(async () => {
      throw new DryRunDone(await fn());
    });
  } catch (error) {
    if (error instanceof DryRunDone) return error.result as T;
    throw error;
  }
  throw new Error("unreachable");
}

export { pool };
