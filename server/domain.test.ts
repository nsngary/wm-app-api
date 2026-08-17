import assert from "node:assert/strict";
import {
  applyCheckIn,
  applyRedeem,
  applyRewardClaim,
  applyRule2CompanionCheckIn,
  parseQrPayload,
  syncCompanionDirectNewcomerBonuses,
  syncSpecialRewards,
  type WorkflowState,
} from "./domain";

function state(): WorkflowState {
  return {
    levels: [
      { levelNo: 1, levelName: "Starter", expRequired: 0 },
      { levelNo: 2, levelName: "Player", expRequired: 50 },
      { levelNo: 3, levelName: "Expert", expRequired: 100 },
      { levelNo: 4, levelName: "Ambassador", expRequired: 250 },
    ],
    events: [{ eventID: 1, eventType: "sha", eventName: "SHA", isActive: true }],
    qrCodes: [
      {
        staffQrID: 1,
        eventID: 1,
        qrCode: "QR-1",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        isActive: true,
      },
    ],
    expRules: [
      {
        expPointRuleID: 1,
        eventType: "sha",
        participantType: "dealer",
        expAmount: 15,
        pointAmount: 15,
        isActive: true,
      },
      {
        expPointRuleID: 2,
        eventType: "direct_newcomer_companion",
        participantType: "dealer",
        expAmount: 5,
        pointAmount: 5,
        isActive: true,
      },
    ],
    rewardRules: [
      {
        rewardRuleID: 1,
        levelNo: 1,
        rewardName: "Coupon",
        rewardQty: 1,
        rewardUnit: "pc",
        pointCost: 10,
        rewardType: "normal",
        issueMode: "user_redeem",
        sortOrder: 1,
        isActive: true,
      },
      {
        rewardRuleID: 2,
        levelNo: 2,
        rewardName: "Special Pack",
        rewardQty: 3,
        rewardUnit: "pack",
        pointCost: 0,
        rewardType: "new_manager_special",
        issueMode: "system_auto",
        sortOrder: 2,
        isActive: true,
      },
      {
        rewardRuleID: 3,
        levelNo: 3,
        rewardName: "Better Special Pack",
        rewardQty: 5,
        rewardUnit: "pack",
        pointCost: 0,
        rewardType: "new_manager_special",
        issueMode: "system_auto",
        sortOrder: 3,
        isActive: true,
      },
      {
        rewardRuleID: 4,
        levelNo: 4,
        rewardName: "Best Special Pack",
        rewardQty: 7,
        rewardUnit: "pack",
        pointCost: 0,
        rewardType: "new_manager_special",
        issueMode: "system_auto",
        sortOrder: 4,
        isActive: true,
      },
    ],
    attendances: [],
    ledger: [],
    progress: {},
    customerRewards: [],
  };
}

assert.throws(
  () => parseQrPayload(JSON.stringify({ kind: "reward_claim", giftCode: "GFT-1" }), "staff_checkin"),
  /Expected staff_checkin/,
);

const s = state();
const first = applyCheckIn(s, {
  qrCode: "QR-1",
  customerId: "TW2626369",
  participantType: "dealer",
  participantName: "Guest",
  now: new Date().toISOString(),
});
assert.equal(first.expDelta, 15);
assert.equal(first.pointDelta, 15);
assert.equal(s.progress.TW2626369.expTotal, 15);
assert.equal(s.progress.TW2626369.pointBalance, 15);
assert.equal(s.ledger.length, 1);

const duplicate = applyCheckIn(s, {
  qrCode: "QR-1",
  customerId: "TW2626369",
  participantType: "dealer",
  participantName: "Guest",
  now: new Date().toISOString(),
});
assert.equal(duplicate.duplicate, true);
assert.equal(s.ledger.length, 1);

const redeemed = applyRedeem(s, {
  customerId: "TW2626369",
  rewardRuleID: 1,
  giftCode: "GFT-1",
  now: new Date().toISOString(),
});
assert.equal(redeemed.status, "issue");
assert.equal(s.progress.TW2626369.pointBalance, 5);
assert.equal(s.ledger.at(-1)?.pointDelta, -10);

const claimed = applyRewardClaim(s, {
  giftCode: "GFT-1",
  salesId: "S-1",
  employeeId: "EP-1",
  now: new Date().toISOString(),
});
assert.equal(claimed.status, "got");
assert.equal(claimed.isGet, true);
assert.equal(claimed.SalesID, "S-1");

s.progress.TW2626369.expTotal = 80;
s.progress.TW2626369.currentLevelNo = 2;
const special = syncSpecialRewards(s, {
  customerId: "TW2626369",
  joinedCustomerIds: ["C-NEW"],
  now: new Date().toISOString(),
});
assert.equal(special.length, 1);
assert.equal(special[0].issueMode, "system_auto");
assert.equal(special[0].rewardQty, 3);
assert.equal(syncSpecialRewards(s, {
  customerId: "TW2626369",
  joinedCustomerIds: ["C-NEW"],
  now: new Date().toISOString(),
}).length, 0);
assert.equal(s.customerRewards.find((reward) => reward.sourceID === "C-NEW")?.rewardRuleID, 2);

s.progress.TW2626369.expTotal = 120;
s.progress.TW2626369.currentLevelNo = 3;
syncSpecialRewards(s, {
  customerId: "TW2626369",
  joinedCustomerIds: ["C-NEW"],
  now: new Date().toISOString(),
});
const upgraded = s.customerRewards.find((reward) => reward.sourceID === "C-NEW");
assert.equal(upgraded?.rewardRuleID, 3);
assert.equal(upgraded?.rewardQty, 5);

s.progress.TW2626369.expTotal = 260;
s.progress.TW2626369.currentLevelNo = 4;
syncSpecialRewards(s, {
  customerId: "TW2626369",
  joinedCustomerIds: ["C-NEW"],
  now: new Date().toISOString(),
});
assert.equal(s.customerRewards.find((reward) => reward.sourceID === "C-NEW")?.rewardQty, 7);

const aFirst = state();
aFirst.attendances.push({
  attendanceID: 1,
  eventID: 1,
  staffQrID: 1,
  CustomerID: "A",
  participantType: "dealer",
  status: "checked_in",
});
assert.equal(syncCompanionDirectNewcomerBonuses(aFirst, {
  eventID: 1,
  currentCustomerId: "A",
  relationships: [{ referrerCustomerId: "A", newcomerCustomerId: "B", joinDate: "2026-06-01" }],
  joinedSince: "2026-03-01",
  now: "2026-06-26T00:00:00.000Z",
}).length, 0);
aFirst.attendances.push({
  attendanceID: 2,
  eventID: 1,
  staffQrID: 1,
  CustomerID: "B",
  participantType: "dealer",
  status: "checked_in",
});
const aBonus = syncCompanionDirectNewcomerBonuses(aFirst, {
  eventID: 1,
  currentCustomerId: "B",
  relationships: [{ referrerCustomerId: "A", newcomerCustomerId: "B", joinDate: "2026-06-01" }],
  joinedSince: "2026-03-01",
  now: "2026-06-26T00:00:00.000Z",
});
assert.equal(aBonus.length, 1);
assert.equal(aBonus[0].CustomerID, "A");
assert.equal(aBonus[0].pointDelta, 5);
assert.equal(aBonus[0].sourceID, "1:B");
assert.equal(aFirst.progress.A.pointBalance, 5);
assert.equal(syncCompanionDirectNewcomerBonuses(aFirst, {
  eventID: 1,
  currentCustomerId: "B",
  relationships: [{ referrerCustomerId: "A", newcomerCustomerId: "B", joinDate: "2026-06-01" }],
  joinedSince: "2026-03-01",
  now: "2026-06-26T00:00:00.000Z",
}).length, 0);

aFirst.attendances.push(
  { attendanceID: 3, eventID: 2, staffQrID: 2, CustomerID: "A", participantType: "dealer", status: "checked_in" },
  { attendanceID: 4, eventID: 2, staffQrID: 2, CustomerID: "B", participantType: "dealer", status: "checked_in" },
);

const secondEventBonus = syncCompanionDirectNewcomerBonuses(aFirst, {
  eventID: 2,
  currentCustomerId: "B",
  relationships: [{ referrerCustomerId: "A", newcomerCustomerId: "B", joinDate: "2026-06-01" }],
  joinedSince: "2026-03-01",
  now: "2026-07-26T00:00:00.000Z",
});

assert.equal(secondEventBonus.length, 1);
assert.equal(secondEventBonus[0].CustomerID, "A");
assert.equal(secondEventBonus[0].sourceID, "2:B");
assert.equal(aFirst.progress.A.pointBalance, 10);

const bFirst = state();
bFirst.attendances.push(
  { attendanceID: 1, eventID: 1, staffQrID: 1, CustomerID: "B", participantType: "dealer", status: "checked_in" },
  { attendanceID: 2, eventID: 1, staffQrID: 1, CustomerID: "A", participantType: "dealer", status: "checked_in" },
);
assert.equal(syncCompanionDirectNewcomerBonuses(bFirst, {
  eventID: 1,
  currentCustomerId: "A",
  relationships: [{ referrerCustomerId: "A", newcomerCustomerId: "B", joinDate: "2026-06-01" }],
  joinedSince: "2026-03-01",
  now: "2026-06-26T00:00:00.000Z",
})[0]?.CustomerID, "A");

const noBonus = state();
noBonus.attendances.push(
  { attendanceID: 1, eventID: 1, staffQrID: 1, CustomerID: "A", participantType: "dealer", status: "checked_in" },
  { attendanceID: 2, eventID: 2, staffQrID: 1, CustomerID: "B", participantType: "dealer", status: "checked_in" },
  { attendanceID: 3, eventID: 1, staffQrID: 1, CustomerID: "C", participantType: "dealer", status: "checked_in" },
);
assert.equal(syncCompanionDirectNewcomerBonuses(noBonus, {
  eventID: 1,
  currentCustomerId: "A",
  relationships: [
    { referrerCustomerId: "A", newcomerCustomerId: "B", joinDate: "2026-06-01" },
    { referrerCustomerId: "A", newcomerCustomerId: "C", joinDate: "2026-02-01" },
  ],
  joinedSince: "2026-03-01",
  now: "2026-06-26T00:00:00.000Z",
}).length, 0);

const rule2 = state();
const rule2Relationships = [
  { referrerCustomerId: "TW2626369", newcomerCustomerId: "TW2626622", joinDate: "2026-06-15" },
  { referrerCustomerId: "TW2626622", newcomerCustomerId: "TW2626645", joinDate: "2026-06-23" },
];

const rule2First = applyRule2CompanionCheckIn(rule2, {
  eventID: 1,
  staffQrID: 1,
  referrerCustomerId: "TW2626369",
  companionCustomerId: "TW2626622",
  relationships: rule2Relationships,
  eventDate: "2026-07-25T09:30:00+08:00",
});
assert.equal(rule2First.expDelta, 15);
assert.equal(rule2First.pointDelta, 15);
assert.equal(rule2First.duplicate, false);
assert.equal(rule2.progress.TW2626369.expTotal, 15);
assert.equal(rule2.progress.TW2626369.pointBalance, 15);
assert.equal("TW2626622" in rule2.progress, false);
assert.equal(rule2.attendances.filter((attendance) => attendance.eventID === 1).length, 2);

const rule2Duplicate = applyRule2CompanionCheckIn(rule2, {
  eventID: 1,
  staffQrID: 1,
  referrerCustomerId: "TW2626369",
  companionCustomerId: "TW2626622",
  relationships: rule2Relationships,
  eventDate: "2026-07-25T09:30:00+08:00",
});
assert.equal(rule2Duplicate.duplicate, true);
assert.equal(rule2Duplicate.expDelta, 0);
assert.equal(rule2.progress.TW2626369.pointBalance, 15);

rule2.events.push({ eventID: 2, eventType: "sha", eventName: "SHA follow-up", isActive: true });
const rule2SameEventTypeDuplicate = applyRule2CompanionCheckIn(rule2, {
  eventID: 2,
  staffQrID: 2,
  referrerCustomerId: "TW2626369",
  companionCustomerId: "TW2626622",
  relationships: rule2Relationships,
  eventDate: "2026-07-26T09:30:00+08:00",
});
assert.equal(rule2SameEventTypeDuplicate.duplicate, true);
assert.equal(rule2SameEventTypeDuplicate.expDelta, 0);
assert.equal(rule2.progress.TW2626369.pointBalance, 15);

const rule2Second = applyRule2CompanionCheckIn(rule2, {
  eventID: 1,
  staffQrID: 1,
  referrerCustomerId: "TW2626622",
  companionCustomerId: "TW2626645",
  relationships: rule2Relationships,
  eventDate: "2026-07-25T09:30:00+08:00",
});
assert.equal(rule2Second.expDelta, 15);
assert.equal(rule2Second.pointDelta, 15);
assert.equal(rule2.progress.TW2626622.expTotal, 15);
assert.equal("TW2626645" in rule2.progress, false);

assert.throws(
  () =>
    applyRule2CompanionCheckIn(rule2, {
      eventID: 1,
      staffQrID: 1,
      referrerCustomerId: "TW2626369",
      companionCustomerId: "TW2626645",
      relationships: rule2Relationships,
      eventDate: "2026-07-25T09:30:00+08:00",
    }),
  /not an eligible direct newcomer/,
);

assert.throws(
  () =>
    applyRule2CompanionCheckIn(rule2, {
      eventID: 1,
      staffQrID: 1,
      referrerCustomerId: "TW2626369",
      companionCustomerId: "",
      relationships: rule2Relationships,
      eventDate: "2026-07-25T09:30:00+08:00",
    }),
  /Companion required/,
);

console.log("domain contracts ok");
