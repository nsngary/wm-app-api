import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync("server/sql/seed.sql", "utf8");
const freshSchema = readFileSync("TeamUp.sql", "utf8");
const runner = readFileSync("server/seed.ts", "utf8");

assert.match(
  sql,
  /ALTER TABLE dbo\.ExpPointLedger ADD eventID BIGINT NULL;[\s\S]*?\bGO\b\s*IF NOT EXISTS/i,
  "The new eventID column must be committed in its own SQL batch before later statements compile.",
);
assert.match(runner, /split\(\/\^\\s\*GO\\s\*\$\/gim\)/);
assert.match(runner, /for \(const batch of batches\)[\s\S]*await pool\.request\(\)\.batch\(batch\)/);

for (const table of ["CustomerProgress", "ExpPointLedger", "CustomerReward"]) {
  assert.match(sql, new RegExp(`COL_LENGTH\\(N'dbo\\.${table}', N'campaignID'\\)`));
  assert.match(freshSchema, new RegExp(`CREATE TABLE dbo\\.${table} \\([\\s\\S]*?campaignID BIGINT NULL`));
}
assert.match(sql, /UX_CustomerProgress_CustomerCampaign/);
assert.match(sql, /IX_ExpPointLedger_CustomerCampaign/);
assert.match(sql, /IX_CustomerReward_CustomerCampaign/);
assert.match(freshSchema, /CREATE TABLE dbo\.Campaign/);
assert.match(freshSchema, /UX_CustomerProgress_CustomerCampaign/);
assert.match(freshSchema, /UX_ExpPointLedger_Source[\s\S]*campaignID/);
assert.match(freshSchema, /UX_CustomerReward_Source[\s\S]*campaignID/);
assert.match(sql, /COL_LENGTH\(N'dbo\.Event', N'campaignID'\)/);
assert.match(sql, /FK_Event_Campaign/);
assert.match(sql, /IX_Event_CampaignStart/);
assert.match(
  sql,
  /HAVING COUNT\(\*\) = 1[\s\S]*UPDATE event[\s\S]*SET campaignID = owner\.campaignID/,
  "Only events with one deterministic Campaign match may be backfilled.",
);
assert.doesNotMatch(
  sql,
  /UPDATE dbo\.CustomerProgress\s+SET campaignID = @openCampaignID\s+WHERE campaignID IS NULL/,
  "Legacy cumulative progress must not be assigned to a new open Campaign.",
);
assert.match(freshSchema, /CREATE TABLE dbo\.\[Event\] \([\s\S]*campaignID BIGINT NULL/);
assert.match(freshSchema, /FK_Event_Campaign/);
assert.match(freshSchema, /IX_Event_CampaignStart/);

console.log("seed batch contracts ok");
