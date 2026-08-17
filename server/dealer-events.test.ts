import assert from "node:assert/strict";
import { buildDealerEventFeed, eventExpiresAt } from "./dealer-events";

const now = new Date("2026-07-20T12:00:00+08:00");
const campaign = {
  id: "3",
  name: "2026 Q3",
  startsOn: "2026-07-01",
  endsOn: "2026-09-30",
  isOpen: true,
};

const event = (
  eventID: number,
  startsAt: string,
  endAt: string | null = null,
  eventType = "sha",
) => ({
  id: String(eventID),
  eventID,
  eventType,
  name: `Event ${eventID}`,
  activityName: `Activity ${eventID}`,
  activitySortOrder: eventID,
  startsAt,
  endAt,
  location: "Taipei",
  description: "",
  points: 5,
  rewardExp: 7,
  rewardPoints: 9,
  targets: ["dealer"],
  registeredCount: 0,
  checkedInCount: 0,
  isActive: true,
});

const events = [
  event(1, "2026-07-18T09:00:00+08:00", "2026-07-21T17:00:00+08:00"),
  event(2, "2026-07-21T09:00:00+08:00"),
  event(3, "2026-07-17T09:00:00+08:00", null, "elite"),
  event(4, "2026-07-16T09:00:00+08:00"),
  event(5, "2026-07-15T09:00:00+08:00", null, "product_basic"),
  event(6, "2026-07-22T09:00:00+08:00"),
  { ...event(7, "2026-07-23T09:00:00+08:00"), isActive: false },
  { ...event(8, "2026-07-14T09:00:00+08:00"), isActive: false },
  event(9, "2026-06-30T09:00:00+08:00"),
  event(10, "2026-10-01T09:00:00+08:00"),
];

assert.equal(eventExpiresAt(events[0]).toISOString(), "2026-07-21T09:00:00.000Z");
assert.equal(eventExpiresAt(events[1]).toISOString(), "2026-07-21T01:00:00.000Z");

const feed = buildDealerEventFeed({
  customerId: "dealer-1",
  now,
  campaign,
  events,
  attendances: [
    { eventID: 1, status: "checked_in", checkedInAt: "2026-07-20T10:00:00+08:00" },
    { eventID: 3, status: "checked_in", checkedInAt: "2026-07-18T10:00:00+08:00" },
    { eventID: 3, status: "checked_in", checkedInAt: "2026-07-19T10:00:00+08:00" },
    { eventID: 4, status: "voided", checkedInAt: "2026-07-17T10:00:00+08:00" },
    { eventID: 5, status: "checked_in", checkedInAt: null },
    { eventID: 8, status: "checked_in", checkedInAt: "2026-07-14T10:00:00+08:00" },
    { eventID: 9, status: "checked_in", checkedInAt: "2026-06-30T10:00:00+08:00" },
  ],
  companionAttendances: [
    { eventID: 3, CustomerID: "companion-c", participantExternalID: "dealer-1" },
    { eventID: 3, CustomerID: "other-dealer-companion", participantExternalID: "dealer-2" },
    { eventID: 3, CustomerID: "unknown-owner", participantExternalID: null },
  ],
  ledger: [
    {
      CustomerID: "dealer-1",
      eventID: 3,
      sourceType: "attendance",
      sourceID: "30",
      expDelta: 10,
      pointDelta: 5,
      createdAt: "2026-07-18T10:00:00+08:00",
    },
    {
      CustomerID: "dealer-1",
      eventID: 3,
      sourceType: "companion_direct_newcomer",
      sourceID: "elite:companion-a",
      expDelta: 2,
      pointDelta: 3,
      createdAt: "2026-07-19T10:00:00+08:00",
    },
    {
      CustomerID: "dealer-1",
      eventID: 3,
      sourceType: "companion_direct_newcomer",
      sourceID: "3:companion-a",
      expDelta: 4,
      pointDelta: 6,
      createdAt: "2026-07-19T10:01:00+08:00",
    },
    {
      CustomerID: "dealer-1",
      eventID: 3,
      sourceType: "companion_direct_newcomer",
      sourceID: "elite:companion-b",
      expDelta: 1,
      pointDelta: 2,
      createdAt: "2026-07-19T10:02:00+08:00",
    },
    {
      CustomerID: "dealer-1",
      eventID: 3,
      sourceType: "companion_direct_newcomer",
      sourceID: "wrong-event-type:not-a-companion",
      expDelta: 1,
      pointDelta: 1,
      createdAt: "2026-07-19T10:03:00+08:00",
    },
    {
      CustomerID: "dealer-1",
      eventID: null,
      sourceType: "companion_direct_newcomer",
      sourceID: "elite:companion-c",
      expDelta: 100,
      pointDelta: 100,
      createdAt: "2026-07-19T10:00:00+08:00",
    },
    {
      CustomerID: "dealer-2",
      eventID: 3,
      sourceType: "attendance",
      sourceID: "31",
      expDelta: 100,
      pointDelta: 100,
      createdAt: "2026-07-19T10:00:00+08:00",
    },
    {
      CustomerID: "dealer-1",
      eventID: 5,
      sourceType: "attendance",
      sourceID: "50",
      expDelta: 7,
      pointDelta: 8,
      createdAt: "2026-07-15T10:00:00+08:00",
    },
    {
      CustomerID: "dealer-1",
      eventID: 5,
      sourceType: "companion_direct_newcomer",
      sourceID: "5:rule-1-newcomer",
      expDelta: 3,
      pointDelta: 4,
      createdAt: "2026-07-15T10:01:00+08:00",
    },
  ],
  companionNames: {
    "companion-a": "Alice",
  },
});

assert.deepEqual(feed.activeEvents.map((item) => item.eventID), [1, 2, 6]);
assert.deepEqual(
  feed.endedEvents.map((item) => item.eventID),
  [3, 4, 5, 8],
  "ended events include inactive and unattended campaign events",
);

assert.deepEqual(
  feed.eventHistory.map((item) => item.eventID),
  [1, 3, 5, 8],
  "history contains one item per attended event, including ongoing events",
);

const ongoingHistory = feed.eventHistory.find(
  (item) => item.eventID === 1,
);
assert.ok(ongoingHistory);
assert.equal(ongoingHistory.isOngoing, true);

const eliteHistory = feed.eventHistory.find(
  (item) => item.eventID === 3,
);
assert.ok(eliteHistory);
assert.equal(eliteHistory.isOngoing, false);
assert.equal(
  eliteHistory.checkedInAt,
  "2026-07-19T02:00:00.000Z",
);
assert.deepEqual(eliteHistory.companions, [
  { customerId: "companion-a", name: "Alice" },
  { customerId: "companion-b", name: "companion-b" },
  { customerId: "companion-c", name: "companion-c" },
]);
assert.equal(eliteHistory.rewardExp, 18);
assert.equal(eliteHistory.rewardPoints, 17);

const productHistory = feed.eventHistory.find(
  (item) => item.eventID === 5,
);
assert.ok(productHistory);
assert.equal(productHistory.isOngoing, false);
assert.deepEqual(productHistory.companions, []);
assert.equal(
  productHistory.checkedInAt,
  "2026-07-15T01:00:00.000Z",
);
assert.equal(productHistory.rewardExp, 10);
assert.equal(productHistory.rewardPoints, 12);

assert.deepEqual(
  buildDealerEventFeed({
    customerId: "dealer-1",
    now,
    campaign: null,
    events,
    attendances: [],
    companionAttendances: [],
    ledger: [],
    companionNames: {},
  }),
  { activeEvents: [], endedEvents: [], eventHistory: [] },
);

console.log("dealer event feed ok");
