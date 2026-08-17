import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };
const sql = readFileSync("server/sql/reset.sql", "utf8");

assert.equal(packageJson.scripts?.reset, "tsx server/reset.ts");

for (const table of ["CustomerReward", "ExpPointLedger", "Attendance", "StaffQrCode", "CustomerProgress"]) {
  assert.match(sql, new RegExp(`DELETE\\s+FROM\\s+dbo\\.${table}`, "i"));
}

for (const table of ["\\[Event\\]", "LevelRule", "ExpPointRule", "RewardRule"]) {
  assert.doesNotMatch(sql, new RegExp(`DELETE\\s+FROM\\s+dbo\\.${table}`, "i"));
}

assert.ok(sql.indexOf("dbo.Attendance") < sql.indexOf("dbo.StaffQrCode"));

console.log("reset contract ok");
