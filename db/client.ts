import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { getEnv } from "@/lib/env";

let _pool: Pool | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function parseUrl(url: string) {
  console.log("DB_CONNECT_ATTEMPT", url.substring(0, 30) + "...");
  return {
    connectionString: url,
    ssl: { rejectUnauthorized: false, require: true },
    max: 5,
    connectionTimeoutMillis: 10000,
  };
}

export function getDb() {
  if (!_db) {
    const opts = parseUrl(getEnv().DATABASE_URL);
    _pool = new Pool(opts);
    _pool.on("error", (err: Error) => {
      console.error("POOL_ERROR", JSON.stringify({name: err.name, message: err.message, code: (err as any).code, detail: (err as any).detail, hint: (err as any).hint, routine: (err as any).routine, where: (err as any).where}));
    });
    // Test connection immediately
    _pool.query("SELECT 1").then(() => {
      console.log("DB_CONNECT_OK");
    }).catch((err: Error) => {
      console.error("DB_CONNECT_FAIL", err.name, err.message, (err as any).code, (err as any).routine, (err as any).detail);
    });
    _db = drizzle(_pool, { schema });
  }
  return _db;
}

export function getPool() {
  if (!_pool) {
    getDb();
  }
  return _pool!;
}

export type DB = ReturnType<typeof getDb>;
