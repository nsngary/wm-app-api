import assert from "node:assert/strict";
import test from "node:test";

import {
  REDEMPTION_AUDIENCE_SQL,
  mapRedemptionAudience,
} from "./notification-audience";

test("audience mapper preserves an open campaign with no eligible dealers", () => {
  assert.deepEqual(mapRedemptionAudience([{
    campaignID: 9,
    campaignEndDate: "2026-09-30",
    CustomerID: null,
  }]), {
    campaignID: 9,
    campaignEndDate: "2026-09-30",
    dealerIDs: [],
  });
});

test("audience mapper de-duplicates dealers", () => {
  assert.deepEqual(mapRedemptionAudience([
    { campaignID: 9, campaignEndDate: "2026-09-30", CustomerID: "D001" },
    { campaignID: 9, campaignEndDate: "2026-09-30", CustomerID: "D001" },
  ])?.dealerIDs, ["D001"]);
});

test("audience mapper returns null without an open campaign", () => {
  assert.equal(mapRedemptionAudience([]), null);
});

test("audience SQL matches redeemable normal user_redeem rewards", () => {
  assert.match(REDEMPTION_AUDIENCE_SQL, /rr\.isActive = 1/);
  assert.match(REDEMPTION_AUDIENCE_SQL, /rr\.rewardType = N'normal'/);
  assert.match(REDEMPTION_AUDIENCE_SQL, /rr\.issueMode = N'user_redeem'/);
  assert.match(REDEMPTION_AUDIENCE_SQL, /p\.currentLevelNo >= rr\.levelNo/);
  assert.match(REDEMPTION_AUDIENCE_SQL, /p\.pointBalance >= rr\.pointCost/);
  assert.match(REDEMPTION_AUDIENCE_SQL, /cr\.status <> N'voided'/);
});
