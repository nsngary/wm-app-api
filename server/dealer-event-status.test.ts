import assert from "node:assert/strict";
import type { Campaign } from "./campaigns";
import {
  eventCheckInIsOpen,
  eventStartsInCampaign,
  getDealerEventStatus,
  taipeiDateKey,
} from "./dealer-event-status";

const campaign: Campaign = {
  id: "3",
  name: "2026 Q3",
  startsOn: "2026-07-01",
  endsOn: "2026-09-30",
  isOpen: true,
};

const now = new Date("2026-07-20T12:00:00+08:00");

assert.equal(taipeiDateKey(now), "2026-07-20");
assert.equal(
  getDealerEventStatus({ startsAt: "2026-07-21T09:00:00+08:00", endAt: null }, now),
  "upcoming",
);
assert.equal(
  getDealerEventStatus({ startsAt: "2026-07-20T23:00:00+08:00", endAt: null }, now),
  "checkInOpen",
);
assert.equal(
  getDealerEventStatus(
    { startsAt: "2026-07-19T09:00:00+08:00", endAt: "2026-07-21T17:00:00+08:00" },
    now,
  ),
  "checkInOpen",
);
assert.equal(
  getDealerEventStatus({ startsAt: "2026-07-19T09:00:00+08:00", endAt: null }, now),
  "ended",
);

assert.equal(
  eventStartsInCampaign({ startsAt: "2026-06-30T23:59:00+08:00" }, campaign),
  false,
  "Q2 events stay out",
);
assert.equal(
  eventStartsInCampaign({ startsAt: "2026-10-01T00:00:00+08:00" }, campaign),
  false,
  "Q4 events stay out",
);
assert.equal(eventStartsInCampaign({ startsAt: "2026-07-01T00:00:00+08:00" }, campaign), true);
assert.equal(
  eventStartsInCampaign(
    { campaignId: "3", startsAt: "2026-10-01T00:00:00+08:00" },
    campaign,
  ),
  true,
  "Persisted Campaign ownership remains authoritative after date-range edits.",
);
assert.equal(
  eventStartsInCampaign(
    { campaignId: "2", startsAt: "2026-07-01T00:00:00+08:00" },
    campaign,
  ),
  false,
  "A persisted different Campaign cannot enter the feed through its date.",
);

const singleDay = { startsAt: "2026-08-04T09:00:00+08:00", endAt: null };
assert.equal(getDealerEventStatus(singleDay, new Date("2026-08-04T15:59:59Z")), "checkInOpen");
assert.equal(getDealerEventStatus(singleDay, new Date("2026-08-04T16:00:00Z")), "ended");
assert.equal(eventCheckInIsOpen(singleDay, campaign, new Date("2026-08-04T12:00:00Z")), true);
assert.equal(
  eventCheckInIsOpen(
    { startsAt: "2026-08-05T09:00:00+08:00", endAt: null },
    campaign,
    new Date("2026-08-04T12:00:00Z"),
  ),
  false,
  "Future events cannot issue or redeem check-in QR codes.",
);
assert.equal(
  eventCheckInIsOpen(
    { startsAt: "2026-08-03T09:00:00+08:00", endAt: null },
    campaign,
    new Date("2026-08-04T12:00:00Z"),
  ),
  false,
  "Ended events cannot issue or redeem check-in QR codes.",
);
assert.equal(
  eventCheckInIsOpen(
    { startsAt: "2026-10-01T09:00:00+08:00", endAt: null },
    campaign,
    new Date("2026-08-04T12:00:00Z"),
  ),
  false,
  "Events outside the open campaign cannot issue or redeem check-in QR codes.",
);

console.log("dealer event status ok");
