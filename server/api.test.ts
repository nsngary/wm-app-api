import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getExpPointRule, giftCode } from "./api";
import {
  activityCatalog,
  defaultLocationForBusinessUnit,
  parseEventSessionInput,
} from "./activity-catalog";

const apiSource = readFileSync("server/api.ts", "utf8");
const seedSource = readFileSync("server/sql/seed.sql", "utf8");

// 舊 ID-only 登入必須完全移除，所有應用資料都經過 Bearer Principal。
assert.doesNotMatch(apiSource, /path === "\/api\/login"/);
assert.match(apiSource, /const principal = await requestPrincipal\(req\)/);
assert.match(apiSource, /customerId: principal\.subjectId/);
assert.match(apiSource, /employeeId: principal\.subjectId/);
assert.match(apiSource, /requireRole\(principal, "dealer"\)/);
assert.match(apiSource, /requireRole\(principal, "staff"\)/);

const campaignsRoute = apiSource.match(
  /if \(req\.method === "GET" && path === "\/api\/campaigns"\) \{([\s\S]*?)\n    \}/,
)?.[1];
assert.ok(campaignsRoute, "GET /api/campaigns must exist");
assert.match(campaignsRoute, /requireRole\(principal, "staff"\)/);

const createCampaignRoute = apiSource.match(
  /if \(req\.method === "POST" && path === "\/api\/campaigns"\) \{([\s\S]*?)\n    \}/,
)?.[1];
assert.ok(createCampaignRoute, "POST /api/campaigns must exist");
assert.match(createCampaignRoute, /requireRole\(principal, "staff"\)/);

assert.ok(apiSource.includes("path.match(/^\\/api\\/campaigns\\/(\\d+)$/)"));
assert.match(apiSource, /req\.method === "PATCH" && campaignPatch/);
assert.match(apiSource, /requireRole\(principal, "staff"\)/);
assert.match(apiSource, /startsOn <= @endsOn\s+AND endsOn >= @startsOn/);
assert.match(apiSource, /campaignID <> @campaignID/);
assert.match(apiSource, /await assertCampaignExists\(campaignID\)/);
assert.match(apiSource, /WITH \(UPDLOCK, HOLDLOCK\)/);
assert.match(apiSource, /BEGIN TRAN;[\s\S]*WITH \(UPDLOCK, HOLDLOCK\)[\s\S]*(INSERT|UPDATE) dbo\.Campaign[\s\S]*COMMIT;/);
assert.match(apiSource, /try \{\s*return JSON\.parse\([\s\S]*\} catch \{\s*throw new ApiError\(400, "Invalid JSON body"\)/);
assert.match(apiSource, /SET XACT_ABORT ON;[\s\S]*BEGIN TRAN;[\s\S]*IF @isOpen = 1[\s\S]*UPDATE dbo\.Campaign[\s\S]*SET isOpen = 0[\s\S]*(INSERT|UPDATE) dbo\.Campaign[\s\S]*COMMIT;/);
assert.match(seedSource, /CREATE TABLE dbo\.Campaign/);
assert.match(seedSource, /CK_Campaign_DateRange CHECK \(endsOn >= startsOn\)/);
assert.match(seedSource, /CREATE UNIQUE INDEX UX_Campaign_OneOpen\s+ON dbo\.Campaign\(isOpen\)\s+WHERE isOpen = 1;/);
assert.match(seedSource, /N'2026 Q3'/);
assert.match(seedSource, /'2026-07-01'/);
assert.match(seedSource, /'2026-09-30'/);

const dealerEventsRoute = apiSource.match(
  /if \(req\.method === "GET" && path === "\/api\/me\/events"\) \{([\s\S]*?)\n    \}/,
)?.[1];
assert.ok(dealerEventsRoute, "GET /api/me/events must exist");
assert.match(dealerEventsRoute, /requireRole\(principal, "dealer"\)/);
assert.match(dealerEventsRoute, /dealerEvents\(principal\.subjectId\)/);
assert.doesNotMatch(dealerEventsRoute, /searchParams|body\(req\)|CustomerID|customerId/);
assert.doesNotMatch(apiSource, /events\(true\)/);

const dealerRankingRoute = apiSource.match(
  /if \(req\.method === "GET" && path === "\/api\/me\/ranking"\) \{([\s\S]*?)\n    \}/,
)?.[1];
assert.ok(dealerRankingRoute, "GET /api/me/ranking must exist");
assert.match(dealerRankingRoute, /requireRole\(principal, "dealer"\)/);
assert.match(dealerRankingRoute, /period !== "month" && period !== "season"/);
assert.match(dealerRankingRoute, /dealerRanking\(principal\.subjectId, period\)/);

const dealerHistoryRoute = apiSource.match(
  /if \(req\.method === "GET" && path === "\/api\/me\/history"\) \{([\s\S]*?)\n    \}/,
)?.[1];
assert.ok(dealerHistoryRoute, "GET /api/me/history must exist");
assert.match(dealerHistoryRoute, /requireRole\(principal, "dealer"\)/);
assert.match(dealerHistoryRoute, /dealerHistory\(principal\.subjectId\)/);
assert.doesNotMatch(dealerHistoryRoute, /searchParams|body\(req\)|CustomerID/);
assert.match(apiSource, /path\.match\(\/\^\\\/api\\\/me\\\/history\\\/\(\[\^\/\]\+\)\$\/\)/);
assert.match(
  apiSource,
  /dealerSeasonHistory\(\s*principal\.subjectId,\s*decodeURIComponent\(/,
);

const dealerRankingSource = apiSource.slice(
  apiSource.indexOf("async function dealerRanking"),
  apiSource.indexOf("async function leaderboard"),
);
assert.match(dealerRankingSource, /@currentStartsOn/);
assert.match(dealerRankingSource, /@currentEndsOn/);
assert.match(dealerRankingSource, /@previousStartsOn/);
assert.match(dealerRankingSource, /@previousEndsOn/);
assert.match(dealerRankingSource, /selectDealerRankingRows\(/);
assert.match(dealerRankingSource, /COUNT\(DISTINCT attendance\.eventID\)/);
assert.match(dealerRankingSource, /COUNT\(DISTINCT attendance\.CustomerID\)/);
assert.match(dealerRankingSource, /SWITCHOFFSET\([^)]*, '\+08:00'\)/);
assert.match(dealerRankingSource, /JOIN dbo\.\[Event\] event ON event\.eventID = attendance\.eventID/);
assert.match(dealerRankingSource, /SWITCHOFFSET\(event\.startAt, '\+08:00'\)/);
assert.match(dealerRankingSource, /ledger\.campaignID = @currentCampaignID/);
assert.match(dealerRankingSource, /ledger\.campaignID = @previousCampaignID/);
assert.match(
  dealerRankingSource,
  /ledger\.campaignID = @currentCampaignID\s+AND CONVERT\(date, SWITCHOFFSET\(ledger\.createdAt, '\+08:00'\)\)/,
);
assert.match(dealerRankingSource, /event\.campaignID = @currentCampaignID/);
assert.match(dealerRankingSource, /MAX\(CASE WHEN ledger\.expDelta > 0 THEN ledger\.createdAt END\) AS reachedAt/);

assert.match(apiSource, /async function openDealerCampaign\(today: string\)/);
assert.match(apiSource, /isOpen = 1\s+AND startsOn <= @today\s+AND endsOn >= @today/);
assert.match(apiSource, /async function dealerEventRows\(campaign: Campaign\)/);
assert.match(
  apiSource,
  /e\.campaignID = @campaignID/,
);
assert.match(apiSource, /const campaign = await openDealerCampaign\(taipeiDateKey\(now\)\)/);
assert.match(apiSource, /if \(!campaign\) return \{ activeEvents: \[\], endedEvents: \[\], eventHistory: \[\] \}/);
const progressSource = apiSource.slice(
  apiSource.indexOf("async function progress"),
  apiSource.indexOf("async function ledger"),
);
assert.match(
  progressSource,
  /openDealerCampaign\(taipeiDateKey\(new Date\(\)\)\)/,
  "Dealer progress must resolve the active Campaign from the server clock.",
);
assert.match(progressSource, /campaignId: campaign\?\.id \?\? null/);
assert.match(progressSource, /p\.campaignID = @campaignID/);
assert.equal(
  apiSource.match(/e\.campaignID = @campaignID/g)?.length,
  4,
  "Event, companion attendance, attendance, and ledger queries must share stable Campaign ownership.",
);

const deleteAccountRoute = apiSource.match(
  /if \(req\.method === "DELETE" && path === "\/api\/auth\/account"\) \{([\s\S]*?)\n    \}/,
)?.[1];

assert.ok(
  deleteAccountRoute,
  "DELETE /api/auth/account must exist",
);

assert.match(
  deleteAccountRoute,
  /requestPrincipal\(req\)/,
);

assert.match(
  deleteAccountRoute,
  /requireRole\(principal, "dealer"\)/,
);

assert.match(
  deleteAccountRoute,
  /mustString\(input\.currentPassword\)/,
);

assert.match(
  deleteAccountRoute,
  /deleteAccount\(\s*principal,/,
);

const createEventSource = apiSource.slice(
  apiSource.indexOf("async function createEventSession"),
  apiSource.indexOf("async function staffQr"),
);
assert.match(createEventSource, /campaignForDate\(taipeiDateKey\(new Date\(parsed\.startAt\)\)\)/);
assert.match(createEventSource, /if \(!campaign\) throw new ApiError\(400, "活動日期不在任何賽季內"\)/);
assert.match(createEventSource, /\.input\("campaignID", sql\.BigInt, campaign\.id\)/);
assert.match(createEventSource, /INSERT dbo\.\[Event\] \(campaignID,/);
assert.match(apiSource, /\.input\("customerID", sql\.NVarChar\(50\), customerId\)/);
assert.match(apiSource, /feed\.eventHistory\.flatMap/);
assert.match(apiSource, /participantExternalID = @customerID/);
assert.match(apiSource, /participantExternalID\)\s*VALUES \(@eventID, @staffQrID, @companionCustomerID, @participantType, NULL, @customerID\)/);
assert.match(apiSource, /companionAttendances:/);
assert.doesNotMatch(apiSource, /inferLegacyCompanionAttendances|legacyCompanionRelationships|legacyCandidateRows/);
assert.match(apiSource, /AS rewardExp/);
assert.match(apiSource, /AS rewardPoints/);
assert.match(apiSource, /points: Number\(row\.points\)/);
assert.match(apiSource, /rewardExp: Number\(row\.rewardExp\)/);
assert.match(apiSource, /rewardPoints: Number\(row\.rewardPoints\)/);
assert.match(apiSource, /async function assertOpenCampaignEvent\(eventID: number/);
assert.match(apiSource, /eventCheckInIsOpen\(\{ \.\.\.event, startsAt: event\.startsAt \}, campaign, now\)/);
const staffQrSource = apiSource.slice(apiSource.indexOf("async function staffQr"), apiSource.indexOf("async function checkIn"));
assert.match(staffQrSource, /await assertOpenCampaignEvent\(eventId\)/);
const checkInSource = apiSource.slice(apiSource.indexOf("async function checkIn"), apiSource.indexOf("async function checkInRule1"));
assert.match(checkInSource, /await staffCheckInContext\(parsed\.qrCode\)/);
assert.match(checkInSource, /checkInRule1\(input, context\)/);
const checkInContextSource = apiSource.slice(
  apiSource.indexOf("async function staffCheckInContext"),
  apiSource.indexOf("async function directNewcomers"),
);
assert.match(checkInContextSource, /await assertOpenCampaignEvent\(Number\(row\.eventID\)\)/);
assert.match(checkInContextSource, /campaignID: Number\(campaign\.id\)/);
const rule2Source = apiSource.slice(
  apiSource.indexOf("async function checkInRule2"),
  apiSource.indexOf("async function directNewcomers"),
);
assert.ok(
  rule2Source.indexOf("VALUES (@eventID, @staffQrID, @companionCustomerID") <
    rule2Source.indexOf("FROM dbo.ExpPointLedger WITH"),
  "Rule 2 must record attributed attendance before returning a duplicate reward.",
);
assert.match(rule2Source, /@companionAttendanceOwner NVARCHAR\(50\)/);
assert.match(rule2Source, /\.input\("campaignID", sql\.BigInt, context\.campaignID\)/);
assert.match(rule2Source, /CustomerID = @customerID\s+AND campaignID = @campaignID\s+AND sourceType/);
assert.match(rule2Source, /INSERT dbo\.ExpPointLedger \(CustomerID, campaignID,/);
assert.match(rule2Source, /INSERT dbo\.CustomerProgress \(CustomerID, campaignID, expTotal, pointBalance\)/);
assert.doesNotMatch(
  rule2Source.match(/SELECT TOP \(1\) @companionAttendanceID[\s\S]*?ORDER BY attendanceID DESC;/)?.[0] ?? "",
  /participantExternalID = @customerID/,
  "The unique attendance lookup must not filter by owner.",
);
assert.match(rule2Source, /IF @companionAttendanceOwner IS NULL[\s\S]*UPDATE dbo\.Attendance[\s\S]*participantExternalID = @customerID/);
assert.match(rule2Source, /ELSE IF @companionAttendanceOwner <> @customerID[\s\S]*THROW 51002, 'Companion already checked in with another dealer'/);
assert.match(apiSource, /offset \+= 500/);
assert.match(apiSource, /ids\.slice\(offset, offset \+ 500\)/);

const rewardsSource = apiSource.slice(
  apiSource.indexOf("async function rewards"),
  apiSource.indexOf("async function redeem"),
);
assert.match(rewardsSource, /p\.campaignID = @campaignID/);
assert.match(rewardsSource, /cr\.campaignID = @campaignID/);
assert.match(
  rewardsSource,
  /WHERE cr\.CustomerID = @customerID\s+AND cr\.campaignID = @campaignID\s+AND cr\.status <> N'voided'/,
);

const redeemSource = apiSource.slice(
  apiSource.indexOf("async function redeem"),
  apiSource.indexOf("async function claim"),
);
assert.match(redeemSource, /if \(!campaign\) throw new ApiError\(400, "Reward unavailable"\)/);
assert.match(redeemSource, /CustomerID = @customerID AND campaignID = @campaignID\s+AND rewardRuleID = @rewardRuleID/);
assert.match(redeemSource, /CustomerID, campaignID, rewardRuleID/);
assert.match(redeemSource, /CustomerID, campaignID, sourceType/);

const specialRewardsSource = apiSource.slice(
  apiSource.indexOf("async function syncSpecialRewards"),
  apiSource.indexOf("export function giftCode"),
);
assert.match(specialRewardsSource, /campaign: Campaign/);
assert.match(specialRewardsSource, /campaignID = @campaignID/);
assert.match(specialRewardsSource, /CustomerID, campaignID, rewardRuleID/);

const leaderboardSource = apiSource.slice(
  apiSource.indexOf("async function leaderboard"),
  apiSource.indexOf("async function syncSpecialRewards"),
);
assert.match(leaderboardSource, /ledger\.campaignID = @campaignID/);
assert.match(leaderboardSource, /MAX\(CASE WHEN ledger\.expDelta > 0 THEN ledger\.createdAt END\)/);
assert.match(leaderboardSource, /ROW_NUMBER\(\) OVER/);
assert.match(leaderboardSource, /rank <= 50 OR CustomerID = @currentCustomerID/);
assert.match(leaderboardSource, /rank: Number\(row\.rank\)/);
assert.match(apiSource, /leaderboard\(\s*principal\.role === "dealer" \? principal\.subjectId : null/);

const directNewcomersRoute = apiSource.match(
  /if \(req\.method === "GET" && path === "\/api\/me\/direct-newcomers"\) \{([\s\S]*?)\n    \}/,
)?.[1];
assert.ok(directNewcomersRoute, "GET /api/me/direct-newcomers must exist");
assert.match(directNewcomersRoute, /requireRole\(principal, "dealer"\)/);
assert.match(directNewcomersRoute, /directNewcomers\(principal\.subjectId, Number\(url\.searchParams\.get\("eventId"\)\)\)/);

const directNewcomersFunction = apiSource.match(
  /async function directNewcomers\(customerId: string, eventId: number\) \{([\s\S]*?)\n\}/,
)?.[1];
assert.ok(directNewcomersFunction, "directNewcomers must exist");
assert.match(directNewcomersFunction, /\.input\("eventID", sql\.BigInt, eventId\)/);
assert.match(directNewcomersFunction, /openDealerCampaign\(taipeiDateKey\(new Date\(\)\)\)/);
assert.match(directNewcomersFunction, /eventForNewcomerWindow\(eventId, campaign\.id\)/);
assert.match(directNewcomersFunction, /\.input\("campaignID", sql\.BigInt, campaign\.id\)/);
assert.match(directNewcomersFunction, /ledger\.campaignID = @campaignID/);
assert.match(directNewcomersFunction, /status = N'checked_in'/);
assert.match(directNewcomersFunction, /checkedInCustomerIDs\.has\(String\(row\.CustomerID\)\)/);
assert.match(directNewcomersFunction, /checkedIn:/);

for (let i = 0; i < 20; i++) {
  const code = giftCode();
  assert.equal(code.length, 35);
  assert.match(code, /^[0-9a-f]{35}$/);
}

delete process.env.EXP_POINT_RULE;
assert.equal(getExpPointRule(), 1);
process.env.EXP_POINT_RULE = "2";
assert.equal(getExpPointRule(), 2);
process.env.EXP_POINT_RULE = "9";
assert.equal(getExpPointRule(), 1);
delete process.env.EXP_POINT_RULE;

assert.equal(activityCatalog.length, 10);
assert.equal(activityCatalog[0].eventType, "elite");
assert.equal(activityCatalog[0].points, 20);

assert.equal(defaultLocationForBusinessUnit("WM00000001"), "中區");
assert.equal(defaultLocationForBusinessUnit("2"), "北區");
assert.equal(defaultLocationForBusinessUnit("9"), "中區");

assert.throws(
  () =>
    parseEventSessionInput(
      {
        role: "dealer",
        employeeId: "EP00821121",
        eventType: "sha",
        startAt: "2026-07-25T09:30:00+08:00",
        endAt: "2026-07-25T17:00:00+08:00",
        location: "中區",
      },
      activityCatalog,
    ),
  /Staff role required/,
);

assert.throws(
  () =>
    parseEventSessionInput(
      {
        role: "staff",
        employeeId: "EP00821121",
        eventType: "unknown",
        startAt: "2026-07-25T09:30:00+08:00",
        location: "中區",
      },
      activityCatalog,
    ),
  /Unknown activity/,
);

assert.throws(
  () =>
    parseEventSessionInput(
      {
        role: "staff",
        employeeId: "EP00821121",
        eventType: "sha",
        location: "中區",
      },
      activityCatalog,
    ),
  /Missing startAt/,
);

const eliteSession = parseEventSessionInput(
  {
    role: "staff",
    employeeId: "EP00821121",
    eventType: "elite",
    startAt: "2026-08-03T09:00:00+08:00",
    endAt: "2026-08-05T17:00:00+08:00",
    location: "自訂",
    customLocation: "南投研習基地",
    description: "多日活動",
  },
  activityCatalog,
);

assert.equal(eliteSession.eventName, "菁英研習營");
assert.equal(eliteSession.location, "南投研習基地");
assert.equal(eliteSession.endAt, "2026-08-05T17:00:00+08:00");

console.log("api contracts ok");
