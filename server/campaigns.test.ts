import assert from "node:assert/strict";
import {
  campaignContainingDate,
  campaignRangesOverlap,
  parseCampaignInput,
} from "./campaigns";

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
