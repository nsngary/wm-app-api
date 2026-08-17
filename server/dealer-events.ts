import { COMPANION_DIRECT_NEWCOMER_SOURCE } from "./domain";
import type { Campaign } from "./campaigns";
import { eventStartsInCampaign, getDealerEventStatus } from "./dealer-event-status";

export type DealerEvent = {
  id: string;
  eventID: number;
  campaignId?: string | null;
  eventType: string;
  name: string;
  activityName: string | null;
  activitySortOrder: number | null;
  startsAt: string;
  endAt: string | null;
  location: string;
  description: string;
  points: number;
  rewardExp: number;
  rewardPoints: number;
  targets: string[];
  registeredCount: number;
  checkedInCount: number;
  isActive?: boolean;
};

type Attendance = {
  eventID: number;
  status: string;
  checkedInAt: string | null;
};

type CompanionAttendance = {
  eventID: number;
  CustomerID: string;
  participantExternalID: string | null;
};

type Ledger = {
  CustomerID: string;
  eventID: number | null;
  sourceType: string;
  sourceID: string;
  expDelta: number;
  pointDelta: number;
  createdAt: string;
};

export function eventExpiresAt(event: Pick<DealerEvent, "startsAt" | "endAt">) {
  return new Date(event.endAt ?? event.startsAt);
}

export function rule2CompanionId(sourceID: string, eventType: string) {
  const separator = sourceID.indexOf(":");
  if (separator <= 0 || sourceID.slice(0, separator) !== eventType) return "";
  return sourceID.slice(separator + 1);
}

export function buildDealerEventFeed(input: {
  customerId: string;
  now: Date;
  campaign: Campaign | null;
  events: DealerEvent[];
  attendances: Attendance[];
  companionAttendances: CompanionAttendance[];
  ledger: Ledger[];
  companionNames: Record<string, string>;
}) {
  const campaign = input.campaign;
  if (!campaign) return { activeEvents: [], endedEvents: [], eventHistory: [] };

  const attendancesByEvent = new Map<number, Attendance[]>();
  for (const attendance of input.attendances) {
    if (attendance.status !== "checked_in") continue;
    const rows = attendancesByEvent.get(attendance.eventID) ?? [];
    rows.push(attendance);
    attendancesByEvent.set(attendance.eventID, rows);
  }
  const ledgerByEvent = new Map<number, Ledger[]>();
  for (const row of input.ledger) {
    if (row.CustomerID !== input.customerId || row.eventID == null) continue;
    const rows = ledgerByEvent.get(row.eventID) ?? [];
    rows.push(row);
    ledgerByEvent.set(row.eventID, rows);
  }

  const events = input.events.filter(
    (event) => !Number.isNaN(eventExpiresAt(event).getTime()) && eventStartsInCampaign(event, campaign),
  );
  const activeEvents = events
    .filter((event) => event.isActive !== false && getDealerEventStatus(event, input.now) !== "ended")
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const endedEvents = events
    .filter((event) => getDealerEventStatus(event, input.now) === "ended")
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));

  const eventHistory = events
    .flatMap((event) => {
      const attendances = attendancesByEvent.get(event.eventID) ?? [];
      if (!attendances.length) return [];

      const isOngoing =
        event.isActive !== false &&
        eventExpiresAt(event) >= input.now;

      const checkedInAt = attendances
        .map((attendance) => attendance.checkedInAt)
        .filter((value): value is string => Boolean(value))
        .sort((a, b) => Date.parse(b) - Date.parse(a))[0];

      const rows = ledgerByEvent.get(event.eventID) ?? [];
      const companionIds = [
        ...new Set(
          [
            ...rows
            .filter((row) => row.sourceType === COMPANION_DIRECT_NEWCOMER_SOURCE)
            .map((row) => rule2CompanionId(row.sourceID, event.eventType))
            .filter(Boolean),
            ...input.companionAttendances
              .filter((attendance) =>
                attendance.eventID === event.eventID &&
                attendance.participantExternalID === input.customerId)
              .map((attendance) => attendance.CustomerID),
          ],
        ),
      ].sort();

      return [{
        ...event,
        isOngoing,
        checkedInAt: new Date(checkedInAt ?? event.startsAt).toISOString(),
        companions: companionIds.map((customerId) => ({
          customerId,
          name: input.companionNames[customerId] || customerId,
        })),
        rewardExp: rows.reduce((total, row) => total + row.expDelta, 0),
        rewardPoints: rows.reduce((total, row) => total + row.pointDelta, 0),
      }];
    })
    .sort((a, b) => Date.parse(b.checkedInAt) - Date.parse(a.checkedInAt));

  return { activeEvents, endedEvents, eventHistory };
}
