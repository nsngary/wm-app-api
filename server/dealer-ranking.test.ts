import assert from "node:assert/strict";

async function main() {
  const ranking = await import("./dealer-ranking.js").catch(() => null);
  assert.ok(ranking, "dealer ranking domain module must exist");

  assert.deepEqual(ranking.monthRankingBands("2026-08-10"), {
    current: { startsOn: "2026-08-01", endsOn: "2026-08-31" },
    previous: { startsOn: "2026-07-01", endsOn: "2026-07-31" },
  });
  assert.deepEqual(ranking.monthRankingBands("2026-01-01").previous, {
    startsOn: "2025-12-01",
    endsOn: "2025-12-31",
  });

  assert.deepEqual(
    ranking.rankingBands(
      "month",
      "2026-07-20",
      { id: "b", startsOn: "2026-07-16", endsOn: "2026-10-31" },
      null,
    ),
    {
      current: {
        campaignId: "b",
        startsOn: "2026-07-16",
        endsOn: "2026-07-31",
      },
      previous: null,
    },
  );
  assert.deepEqual(
    ranking.rankingBands(
      "month",
      "2026-08-20",
      { id: "b", startsOn: "2026-07-16", endsOn: "2026-10-31" },
      null,
    ).previous,
    { campaignId: "b", startsOn: "2026-07-16", endsOn: "2026-07-31" },
  );
  assert.deepEqual(
    ranking.rankingBands(
      "season",
      "2026-07-20",
      { id: "b", startsOn: "2026-07-16", endsOn: "2026-10-31" },
      { id: "a", startsOn: "2026-04-01", endsOn: "2026-07-15" },
    ),
    {
      current: {
        campaignId: "b",
        startsOn: "2026-07-16",
        endsOn: "2026-10-31",
      },
      previous: {
        campaignId: "a",
        startsOn: "2026-04-01",
        endsOn: "2026-07-15",
      },
    },
  );

  assert.equal(ranking.rankingTrend(2, 5), "up");
  assert.equal(ranking.rankingTrend(5, 2), "down");
  assert.equal(ranking.rankingTrend(2, 2), "same");
  assert.equal(ranking.rankingTrend(2), "same");

  assert.equal(typeof ranking.selectDealerRankingRows, "function");
  const totals = Array.from({ length: 55 }, (_, index) => ({
    customerId: `dealer-${String(index + 1).padStart(2, "0")}`,
    exp: 100 - index,
  }));
  const rows = ranking.selectDealerRankingRows(
    totals,
    [
      { customerId: "dealer-01", exp: 10 },
      { customerId: "dealer-02", exp: 20 },
    ],
    "current-dealer",
  );
  assert.equal(rows.length, 51);
  assert.deepEqual(rows.slice(0, 2), [
    { customerId: "dealer-01", exp: 100, rank: 1, previousRank: 2 },
    { customerId: "dealer-02", exp: 99, rank: 2, previousRank: 1 },
  ]);
  assert.deepEqual(rows.at(-1), {
    customerId: "current-dealer",
    exp: 0,
    rank: 56,
    previousRank: undefined,
  });

  assert.deepEqual(
    ranking.selectDealerRankingRows(
      [
        { customerId: "dealer-b", exp: 10 },
        { customerId: "dealer-a", exp: 10 },
      ],
      [],
      "dealer-a",
    ).map((row: { customerId: string; rank: number }) => [row.customerId, row.rank]),
    [["dealer-a", 1], ["dealer-b", 2]],
  );

  assert.deepEqual(
    ranking.selectDealerRankingRows(
      [
        { customerId: "a-later", exp: 100, reachedAt: "2026-08-02T00:00:00.000Z" },
        { customerId: "z-earlier", exp: 100, reachedAt: "2026-08-01T00:00:00.000Z" },
      ],
      [],
      "a-later",
    ).map((row: { customerId: string }) => row.customerId),
    ["z-earlier", "a-later"],
  );

  assert.deepEqual(
    ranking.selectDealerRankingRows(
      [
        { customerId: "dealer-b", exp: 100, reachedAt: "2026-08-01T00:00:00.000Z" },
        { customerId: "dealer-a", exp: 100, reachedAt: "2026-08-01T00:00:00.000Z" },
      ],
      [],
      "dealer-b",
    ).map((row: { customerId: string }) => row.customerId),
    ["dealer-a", "dealer-b"],
  );

  console.log("dealer ranking domain contracts ok");
}

void main();
