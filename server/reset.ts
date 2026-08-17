import { readFileSync } from "node:fs";
import path from "node:path";
import { getPool } from "./db";

async function main() {
  const pool = await getPool("teamup");

  /*
   * 專案目前沒有獨立 Migration Runner，
   * 因此重置資料前先以可重複執行的 auth.sql 確保 Auth Schema 存在。
   */
  const authSql = readFileSync(
    path.join(process.cwd(), "server", "sql", "auth.sql"),
    "utf8",
  );

  const resetSql = readFileSync(
    path.join(process.cwd(), "server", "sql", "reset.sql"),
    "utf8",
  );

  // auth.sql 與 reset.sql 分開執行，較容易定位實際失敗階段。
  await pool.request().batch(authSql);
  await pool.request().batch(resetSql);

  console.log("TeamUp reset complete");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});