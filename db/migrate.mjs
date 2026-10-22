import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

try {
  await migrate(drizzle(pool), { migrationsFolder: "db/migrations" });
  console.log("Database migrations completed");
} finally {
  await pool.end();
}
