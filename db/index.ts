import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const globalForDatabase = globalThis as unknown as { lcPool?: Pool };
export const pool =
  globalForDatabase.lcPool ??
  new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

if (process.env.NODE_ENV !== "production") globalForDatabase.lcPool = pool;

export const db = drizzle(pool, { schema });
