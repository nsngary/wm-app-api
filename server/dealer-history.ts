export const LEGACY_CAMPAIGN_ID = "legacy";

type SeasonSummaryRow = {
  campaignID: string | number | null;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  exp: string | number | null;
  levelName: string | null;
  participation: string | number | null;
  newcomers: string | number | null;
  rewards: string | number | null;
};

export type DealerSeasonSummary = {
  id: string;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  isCurrent: boolean;
  exp: number;
  levelName: string;
  participation: number;
  newcomers: number;
  rewards: number;
};

export function buildSeasonSummaries(
  rows: SeasonSummaryRow[],
  currentCampaignId: string | null,
): DealerSeasonSummary[] {
  return rows
    .map((row) => {
      const id = row.campaignID == null ? LEGACY_CAMPAIGN_ID : String(row.campaignID);
      return {
        id,
        name: String(row.name),
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        isCurrent: id !== LEGACY_CAMPAIGN_ID && id === currentCampaignId,
        exp: Number(row.exp ?? 0),
        levelName: row.levelName || "分享入門",
        participation: Number(row.participation ?? 0),
        newcomers: Number(row.newcomers ?? 0),
        rewards: Number(row.rewards ?? 0),
      };
    })
    .sort((a, b) => {
      if (a.id === LEGACY_CAMPAIGN_ID) return 1;
      if (b.id === LEGACY_CAMPAIGN_ID) return -1;
      return (b.startsOn || "").localeCompare(a.startsOn || "");
    });
}
