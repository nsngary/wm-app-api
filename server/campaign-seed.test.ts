import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const seed = readFileSync("server/sql/seed.sql", "utf8");
const campaignSeed = seed.slice(0, seed.indexOf("IF OBJECT_ID(N'dbo.Activity'"));

assert.match(campaignSeed, /SET XACT_ABORT ON;[\s\S]*BEGIN TRAN;/);
assert.match(campaignSeed, /FROM dbo\.Campaign WITH \(UPDLOCK, HOLDLOCK\)/);
assert.match(campaignSeed, /startsOn <= @defaultEndsOn\s+AND endsOn >= @defaultStartsOn/);
assert.doesNotMatch(
  campaignSeed,
  /WHERE name = N'2026 Q3'/,
  "Renaming the seeded campaign must not make reseeding insert an overlapping default row.",
);
assert.match(campaignSeed, /COMMIT;/);

console.log("campaign seed contracts ok");
