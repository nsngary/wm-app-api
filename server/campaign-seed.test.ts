import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const seed = readFileSync("server/sql/seed.sql", "utf8");
const bootstrap = readFileSync("server/sql/bootstrap-first-admin.sql", "utf8");

assert.doesNotMatch(
  seed,
  /INSERT\s+dbo\.Campaign\b/i,
  "Production seed must not create a hard-coded Campaign.",
);
assert.doesNotMatch(
  seed,
  /INSERT\s+dbo\.\[Event\]\b/i,
  "Production seed must not create sample Events.",
);
assert.match(
  bootstrap,
  /DECLARE @subjectID VARCHAR\(50\) = 'EP00821121'/,
);
assert.match(
  bootstrap,
  /IF EXISTS[\s\S]*accessLevel = N'admin'[\s\S]*THROW 51001/,
);

console.log("campaign seed contracts ok");
