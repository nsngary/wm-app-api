import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = readFileSync("TeamUp.sql", "utf8");
const seed = readFileSync("server/sql/seed.sql", "utf8");
const api = readFileSync("server/api.ts", "utf8");

assert.match(schema, /ExpPointLedger[\s\S]*eventID BIGINT NULL/);
assert.match(schema, /FK_ExpPointLedger_Event/);
assert.match(seed, /COL_LENGTH\(N'dbo\.ExpPointLedger', N'eventID'\)/);
assert.match(seed, /UPDATE[\s\S]*ExpPointLedger[\s\S]*Attendance/);
assert.match(
  seed,
  /LegacyCompanionCandidates AS \([\s\S]*TRY_CONVERT\(BIGINT, LEFT\(ledger\.sourceID,[\s\S]*JOIN dbo\.\[Event\][\s\S]*JOIN dbo\.Attendance/,
);

for (const functionName of ["checkInRule1", "checkInRule2", "insertCompanionDirectNewcomerBonus"]) {
  const start = api.indexOf(`async function ${functionName}`);
  assert.notEqual(start, -1, `${functionName} must exist`);

  const end = api.indexOf("\nasync function ", start + 1);
  const inserts = [
    ...api
      .slice(start, end)
      .matchAll(/INSERT dbo\.ExpPointLedger \(([^)]*)\)\s*VALUES \(([\s\S]*?)\);/g),
  ];

  assert.equal(inserts.length, 1, `${functionName} must have one ledger insert`);
  assert.match(inserts[0][1], /\beventID\b/, `${functionName} ledger columns must include eventID`);
  assert.match(inserts[0][2], /@eventID\b/, `${functionName} ledger values must include @eventID`);
}
