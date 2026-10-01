import { appendFileSync } from "node:fs";
import pg from "pg";

const [mode] = process.argv.slice(2);
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  if (mode === "assert-empty") {
    const result = await client.query(
      "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const count = result.rows[0]?.count ?? -1;
    if (count !== 0) {
      throw new Error(`expected empty public schema, found ${count} tables`);
    }
    console.log("EMPTY_DATABASE_PASS");
  } else if (mode === "migration-count") {
    const result = await client.query(
      "SELECT count(*)::int AS count FROM _schema_migrations",
    );
    const count = String(result.rows[0]?.count ?? 0);
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `count=${count}\n`);
    }
    console.log(`migration_count=${count}`);
  } else {
    throw new Error("usage: node scripts/ci/v1-db-evidence.mjs <assert-empty|migration-count>");
  }
} finally {
  await client.end();
}
