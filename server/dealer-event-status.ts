import type { Campaign } from "./campaigns";

const taipeiDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function taipeiDateKey(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = Object.fromEntries(
    taipeiDateFormatter.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function eventStartsInCampaign(
  event: { campaignId?: string | null; startsAt: string },
  campaign: Campaign,
) {
  if (event.campaignId != null) return event.campaignId === campaign.id;
  const startsOn = taipeiDateKey(event.startsAt);
  return startsOn >= campaign.startsOn && startsOn <= campaign.endsOn;
}

export function eventCheckInIsOpen(
  event: { startsAt: string; endAt?: string | null },
  campaign: Campaign,
  now: Date,
) {
  const today = taipeiDateKey(now);
  return campaign.isOpen &&
    today >= campaign.startsOn &&
    today <= campaign.endsOn &&
    eventStartsInCampaign(event, campaign) &&
    getDealerEventStatus(event, now) === "checkInOpen";
}

export function getDealerEventStatus(
  event: { startsAt: string; endAt?: string | null },
  now: Date,
) {
  const today = taipeiDateKey(now);
  const startsOn = taipeiDateKey(event.startsAt);
  const endsOn = taipeiDateKey(event.endAt ?? event.startsAt);
  if (today < startsOn) return "upcoming" as const;
  if (today > endsOn) return "ended" as const;
  return "checkInOpen" as const;
}
