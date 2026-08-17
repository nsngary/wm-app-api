import { readFileSync } from "node:fs";
import path from "node:path";
import { getPool } from "./db";

async function main() {
  const pool = await getPool("teamup");
  const sql = readFileSync(path.join(process.cwd(), "server", "sql", "seed.sql"), "utf8");
  const batches = sql.split(/^\s*GO\s*$/gim).map((batch) => batch.trim()).filter(Boolean);
  for (const batch of batches) await pool.request().batch(batch);
  console.log("TeamUp seed complete");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
