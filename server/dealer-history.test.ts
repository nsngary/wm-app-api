import assert from "node:assert/strict";
import {
  LEGACY_CAMPAIGN_ID,
  buildSeasonSummaries,
} from "./dealer-history";

const summaries = buildSeasonSummaries(
  [
    {
      campaignID: "1",
      name: "2026 A 季",
      startsOn: "2026-04-01",
      endsOn: "2026-07-15",
      exp: 120,
      levelName: "分享達人",
      participation: 8,
      newcomers: 3,
      rewards: 2,
    },
    {
      campaignID: null,
      name: "未分類歷史",
      startsOn: null,
      endsOn: null,
      exp: 5,
      levelName: "分享入門",
      participation: 1,
      newcomers: 0,
      rewards: 0,
    },
    {
      campaignID: "2",
      name: "2026 B 季",
      startsOn: "2026-07-16",
      endsOn: "2026-10-31",
      exp: 40,
      levelName: "分享入門",
      participation: 3,
      newcomers: 1,
      rewards: 1,
    },
  ],
  "2",
);

assert.deepEqual(summaries.map((season) => season.id), ["2", "1", LEGACY_CAMPAIGN_ID]);
assert.equal(summaries[0].isCurrent, true);
assert.equal(summaries[1].isCurrent, false);
assert.deepEqual(summaries[2], {
  id: LEGACY_CAMPAIGN_ID,
  name: "未分類歷史",
  startsOn: null,
  endsOn: null,
  isCurrent: false,
  exp: 5,
  levelName: "分享入門",
  participation: 1,
  newcomers: 0,
  rewards: 0,
});
assert.deepEqual(buildSeasonSummaries([], null), []);

console.log("dealer history contracts ok");
