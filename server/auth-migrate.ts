import { readFileSync } from "node:fs";
import path from "node:path";
import { getPool } from "./db";

async function main() {
  const pool = await getPool("teamup");
  const schema = readFileSync(path.join(process.cwd(), "server", "sql", "auth.sql"), "utf8");

  // 只套用可重複執行的 Auth Schema，不清除既有活動或點數資料。
  await pool.request().batch(schema);
  await pool.close();
  console.log("TeamUp auth schema ready");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
