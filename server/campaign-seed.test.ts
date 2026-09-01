import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const seed = readFileSync("server/sql/seed.sql", "utf8");

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

console.log("campaign seed contracts ok");
