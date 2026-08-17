export type DateBand = {
  startsOn: string;
  endsOn: string;
};

type CampaignBand = DateBand & { id: string };

export type RankingBand = DateBand & { campaignId: string };

export type RankingTotal = {
  customerId: string;
  exp: number;
  reachedAt?: string | null;
};

export function monthRankingBands(today: string) {
  const [year, month] = today.split("-").map(Number);
  return {
    current: monthBand(year, month),
    previous: month === 1 ? monthBand(year - 1, 12) : monthBand(year, month - 1),
  };
}

export function rankingBands(
  period: "month" | "season",
  today: string,
  currentCampaign: CampaignBand,
  previousCampaign: CampaignBand | null,
): { current: RankingBand; previous: RankingBand | null } {
  if (period === "season") {
    return {
      current: toRankingBand(currentCampaign),
      previous: previousCampaign ? toRankingBand(previousCampaign) : null,
    };
  }

  const months = monthRankingBands(today);
  return {
    current: intersectBand(months.current, currentCampaign)!,
    previous: intersectBand(months.previous, currentCampaign),
  };
}

export function rankingTrend(currentRank: number, previousRank?: number) {
  if (previousRank == null || previousRank === currentRank) return "same";
  return currentRank < previousRank ? "up" : "down";
}

export function selectDealerRankingRows(
  currentTotals: RankingTotal[],
  previousTotals: RankingTotal[],
  currentCustomerId: string,
) {
  const totals = currentTotals.some((row) => row.customerId === currentCustomerId)
    ? currentTotals
    : [...currentTotals, { customerId: currentCustomerId, exp: 0 }];
  const previousRanks = new Map(
    sorted(previousTotals).map((row, index) => [row.customerId, index + 1]),
  );
  const ranked = sorted(totals).map((row, index) => ({
    ...row,
    rank: index + 1,
    previousRank: previousRanks.get(row.customerId),
  }));
  const currentRow = ranked.find((row) => row.customerId === currentCustomerId)!;
  return currentRow.rank <= 50 ? ranked.slice(0, 50) : [...ranked.slice(0, 50), currentRow];
}

function sorted(rows: RankingTotal[]) {
  return [...rows].sort(
    (left, right) =>
      right.exp - left.exp ||
      compareReachedAt(left.reachedAt, right.reachedAt) ||
      (left.customerId < right.customerId ? -1 : Number(left.customerId > right.customerId)),
  );
}

function compareReachedAt(left?: string | null, right?: string | null) {
  if (left === right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left < right ? -1 : Number(left > right);
}

function monthBand(year: number, month: number): DateBand {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  return {
    startsOn: `${prefix}-01`,
    endsOn: `${prefix}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`,
  };
}

function intersectBand(band: DateBand, campaign: CampaignBand): RankingBand | null {
  const startsOn = band.startsOn > campaign.startsOn ? band.startsOn : campaign.startsOn;
  const endsOn = band.endsOn < campaign.endsOn ? band.endsOn : campaign.endsOn;
  return startsOn <= endsOn ? { campaignId: campaign.id, startsOn, endsOn } : null;
}

function toRankingBand(campaign: CampaignBand): RankingBand {
  return {
    campaignId: campaign.id,
    startsOn: campaign.startsOn,
    endsOn: campaign.endsOn,
  };
}
