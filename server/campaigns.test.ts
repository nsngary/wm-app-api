import assert from "node:assert/strict";
import {
  canExtendCampaign,
  campaignContainingDate,
  campaignHasEnded,
  campaignRangesOverlap,
  parseCampaignCreateInput,
  parseCampaignInput,
  parseCampaignUpdateInput,
} from "./campaigns";

assert.deepEqual(
  parseCampaignCreateInput({
    name: " 2026 Q4 ",
    startsOn: "2026-10-01",
    endsOn: "2026-12-31",
  }),
  { name: "2026 Q4", startsOn: "2026-10-01", endsOn: "2026-12-31" },
);

assert.deepEqual(
  parseCampaignUpdateInput({
    name: "2026 Q4 延長",
    endsOn: "2027-01-15",
  }),
  { name: "2026 Q4 延長", endsOn: "2027-01-15" },
);

assert.throws(
  () =>
    parseCampaignUpdateInput({
      name: "Q4",
      startsOn: "2026-09-01",
      endsOn: "2026-12-31",
    }),
  /不允許的欄位/,
);

assert.equal(
  canExtendCampaign({ endsOn: "2026-12-31" }, "2027-01-15", "2026-09-14"),
  true,
);
assert.equal(
  canExtendCampaign({ endsOn: "2026-12-31" }, "2026-11-30", "2026-09-14"),
  false,
);
assert.equal(
  canExtendCampaign({ endsOn: "2026-08-31" }, "2026-12-31", "2026-09-14"),
  false,
);

assert.deepEqual(
  parseCampaignInput({
    name: "  2026 Q3  ",
    startsOn: "2026-07-01",
    endsOn: "2026-09-30",
    isOpen: true,
  }),
  {
    name: "2026 Q3",
    startsOn: "2026-07-01",
    endsOn: "2026-09-30",
    isOpen: true,
  },
);

assert.throws(() =>
  parseCampaignInput({
    name: "Q",
    startsOn: "2026-10-01",
    endsOn: "2026-09-30",
    isOpen: false,
  }),
);

assert.throws(() =>
  parseCampaignInput({ name: "Q", startsOn: "2026-02-29", endsOn: "2026-03-01", isOpen: false }),
);

assert.throws(() =>
  parseCampaignInput({ name: "Q", startsOn: "2026-7-01", endsOn: "2026-09-30", isOpen: false }),
);

assert.throws(() =>
  parseCampaignInput({ name: "Q", startsOn: "0000-01-01", endsOn: "0000-01-01", isOpen: false }),
);

assert.throws(() =>
  parseCampaignInput({ name: "Q", startsOn: "2026-07-01", endsOn: "2026-09-30", isOpen: "true" }),
);

assert.equal(
  campaignRangesOverlap(
    { startsOn: "2026-07-01", endsOn: "2026-09-30" },
    { startsOn: "2026-09-30", endsOn: "2026-12-31" },
  ),
  true,
);

assert.equal(
  campaignHasEnded(
    { startsOn: "2026-01-01", endsOn: "2026-08-31" },
    "2026-09-08",
  ),
  true,
);

assert.equal(
  campaignHasEnded(
    { startsOn: "2026-01-01", endsOn: "2026-09-08" },
    "2026-09-08",
  ),
  false,
);

assert.equal(
  campaignContainingDate(
    [
      { id: "a", startsOn: "2026-04-01", endsOn: "2026-07-15" },
      { id: "b", startsOn: "2026-07-16", endsOn: "2026-10-31" },
    ],
    "2026-07-16",
  )?.id,
  "b",
);
assert.equal(campaignContainingDate([], "2026-07-16"), null);
assert.throws(
  () =>
    campaignContainingDate(
      [
        { id: "a", startsOn: "2026-07-01", endsOn: "2026-07-31" },
        { id: "b", startsOn: "2026-07-16", endsOn: "2026-08-31" },
      ],
      "2026-07-16",
    ),
  /multiple Campaigns/,
);

console.log("campaign domain ok");
