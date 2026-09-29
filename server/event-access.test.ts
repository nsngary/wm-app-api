import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync("server/api.ts", "utf8");
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

for (const [method, path, next, allowed] of [
  ["POST", "/api/events", 'if (req.method === "POST" && path === "/api/staff-qr")', ["manager", "admin"]],
  ["POST", "/api/staff-qr", 'if (req.method === "POST" && path === "/api/checkins")', ["manager", "admin"]],
  ["DELETE", "/api/events/42", 'if (req.method === "POST" && path === "/api/events")', ["admin"]],
] as const) {
  test(`${method} ${path} enforces event access`, async () => {
    const marker = method === "DELETE"
      ? 'if (req.method === "DELETE" && eventDeleteRoute)'
      : `if (req.method === "POST" && path === "${path}")`;
    const start = source.indexOf(marker);
    assert.ok(start >= 0, `${marker} route exists`);
    const route = new AsyncFunction("req", "path", "principal", "requireStaffAccess", "requireRole", "body", "createEventSession", "staffQr", "deleteEventSession", "eventDeleteRoute", "send", "res", "ApiError", source.slice(start, source.indexOf(next, start)));
    for (const role of ["staff", "manager", "admin"]) {
      let mutations = 0;
      const mutate = async () => { mutations++; };
      const run = () => route({ method }, path, {}, async (_: unknown, minimum: string) => {
        if (role === "staff" || (minimum === "admin" && role !== "admin")) throw new Error("Forbidden");
        return role;
      }, () => {}, async () => ({}), mutate, mutate, mutate, [path, "42"], () => {}, {}, Error);
      if ((allowed as readonly string[]).includes(role)) {
        await run();
        assert.equal(mutations, 1);
      } else {
        await assert.rejects(run);
        assert.equal(mutations, 0);
      }
    }
  });
}

test("deleting preserves attendance and ledger records", () => {
  const start = source.indexOf("async function deleteEventSession(");
  assert.ok(start >= 0);
  const deletion = source.slice(start, source.indexOf("async function createEventSession", start));
  assert.match(deletion, /UPDATE dbo\.\[Event\] SET isActive = 0/);
  assert.match(deletion, /404/);
  assert.doesNotMatch(deletion, /DELETE FROM/);
});
