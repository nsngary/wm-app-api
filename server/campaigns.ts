export type CampaignRange = {
  startsOn: string;
  endsOn: string;
};

export type CampaignRangeWithId = CampaignRange & { id: string };

export type CampaignInput = CampaignRange & {
  name: string;
  isOpen: boolean;
};

export function parseCampaignInput(input: Record<string, unknown>): CampaignInput {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 100) throw new Error("無效的賽季名稱");

  const startsOn = dateOnly(input.startsOn);
  const endsOn = dateOnly(input.endsOn);
  if (!startsOn || !endsOn) throw new Error("無效的賽季日期");
  if (endsOn < startsOn) throw new Error("結束日期不能早於開始日期");
  if (typeof input.isOpen !== "boolean") throw new Error("Campaign isOpen must be boolean");

  return { name, startsOn, endsOn, isOpen: input.isOpen };
}

export function campaignRangesOverlap(left: CampaignRange, right: CampaignRange) {
  return left.startsOn <= right.endsOn && right.startsOn <= left.endsOn;
}

export function campaignContainingDate(
  campaigns: CampaignRangeWithId[],
  date: string,
) {
  const matches = campaigns.filter(
    (campaign) => campaign.startsOn <= date && date <= campaign.endsOn,
  );
  if (matches.length > 1) throw new Error("Date belongs to multiple Campaigns");
  return matches[0] ?? null;
}

function dateOnly(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  if (value < "0001-01-01") return null;
  return new Date(value + "T00:00:00.000Z").toISOString().slice(0, 10) === value ? value : null;
}

export type Campaign = CampaignRange & {
  id: string;
  name: string;
  isOpen: boolean;
};