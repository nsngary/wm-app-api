import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AuthHttpError,
  authenticateAccessToken,
  authenticatePassword,
  changePassword,
  createSession,
  deleteAccount,
  getSessionUser,
  logoutSession,
  refreshSession,
  resetPassword,
  type AuthPrincipal,
} from "./auth";
import { getPool, sql } from "./db";
import { buildDealerEventFeed } from "./dealer-events";
import { buildSeasonSummaries, LEGACY_CAMPAIGN_ID } from "./dealer-history";
import {
  rankingBands,
  rankingTrend,
  selectDealerRankingRows,
} from "./dealer-ranking";
import {
  activityCatalog,
  defaultLocationForBusinessUnit,
  parseEventSessionInput,
} from "./activity-catalog";
import {
  COMPANION_DIRECT_NEWCOMER_RULE_TYPE,
  COMPANION_DIRECT_NEWCOMER_SOURCE,
  companionDirectNewcomerSourceID,
  parseQrPayload,
} from "./domain";
import { parseCampaignInput } from "./campaigns";
import type { Campaign } from "./campaigns";
import {
  eventCheckInIsOpen,
  taipeiDateKey,
} from "./dealer-event-status";

type Role = "dealer" | "staff";

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const REQUIRE_REWARD_CLAIM_SALES_ID = process.env.TEAMUP_REQUIRE_REWARD_CLAIM_SALES_ID === "true";
const DEV_CLAIM_SALES_ID = process.env.TEAMUP_DEV_CLAIM_SALES_ID || "DEV_NO_SALESID";

export type ExpPointRuleMode = 1 | 2;

export function getExpPointRule(): ExpPointRuleMode {
  return process.env.EXP_POINT_RULE === "2" ? 2 : 1;
}

export async function handleApi(req: IncomingMessage, res: ServerResponse) {
  setCors(res);
  if (req.method === "OPTIONS") return send(res, 204, null);

  try {
    const url = new URL(req.url || "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const campaignPatch = path.match(/^\/api\/campaigns\/(\d+)$/);
    const dealerHistoryDetail = path.match(/^\/api\/me\/history\/([^/]+)$/);

    if (req.method === "POST" && path === "/api/auth/login") {
      const input = await body(req);
      const user = await authenticatePassword(mustString(input.accountId), mustString(input.password));
      const tokens = await createSession(user, optionalString(input.deviceName));
      return send(res, 200, { user, ...tokens });
    }
    if (req.method === "POST" && path === "/api/auth/refresh") {
      return send(res, 200, await refreshSession(mustString((await body(req)).refreshToken)));
    }
    if (req.method === "POST" && path === "/api/auth/reset-password") {
      const input = await body(req);
      await resetPassword(
        mustString(input.accountId),
        mustString(input.resetCode),
        mustString(input.newPassword),
      );
      return send(res, 200, { ok: true });
    }
    if (req.method === "GET" && path === "/api/auth/me") {
      const principal = await requestPrincipal(req);
      return send(res, 200, { user: await getSessionUser(principal) });
    }
    if (req.method === "POST" && path === "/api/auth/logout") {
      const principal = await requestPrincipal(req);
      await logoutSession(principal, optionalString((await body(req)).refreshToken));
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && path === "/api/auth/change-password") {
      const principal = await requestPrincipal(req);
      const input = await body(req);
      return send(
        res,
        200,
        await changePassword(
          principal,
          mustString(input.currentPassword),
          mustString(input.newPassword),
        ),
      );
    }
    if (req.method === "DELETE" && path === "/api/auth/account") {
      const principal = await requestPrincipal(req);
      requireRole(principal, "dealer");

      const input = await body(req);
      await deleteAccount(
        principal,
        mustString(input.currentPassword),
      );

      return send(res, 200, { ok: true });
    }

    // 從這裡開始都是受保護的應用程式資料與操作。
    const principal = await requestPrincipal(req);
    // 先不要求首次登入強制修改密碼
    // if (principal.mustChangePassword) {
    //   throw new AuthHttpError(403, "請先更新密碼");
    // }

    if (req.method === "GET" && path === "/api/activities") {
      return send(res, 200, { activities: await activities() });
    }
    if (req.method === "GET" && path === "/api/events") {
      return send(res, 200, { events: await events() });
    }
    if (req.method === "GET" && path === "/api/me/events") {
      requireRole(principal, "dealer");
      return send(res, 200, await dealerEvents(principal.subjectId));
    }
    if (req.method === "GET" && path === "/api/me/ranking") {
      requireRole(principal, "dealer");
      const period = url.searchParams.get("period");
      if (period !== "month" && period !== "season") {
        throw new ApiError(400, "Invalid ranking period");
      }
      return send(res, 200, await dealerRanking(principal.subjectId, period));
    }
    if (req.method === "GET" && path === "/api/me/history") {
      requireRole(principal, "dealer");
      return send(res, 200, { seasons: await dealerHistory(principal.subjectId) });
    }
    if (req.method === "GET" && dealerHistoryDetail) {
      requireRole(principal, "dealer");
      return send(
        res,
        200,
        {
          history: await dealerSeasonHistory(
            principal.subjectId,
            decodeURIComponent(dealerHistoryDetail[1]),
          ),
        },
      );
    }
    if (req.method === "GET" && path === "/api/config") {
      return send(res, 200, { expPointRule: getExpPointRule() });
    }
    if (req.method === "GET" && path === "/api/campaigns") {
      requireRole(principal, "staff");
      return send(res, 200, { campaigns: await campaigns() });
    }
    if (req.method === "POST" && path === "/api/campaigns") {
      requireRole(principal, "staff");
      return send(res, 200, { campaign: await createCampaign(await body(req)) });
    }
    if (req.method === "PATCH" && campaignPatch) {
      requireRole(principal, "staff");
      return send(res, 200, {
        campaign: await updateCampaign(campaignPatch[1], await body(req)),
      });
    }
    if (req.method === "POST" && path === "/api/events") {
      requireRole(principal, "staff");
      return send(res, 200, {
        event: await createEventSession({
          ...(await body(req)),
          role: "staff",
          employeeId: principal.subjectId,
        }),
      });
    }
    if (req.method === "POST" && path === "/api/staff-qr") {
      requireRole(principal, "staff");
      return send(res, 200, await staffQr({
        ...(await body(req)),
        employeeId: principal.subjectId,
      }));
    }
    if (req.method === "POST" && path === "/api/checkins") {
      requireRole(principal, "dealer");
      return send(res, 200, await checkIn({
        ...(await body(req)),
        customerId: principal.subjectId,
      }));
    }
    if (req.method === "GET" && path === "/api/me/direct-newcomers") {
      requireRole(principal, "dealer");
      return send(
        res,
        200,
        await directNewcomers(principal.subjectId, Number(url.searchParams.get("eventId"))),
      );
    }
    if (req.method === "GET" && path === "/api/me/progress") {
      requireRole(principal, "dealer");
      return send(res, 200, await progress(principal.subjectId));
    }
    if (req.method === "GET" && path === "/api/me/ledger") {
      requireRole(principal, "dealer");
      return send(res, 200, await ledger(principal.subjectId));
    }
    if (req.method === "GET" && path === "/api/me/rewards") {
      requireRole(principal, "dealer");
      return send(res, 200, await rewards(principal.subjectId));
    }
    if (req.method === "POST" && path === "/api/rewards/redeem") {
      requireRole(principal, "dealer");
      return send(res, 200, await redeem({
        ...(await body(req)),
        customerId: principal.subjectId,
      }));
    }
    if (req.method === "POST" && path === "/api/rewards/claim") {
      requireRole(principal, "staff");
      return send(res, 200, await claim({
        ...(await body(req)),
        employeeId: principal.subjectId,
      }));
    }
    if (req.method === "GET" && path === "/api/leaderboard") {
      return send(res, 200, {
        leaderboard: await leaderboard(
          principal.role === "dealer" ? principal.subjectId : null,
        ),
      });
    }

    throw new ApiError(404, "Not found");
  } catch (error) {
    const duplicateAttendance =
      error instanceof Error &&
      /UX_Attendance_EventCustomer_CheckedIn|Cannot inser duplicate key/.test(error.message);
    const campaignRangeConflict =
      error instanceof Error && /Campaign date range overlaps an existing campaign/.test(error.message);

    const status = duplicateAttendance || campaignRangeConflict
      ? 409
      : error instanceof ApiError || error instanceof AuthHttpError
        ? error.status
        : 500;
    const message = duplicateAttendance
      ? "您已經簽到過這場活動。"
      : error instanceof Error
        ? error.message
        : "Server error";

    return send(res, status, { error: message });
  }
}

async function activities() {
  const pool = await getPool("teamup");
  const result = await pool.request().query(`
    SELECT eventType, activityName, defaultPoint, isActive, sortOrder
    FROM dbo.Activity
    WHERE isActive = 1
    ORDER BY sortOrder ASC, eventType ASC
  `);

  return result.recordset.map((row) => ({
    eventType: row.eventType,
    name: row.activityName,
    points: row.defaultPoint,
    isActive: Boolean(row.isActive),
    sortOrder: row.sortOrder,
  }));
}

async function campaigns() {
  const pool = await getPool("teamup");
  const result = await pool.request().query(`
    SELECT campaignID, name, startsOn, endsOn, isOpen
    FROM dbo.Campaign
    ORDER BY startsOn DESC, campaignID DESC
  `);
  return result.recordset.map(campaignDto);
}

function campaignDto(row: Record<string, any>): Campaign {
  return {
    id: String(row.campaignID),
    name: String(row.name),
    startsOn: dateOnly(row.startsOn),
    endsOn: dateOnly(row.endsOn),
    isOpen: Boolean(row.isOpen),
  };
}

async function createCampaign(input: Record<string, unknown>) {
  const campaign = campaignInput(input);

  const pool = await getPool("teamup");
  const result = await pool
    .request()
    .input("name", sql.NVarChar(100), campaign.name)
    .input("startsOn", sql.Date, campaign.startsOn)
    .input("endsOn", sql.Date, campaign.endsOn)
    .input("isOpen", sql.Bit, campaign.isOpen)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRAN;
      IF EXISTS (
        SELECT 1
        FROM dbo.Campaign WITH (UPDLOCK, HOLDLOCK)
        WHERE startsOn <= @endsOn
          AND endsOn >= @startsOn
      ) THROW 51003, '日期與現存賽季重疊', 1;

      IF @isOpen = 1
        UPDATE dbo.Campaign
        SET isOpen = 0, updatedAt = SYSDATETIMEOFFSET()
        WHERE isOpen = 1;

      INSERT dbo.Campaign (name, startsOn, endsOn, isOpen)
      OUTPUT inserted.campaignID, inserted.name, inserted.startsOn, inserted.endsOn, inserted.isOpen
      VALUES (@name, @startsOn, @endsOn, @isOpen);
      COMMIT;
    `);
  return campaignDto(result.recordset[0]);
}

async function updateCampaign(campaignID: string, input: Record<string, unknown>) {
  const campaign = campaignInput(input);
  await assertCampaignExists(campaignID);

  const pool = await getPool("teamup");
  const result = await pool
    .request()
    .input("campaignID", sql.BigInt, campaignID)
    .input("name", sql.NVarChar(100), campaign.name)
    .input("startsOn", sql.Date, campaign.startsOn)
    .input("endsOn", sql.Date, campaign.endsOn)
    .input("isOpen", sql.Bit, campaign.isOpen)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRAN;
      IF EXISTS (
        SELECT 1
        FROM dbo.Campaign WITH (UPDLOCK, HOLDLOCK)
        WHERE startsOn <= @endsOn
          AND endsOn >= @startsOn
          AND campaignID <> @campaignID
      ) THROW 51003, '日期與現存賽季重疊', 1;

      IF @isOpen = 1
        UPDATE dbo.Campaign
        SET isOpen = 0, updatedAt = SYSDATETIMEOFFSET()
        WHERE isOpen = 1 AND campaignID <> @campaignID;

      UPDATE dbo.Campaign
      SET name = @name, startsOn = @startsOn, endsOn = @endsOn, isOpen = @isOpen, updatedAt = SYSDATETIMEOFFSET()
      OUTPUT inserted.campaignID, inserted.name, inserted.startsOn, inserted.endsOn, inserted.isOpen
      WHERE campaignID = @campaignID;
      COMMIT;
    `);
  if (!result.recordset[0]) throw new ApiError(404, "Campaign not found");
  return campaignDto(result.recordset[0]);
}

function campaignInput(input: Record<string, unknown>) {
  try {
    return parseCampaignInput(input);
  } catch (error) {
    throw new ApiError(400, error instanceof Error ? error.message : "Invalid campaign");
  }
}

async function assertCampaignExists(campaignID: string) {
  const pool = await getPool("teamup");
  const result = await pool
    .request()
    .input("campaignID", sql.BigInt, campaignID)
    .query(`
      SELECT campaignID
      FROM dbo.Campaign
      WHERE campaignID = @campaignID
    `);
  if (!result.recordset[0]) throw new ApiError(404, "Campaign not found");
}

async function events() {
  const pool = await getPool("teamup");
  const result = await pool.request().query(`
    SELECT
      e.eventID,
      e.campaignID,
      e.eventType,
      e.eventName,
      e.startAt,
      e.endAt,
      e.location,
      e.description,
      e.isActive,
      a.activityName,
      a.sortOrder AS activitySortOrder,
      ISNULL(a.defaultPoint, ISNULL((SELECT MAX(pointAmount) FROM dbo.ExpPointRule r WHERE r.eventType = e.eventType AND r.isActive = 1), 0)) AS points,
      COALESCE((SELECT TOP (1) r.expAmount FROM dbo.ExpPointRule r WHERE r.eventType = e.eventType AND r.participantType = N'dealer' AND r.isActive = 1 ORDER BY r.expPointRuleID), a.defaultPoint, 0) AS rewardExp,
      COALESCE((SELECT TOP (1) r.pointAmount FROM dbo.ExpPointRule r WHERE r.eventType = e.eventType AND r.participantType = N'dealer' AND r.isActive = 1 ORDER BY r.expPointRuleID), a.defaultPoint, 0) AS rewardPoints,
      ISNULL((SELECT STRING_AGG(r.participantType, ',') FROM dbo.ExpPointRule r WHERE r.eventType = e.eventType AND r.isActive = 1), '') AS targets,
      ISNULL((SELECT COUNT(*) FROM dbo.Attendance a WHERE a.eventID = e.eventID AND a.status = N'checked_in'), 0) AS checkedInCount
    FROM dbo.[Event] e
    LEFT JOIN dbo.Activity a ON a.eventType = e.eventType
    WHERE e.isActive = 1
    ORDER BY e.startAt ASC, a.sortOrder ASC, e.eventID ASC
  `);

  return result.recordset.map((row) => eventDto(row));
}

function eventDto(row: Record<string, any>, includeIsActive = false) {
  return {
    id: String(row.eventID),
    eventID: Number(row.eventID),
    campaignId: row.campaignID == null ? null : String(row.campaignID),
    eventType: row.eventType,
    name: row.eventName,
    activityName: row.activityName,
    activitySortOrder: row.activitySortOrder,
    startsAt: date(row.startAt),
    endAt: date(row.endAt),
    location: row.location || "",
    description: row.description || "",
    points: Number(row.points),
    rewardExp: Number(row.rewardExp),
    rewardPoints: Number(row.rewardPoints),
    targets: String(row.targets || "")
      .split(",")
      .filter(Boolean),
    registeredCount: 0,
    checkedInCount: row.checkedInCount,
    ...(includeIsActive ? { isActive: Boolean(row.isActive) } : {}),
  };
}

async function openDealerCampaign(today: string) {
  const pool = await getPool("teamup");
  const result = await pool
    .request()
    .input("today", sql.Date, today)
    .query(`
      SELECT campaignID, name, startsOn, endsOn, isOpen
      FROM dbo.Campaign
      WHERE isOpen = 1
        AND startsOn <= @today
        AND endsOn >= @today
    `);
  return result.recordset[0] ? campaignDto(result.recordset[0]) : null;
}

async function campaignForDate(day: string) {
  const pool = await getPool("teamup");
  const result = await pool
    .request()
    .input("day", sql.Date, day)
    .query(`
      SELECT campaignID, name, startsOn, endsOn, isOpen
      FROM dbo.Campaign
      WHERE startsOn <= @day AND endsOn >= @day
    `);
  if (result.recordset.length > 1) throw new Error("Date belongs to multiple Campaigns");
  return result.recordset[0] ? campaignDto(result.recordset[0]) : null;
}

async function assertOpenCampaignEvent(eventID: number, now = new Date()) {
  const campaign = await openDealerCampaign(taipeiDateKey(now));
  if (!campaign) throw new ApiError(400, "Activity check-in is not open");
  const event = (await events()).find((item) => item.eventID === eventID);
  if (!event?.startsAt || !eventCheckInIsOpen({ ...event, startsAt: event.startsAt }, campaign, now)) {
    throw new ApiError(400, "Activity check-in is not open");
  }
  return { campaign, event };
}

async function dealerEventRows(campaign: Campaign) {
  const pool = await getPool("teamup");
  const result = await pool
    .request()
    .input("campaignID", sql.BigInt, campaign.id)
    .query(`
      SELECT
        e.eventID,
        e.campaignID,
        e.eventType,
        e.eventName,
        e.startAt,
        e.endAt,
        e.location,
        e.description,
        e.isActive,
        activity.activityName,
        activity.sortOrder AS activitySortOrder,
        ISNULL(activity.defaultPoint, ISNULL((SELECT MAX(pointAmount) FROM dbo.ExpPointRule r WHERE r.eventType = e.eventType AND r.isActive = 1), 0)) AS points,
        COALESCE((SELECT TOP (1) r.expAmount FROM dbo.ExpPointRule r WHERE r.eventType = e.eventType AND r.participantType = N'dealer' AND r.isActive = 1 ORDER BY r.expPointRuleID), activity.defaultPoint, 0) AS rewardExp,
        COALESCE((SELECT TOP (1) r.pointAmount FROM dbo.ExpPointRule r WHERE r.eventType = e.eventType AND r.participantType = N'dealer' AND r.isActive = 1 ORDER BY r.expPointRuleID), activity.defaultPoint, 0) AS rewardPoints,
        ISNULL((SELECT STRING_AGG(r.participantType, ',') FROM dbo.ExpPointRule r WHERE r.eventType = e.eventType AND r.isActive = 1), '') AS targets,
        ISNULL((SELECT COUNT(*) FROM dbo.Attendance a WHERE a.eventID = e.eventID AND a.status = N'checked_in'), 0) AS checkedInCount
      FROM dbo.[Event] e
      LEFT JOIN dbo.Activity activity ON activity.eventType = e.eventType
      WHERE e.campaignID = @campaignID
      ORDER BY e.startAt ASC, activity.sortOrder ASC, e.eventID ASC
    `);

  return result.recordset.map((row) => eventDto(row, true));
}

async function dealerEvents(customerId: string) {
  const now = new Date();
  const campaign = await openDealerCampaign(taipeiDateKey(now));
  if (!campaign) return { activeEvents: [], endedEvents: [], eventHistory: [] };

  const pool = await getPool("teamup");
  const [eventRows, companionAttendanceRows, attendanceRows, ledgerRows] = await Promise.all([
    dealerEventRows(campaign),
    pool
      .request()
      .input("customerID", sql.NVarChar(50), customerId)
      .input("campaignID", sql.BigInt, campaign.id)
      .query(`
        SELECT attendance.eventID, attendance.CustomerID, attendance.participantExternalID
        FROM dbo.Attendance attendance
        JOIN dbo.[Event] e ON e.eventID = attendance.eventID
        WHERE attendance.participantExternalID = @customerID
          AND attendance.CustomerID <> @customerID
          AND attendance.status = N'checked_in'
          AND e.campaignID = @campaignID
      `),
    pool
      .request()
      .input("customerID", sql.NVarChar(50), customerId)
      .input("campaignID", sql.BigInt, campaign.id)
      .query(`
        SELECT attendance.eventID, attendance.status, attendance.checkedInAt
        FROM dbo.Attendance attendance
        JOIN dbo.[Event] e ON e.eventID = attendance.eventID
        WHERE attendance.CustomerID = @customerID
          AND attendance.status = N'checked_in'
          AND e.campaignID = @campaignID
      `),
    pool
      .request()
      .input("customerID", sql.NVarChar(50), customerId)
      .input("campaignID", sql.BigInt, campaign.id)
      .query(`
        SELECT ledger.CustomerID, ledger.eventID, ledger.sourceType, ledger.sourceID,
          ledger.expDelta, ledger.pointDelta, ledger.createdAt
        FROM dbo.ExpPointLedger ledger
        JOIN dbo.[Event] e ON e.eventID = ledger.eventID
        WHERE ledger.CustomerID = @customerID
          AND ledger.eventID IS NOT NULL
          AND e.campaignID = @campaignID
      `),
  ]);

  const ledger = ledgerRows.recordset.map((row) => ({
    ...row,
    eventID: Number(row.eventID),
    createdAt: date(row.createdAt) || "",
  }));
  const feed = buildDealerEventFeed({
    customerId,
    now,
    campaign,
    events: eventRows.map((event) => ({ ...event, startsAt: event.startsAt || "" })),
    attendances: attendanceRows.recordset.map((row) => ({
      eventID: Number(row.eventID),
      status: String(row.status),
      checkedInAt: date(row.checkedInAt),
    })),
    companionAttendances: companionAttendanceRows.recordset.map((row) => ({
      eventID: Number(row.eventID),
      CustomerID: String(row.CustomerID),
      participantExternalID: row.participantExternalID == null ? null : String(row.participantExternalID),
    })),
    ledger,
    companionNames: {},
  });
  const companionNames = await customerNames([
    ...new Set(
      feed.eventHistory.flatMap((event) => event.companions.map((companion) => companion.customerId)),
    ),
  ]);
  for (const event of feed.eventHistory) {
    for (const companion of event.companions) {
      companion.name = companionNames[companion.customerId] || companion.customerId;
    }
  }
  return feed;
}

async function dealerHistory(customerId: string) {
  const current = await openDealerCampaign(taipeiDateKey(new Date()));
  const pool = await getPool("teamup");
  const result = await pool
    .request()
    .input("customerID", sql.NVarChar(50), customerId)
    .query(`
      SELECT
        campaign.campaignID, campaign.name, campaign.startsOn, campaign.endsOn,
        ISNULL(totals.exp, 0) AS exp,
        ISNULL(levels.levelName, N'分享入門') AS levelName,
        (SELECT COUNT(DISTINCT attendance.eventID)
          FROM dbo.Attendance attendance
          JOIN dbo.[Event] event ON event.eventID = attendance.eventID
          WHERE attendance.CustomerID = @customerID
            AND attendance.status = N'checked_in'
            AND event.campaignID = campaign.campaignID) AS participation,
        (SELECT COUNT(DISTINCT attendance.CustomerID)
          FROM dbo.Attendance attendance
          JOIN dbo.[Event] event ON event.eventID = attendance.eventID
          WHERE attendance.participantExternalID = @customerID
            AND attendance.CustomerID <> @customerID
            AND attendance.status = N'checked_in'
            AND event.campaignID = campaign.campaignID) AS newcomers,
        (SELECT COUNT(*) FROM dbo.CustomerReward reward
          WHERE reward.CustomerID = @customerID
            AND reward.campaignID = campaign.campaignID
            AND reward.status <> N'voided') AS rewards
      FROM dbo.Campaign campaign
      OUTER APPLY (
        SELECT SUM(ledger.expDelta) AS exp
        FROM dbo.ExpPointLedger ledger
        WHERE ledger.CustomerID = @customerID
          AND ledger.campaignID = campaign.campaignID
      ) totals
      OUTER APPLY (
        SELECT TOP (1) levelRule.levelName
        FROM dbo.LevelRule levelRule
        WHERE levelRule.isActive = 1
          AND levelRule.expRequired <= ISNULL(totals.exp, 0)
        ORDER BY levelRule.expRequired DESC, levelRule.levelNo DESC
      ) levels

      UNION ALL

      SELECT
        NULL, N'未分類歷史', NULL, NULL,
        ISNULL((SELECT SUM(ledger.expDelta) FROM dbo.ExpPointLedger ledger
          WHERE ledger.CustomerID = @customerID AND ledger.campaignID IS NULL), 0),
        N'分享入門',
        (SELECT COUNT(DISTINCT attendance.eventID)
          FROM dbo.Attendance attendance
          JOIN dbo.[Event] event ON event.eventID = attendance.eventID
          WHERE attendance.CustomerID = @customerID
            AND attendance.status = N'checked_in'
            AND event.campaignID IS NULL),
        (SELECT COUNT(DISTINCT attendance.CustomerID)
          FROM dbo.Attendance attendance
          JOIN dbo.[Event] event ON event.eventID = attendance.eventID
          WHERE attendance.participantExternalID = @customerID
            AND attendance.CustomerID <> @customerID
            AND attendance.status = N'checked_in'
            AND event.campaignID IS NULL),
        (SELECT COUNT(*) FROM dbo.CustomerReward reward
          WHERE reward.CustomerID = @customerID
            AND reward.campaignID IS NULL
            AND reward.status <> N'voided')
      WHERE EXISTS (
        SELECT 1 FROM dbo.ExpPointLedger ledger
        WHERE ledger.CustomerID = @customerID AND ledger.campaignID IS NULL
      ) OR EXISTS (
        SELECT 1 FROM dbo.CustomerReward reward
        WHERE reward.CustomerID = @customerID
          AND reward.campaignID IS NULL
          AND reward.status <> N'voided'
      ) OR EXISTS (
        SELECT 1 FROM dbo.Attendance attendance
        JOIN dbo.[Event] event ON event.eventID = attendance.eventID
        WHERE (attendance.CustomerID = @customerID OR attendance.participantExternalID = @customerID)
          AND attendance.status = N'checked_in'
          AND event.campaignID IS NULL
      );
    `);

  return buildSeasonSummaries(
    result.recordset.map((row) => ({
      ...row,
      startsOn: row.startsOn == null ? null : dateOnly(row.startsOn),
      endsOn: row.endsOn == null ? null : dateOnly(row.endsOn),
    })),
    current?.id ?? null,
  );
}

async function dealerSeasonHistory(customerId: string, campaignId: string) {
  const isLegacy = campaignId === LEGACY_CAMPAIGN_ID;
  if (!isLegacy && !/^\d+$/.test(campaignId)) throw new ApiError(400, "Invalid campaignId");

  const seasons = await dealerHistory(customerId);
  const season = seasons.find((item) => item.id === campaignId);
  if (!season) throw new ApiError(404, "Campaign history not found");

  const pool = await getPool("teamup");
  const request = () => pool
    .request()
    .input("customerID", sql.NVarChar(50), customerId)
    .input("campaignID", sql.BigInt, isLegacy ? null : campaignId)
    .input("legacy", sql.Bit, isLegacy);
  const campaignWhere = `(event.campaignID = @campaignID OR (@legacy = 1 AND event.campaignID IS NULL))`;
  const recordWhere = `(campaignID = @campaignID OR (@legacy = 1 AND campaignID IS NULL))`;
  const [eventRows, attendanceRows, companionRows, ledgerRows, rewardRows] = await Promise.all([
    request().query(`
      SELECT
        event.eventID, event.campaignID, event.eventType, event.eventName,
        event.startAt, event.endAt, event.location, event.description, event.isActive,
        activity.activityName, activity.sortOrder AS activitySortOrder,
        ISNULL(activity.defaultPoint, 0) AS points,
        0 AS rewardExp, 0 AS rewardPoints,
        N'' AS targets,
        (SELECT COUNT(*) FROM dbo.Attendance countAttendance
          WHERE countAttendance.eventID = event.eventID
            AND countAttendance.status = N'checked_in') AS checkedInCount
      FROM dbo.[Event] event
      LEFT JOIN dbo.Activity activity ON activity.eventType = event.eventType
      WHERE ${campaignWhere}
        AND EXISTS (
          SELECT 1 FROM dbo.Attendance attendance
          WHERE attendance.eventID = event.eventID
            AND attendance.CustomerID = @customerID
            AND attendance.status = N'checked_in'
        )
      ORDER BY event.startAt DESC, event.eventID DESC
    `),
    request().query(`
      SELECT attendance.eventID, attendance.status, attendance.checkedInAt
      FROM dbo.Attendance attendance
      JOIN dbo.[Event] event ON event.eventID = attendance.eventID
      WHERE attendance.CustomerID = @customerID
        AND attendance.status = N'checked_in'
        AND ${campaignWhere}
    `),
    request().query(`
      SELECT attendance.eventID, attendance.CustomerID, attendance.participantExternalID
      FROM dbo.Attendance attendance
      JOIN dbo.[Event] event ON event.eventID = attendance.eventID
      WHERE attendance.participantExternalID = @customerID
        AND attendance.CustomerID <> @customerID
        AND attendance.status = N'checked_in'
        AND ${campaignWhere}
    `),
    request().query(`
      SELECT ledgerID, CustomerID, eventID, sourceType, sourceID,
        expDelta, pointDelta, note, createdAt
      FROM dbo.ExpPointLedger
      WHERE CustomerID = @customerID AND ${recordWhere}
      ORDER BY createdAt DESC, ledgerID DESC
    `),
    request().query(`
      SELECT reward.rewardRuleID, rewardRule.levelNo,
        reward.gift AS rewardName, reward.rewardQty, reward.rewardUnit,
        reward.pointCost, rewardRule.rewardType, reward.issueMode, reward.status,
        reward.customerRewardID, reward.giftCode, reward.isGet,
        reward.SalesID, reward.gotAt, reward.issuedAt
      FROM dbo.CustomerReward reward
      JOIN dbo.RewardRule rewardRule
        ON rewardRule.rewardRuleID = reward.rewardRuleID
      WHERE reward.CustomerID = @customerID
        AND (
          reward.campaignID = @campaignID
          OR (@legacy = 1 AND reward.campaignID IS NULL)
        )
        AND reward.status <> N'voided'
      ORDER BY reward.issuedAt DESC, reward.customerRewardID DESC
    `),
  ]);

  const eventDtos = eventRows.recordset.map((row) => eventDto(row, true));
  const attendanceByEvent = new Map<number, Record<string, any>[]>();
  for (const row of attendanceRows.recordset) {
    const eventId = Number(row.eventID);
    attendanceByEvent.set(eventId, [...(attendanceByEvent.get(eventId) ?? []), row]);
  }
  const companionsByEvent = new Map<number, string[]>();
  for (const row of companionRows.recordset) {
    const eventId = Number(row.eventID);
    companionsByEvent.set(eventId, [...(companionsByEvent.get(eventId) ?? []), String(row.CustomerID)]);
  }
  const names = await customerNames([...new Set(companionRows.recordset.map((row) => String(row.CustomerID)))]);
  const ledger = ledgerRows.recordset.map((row) => ({
    ...row,
    eventID: row.eventID == null ? null : Number(row.eventID),
    createdAt: date(row.createdAt) || "",
  }));
  const activities = eventDtos.map((event) => {
    const attendances = attendanceByEvent.get(Number(event.eventID)) ?? [];
    const eventLedger = ledger.filter((row) => row.eventID === event.eventID);
    const checkedInAt = attendances
      .map((row) => date(row.checkedInAt) || "")
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || event.startsAt || "";
    const companionIds = [...new Set(companionsByEvent.get(Number(event.eventID)) ?? [])];
    return {
      ...event,
      checkedInAt,
      companions: companionIds.map((id) => ({ customerId: id, name: names[id] || id })),
      rewardExp: eventLedger.reduce((total, row) => total + Number(row.expDelta), 0),
      rewardPoints: eventLedger.reduce((total, row) => total + Number(row.pointDelta), 0),
      isOngoing: event.isActive !== false && new Date(event.endAt || event.startsAt || 0) >= new Date(),
    };
  });

  return {
    season,
    activities,
    points: ledger,
    rewards: rewardRows.recordset.map((row) => ({
      ...row,
      rewardRuleID: Number(row.rewardRuleID),
      campaignId: isLegacy ? null : campaignId,
      campaignName: season.name,
      SalesID: row.SalesID === DEV_CLAIM_SALES_ID ? null : row.SalesID,
      gotAt: date(row.gotAt),
      issuedAt: date(row.issuedAt),
    })),
  };
}

async function createEventSession(input: Record<string, unknown>) {
  let parsed: ReturnType<typeof parseEventSessionInput>;
  try {
    parsed = parseEventSessionInput(input, activityCatalog);
  } catch (error) {
    throw new ApiError(400, error instanceof Error ? error.message : "Invalid event session");
  }

  await assertEmployee(parsed.employeeId);
  const campaign = await campaignForDate(taipeiDateKey(new Date(parsed.startAt)));
  if (!campaign) throw new ApiError(400, "活動日期不在任何賽季內");

  const pool = await getPool("teamup");
  const result = await pool
    .request()
    .input("campaignID", sql.BigInt, campaign.id)
    .input("eventType", sql.NVarChar(50), parsed.eventType)
    .input("eventName", sql.NVarChar(200), parsed.eventName)
    .input("startAt", sql.DateTimeOffset, new Date(parsed.startAt))
    .input("endAt", sql.DateTimeOffset, parsed.endAt ? new Date(parsed.endAt) : null)
    .input("location", sql.NVarChar(200), parsed.location)
    .input("description", sql.NVarChar(1000), parsed.description)
    .query(`
      DECLARE @created TABLE (eventID BIGINT NOT NULL);

      INSERT dbo.[Event] (campaignID, eventType, eventName, startAt, endAt, location, description, isActive)
      OUTPUT inserted.eventID INTO @created(eventID)
      SELECT @campaignID, @eventType, a.activityName, @startAt, @endAt, @location, @description, 1
      FROM dbo.Activity a
      WHERE a.eventType = @eventType
        AND a.isActive = 1;

      IF NOT EXISTS (SELECT 1 FROM @created) THROW 54000, 'Unknown activity', 1;

      SELECT eventID FROM @created;
    `);

  const eventID = Number(result.recordset[0]?.eventID);
  const event = (await events()).find((item) => item.eventID === eventID);
  if (!event) throw new ApiError(500, "Created event session not found");
  return event;
}

async function staffQr(input: Record<string, unknown>) {
  const eventId = Number(input.eventId);
  const employeeId = mustString(input.employeeId);
  if (!Number.isFinite(eventId)) throw new ApiError(400, "Invalid eventId");
  await assertEmployee(employeeId);
  const { event } = await assertOpenCampaignEvent(eventId);

  const qrCode = token("QR");
  const pool = await getPool("teamup");
  const result = await pool
    .request()
    .input("eventID", sql.BigInt, eventId)
    .input("employeeID", sql.NVarChar(50), employeeId)
    .input("qrCode", sql.NVarChar(200), qrCode)
    .query(`
      DECLARE @now DATETIMEOFFSET(0) = SYSDATETIMEOFFSET();
      INSERT dbo.StaffQrCode (eventID, EmployeeID, qrCode, generatedAt, expiresAt)
      OUTPUT inserted.staffQrID, inserted.eventID, inserted.EmployeeID, inserted.qrCode, inserted.generatedAt, inserted.expiresAt
      VALUES (@eventID, @employeeID, @qrCode, @now, DATEADD(minute, 10, @now));
    `);
  const qr = result.recordset[0];
  return {
    payload: {
      kind: "staff_checkin",
      qrCode: qr.qrCode,
      eventId: String(qr.eventID),
      eventName: event?.name || "",
      staffId: qr.EmployeeID,
      generatedAt: date(qr.generatedAt),
      expiresAt: date(qr.expiresAt),
      qrValue: staffCheckInUrl(qr.qrCode, String(qr.eventID)),
    },
  };
}

async function checkIn(input: Record<string, unknown>) {
  if (getExpPointRule() === 2) return checkInRule2(input);
  const parsed = parseStaffCheckInInput(input.qrCode);
  const context = await staffCheckInContext(parsed.qrCode);
  return checkInRule1(input, context);
}

async function checkInRule1(
  input: Record<string, unknown>,
  context: Awaited<ReturnType<typeof staffCheckInContext>>,
) {
  const parsed = parseStaffCheckInInput(input.qrCode);
  const customerId = mustString(input.customerId);
  const participantType = "dealer";

  const pool = await getPool("teamup");
  const result = await pool
    .request()
    .input("qrCode", sql.NVarChar(200), parsed.qrCode)
    .input("customerID", sql.NVarChar(50), customerId)
    .input("participantType", sql.NVarChar(50), participantType)
    .input("participantName", sql.NVarChar(100), null)
    .input("participantExternalID", sql.NVarChar(50), null)
    .input("campaignID", sql.BigInt, context.campaignID)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRY
        BEGIN TRAN;

        DECLARE @staffQrID BIGINT, @eventID BIGINT, @eventType NVARCHAR(50), @eventName NVARCHAR(200);
        SELECT
          @staffQrID = qr.staffQrID,
          @eventID = qr.eventID,
          @eventType = e.eventType,
          @eventName = e.eventName
        FROM dbo.StaffQrCode qr
        JOIN dbo.[Event] e ON e.eventID = qr.eventID
        WHERE qr.qrCode = @qrCode
          AND qr.isActive = 1
          AND qr.expiresAt >= SYSDATETIMEOFFSET()
          AND e.isActive = 1;

        IF @staffQrID IS NULL THROW 51000, 'QR expired or inactive', 1;

        DECLARE @existingAttendanceID BIGINT;
        SELECT TOP (1) @existingAttendanceID = attendanceID
        FROM dbo.Attendance
        WHERE eventID = @eventID
          AND CustomerID = @customerID
          AND participantType = @participantType
          AND status = N'checked_in'
        ORDER BY attendanceID DESC;

        IF @existingAttendanceID IS NOT NULL
        BEGIN
          COMMIT;
          SELECT
            CAST(1 AS bit) AS duplicate,
            @existingAttendanceID AS attendanceID,
            @eventID AS eventID,
            @eventName AS eventName,
            0 AS expDelta,
            0 AS pointDelta,
            (SELECT expTotal FROM dbo.CustomerProgress WHERE CustomerID = @customerID AND campaignID = @campaignID) AS expTotal,
            (SELECT pointBalance FROM dbo.CustomerProgress WHERE CustomerID = @customerID AND campaignID = @campaignID) AS pointBalance;
          RETURN;
        END;

        DECLARE @ruleID BIGINT, @exp INT, @point INT;
        SELECT TOP (1)
          @ruleID = expPointRuleID,
          @exp = expAmount,
          @point = pointAmount
        FROM dbo.ExpPointRule
        WHERE eventType = @eventType
          AND participantType = @participantType
          AND isActive = 1
        ORDER BY expPointRuleID ASC;

        IF @ruleID IS NULL THROW 51001, 'No active point rule', 1;

        INSERT dbo.Attendance (eventID, staffQrID, CustomerID, participantType, participantName, participantExternalID)
        VALUES (@eventID, @staffQrID, @customerID, @participantType, @participantName, @participantExternalID);

        DECLARE @attendanceID BIGINT = SCOPE_IDENTITY();

        INSERT dbo.ExpPointLedger (CustomerID, campaignID, expPointRuleID, eventID, sourceType, sourceID, expDelta, pointDelta, note)
        VALUES (@customerID, @campaignID, @ruleID, @eventID, N'attendance', CONVERT(NVARCHAR(100), @attendanceID), @exp, @point, @eventName);

        IF EXISTS (SELECT 1 FROM dbo.CustomerProgress WHERE CustomerID = @customerID AND campaignID = @campaignID)
          UPDATE dbo.CustomerProgress
          SET
            expTotal = expTotal + @exp,
            pointBalance = pointBalance + @point,
            updatedAt = SYSDATETIMEOFFSET()
          WHERE CustomerID = @customerID AND campaignID = @campaignID;
        ELSE
          INSERT dbo.CustomerProgress (CustomerID, campaignID, expTotal, pointBalance)
          VALUES (@customerID, @campaignID, @exp, @point);

        DECLARE @newExp INT = (SELECT expTotal FROM dbo.CustomerProgress WHERE CustomerID = @customerID AND campaignID = @campaignID);
        DECLARE @levelNo INT = (
          SELECT TOP (1) levelNo
          FROM dbo.LevelRule
          WHERE isActive = 1 AND expRequired <= @newExp
          ORDER BY expRequired DESC
        );
        UPDATE dbo.CustomerProgress
        SET currentLevelNo = @levelNo, updatedAt = SYSDATETIMEOFFSET()
        WHERE CustomerID = @customerID AND campaignID = @campaignID;

        COMMIT;

        SELECT
          CAST(0 AS bit) AS duplicate,
          @attendanceID AS attendanceID,
          @eventID AS eventID,
          @eventName AS eventName,
          @exp AS expDelta,
          @point AS pointDelta,
          (SELECT expTotal FROM dbo.CustomerProgress WHERE CustomerID = @customerID AND campaignID = @campaignID) AS expTotal,
          (SELECT pointBalance FROM dbo.CustomerProgress WHERE CustomerID = @customerID AND campaignID = @campaignID) AS pointBalance;
      END TRY
      BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
      END CATCH;
    `);

  const checkIn = result.recordset[0];
  const companionPointDelta = checkIn?.duplicate
    ? 0
    : await syncCompanionDirectNewcomerCheckIn(
      Number(checkIn.eventID),
      customerId,
      context.campaignID,
    );

  return { checkIn: { ...checkIn, companionPointDelta } };
}

async function checkInRule2(input: Record<string, unknown>) {
  const parsed = parseStaffCheckInInput(input.qrCode);
  const customerId = mustString(input.customerId);
  const companionCustomerId = mustString(input.companionCustomerId);
  const eventId = Number(input.eventId ?? parsed.eventId);
  if (!Number.isFinite(eventId)) throw new ApiError(400, "Missing eventId");
  if (customerId === companionCustomerId) throw new ApiError(400, "Companion must be a direct newcomer");

  const context = await staffCheckInContext(parsed.qrCode);
  if (context.eventID !== eventId) throw new ApiError(400, "條碼不符：請選擇對應的活動進行簽到");

  const eligible = await directNewcomer(customerId, companionCustomerId, context.startAt);
  if (!eligible) throw new ApiError(400, "Companion is not an eligible direct newcomer");

  const pool = await getPool("teamup");
  const result = await pool
    .request()
    .input("eventID", sql.BigInt, context.eventID)
    .input("staffQrID", sql.BigInt, context.staffQrID)
    .input("eventType", sql.NVarChar(50), context.eventType)
    .input("eventName", sql.NVarChar(200), context.eventName)
    .input("customerID", sql.NVarChar(50), customerId)
    .input("companionCustomerID", sql.NVarChar(50), companionCustomerId)
    .input("participantType", sql.NVarChar(50), "dealer")
    .input("sourceID", sql.NVarChar(100), companionDirectNewcomerSourceID(context.eventType, companionCustomerId))
    .input("campaignID", sql.BigInt, context.campaignID)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRY
        BEGIN TRAN;

        DECLARE @ruleID BIGINT, @exp INT, @point INT;
        SELECT TOP (1)
          @ruleID = expPointRuleID,
          @exp = expAmount,
          @point = pointAmount
        FROM dbo.ExpPointRule
        WHERE eventType = @eventType
          AND participantType = @participantType
          AND isActive = 1
        ORDER BY expPointRuleID ASC;

        IF @ruleID IS NULL THROW 51001, 'No active point rule', 1;

        DECLARE @attendanceID BIGINT, @companionAttendanceID BIGINT, @companionAttendanceOwner NVARCHAR(50);

        SELECT TOP (1) @attendanceID = attendanceID
        FROM dbo.Attendance WITH (UPDLOCK, HOLDLOCK)
        WHERE eventID = @eventID
          AND CustomerID = @customerID
          AND participantType = @participantType
          AND status = N'checked_in'
        ORDER BY attendanceID DESC;

        IF @attendanceID IS NULL
        BEGIN
          INSERT dbo.Attendance (eventID, staffQrID, CustomerID, participantType, participantName, participantExternalID)
          VALUES (@eventID, @staffQrID, @customerID, @participantType, NULL, NULL);
          SET @attendanceID = SCOPE_IDENTITY();
        END;

        SELECT TOP (1)
          @companionAttendanceID = attendanceID,
          @companionAttendanceOwner = participantExternalID
        FROM dbo.Attendance WITH (UPDLOCK, HOLDLOCK)
        WHERE eventID = @eventID
          AND CustomerID = @companionCustomerID
          AND participantType = @participantType
          AND status = N'checked_in'
        ORDER BY attendanceID DESC;

        IF @companionAttendanceID IS NULL
        BEGIN
          INSERT dbo.Attendance (eventID, staffQrID, CustomerID, participantType, participantName, participantExternalID)
          VALUES (@eventID, @staffQrID, @companionCustomerID, @participantType, NULL, @customerID);
          SET @companionAttendanceID = SCOPE_IDENTITY();
        END
        ELSE IF @companionAttendanceOwner IS NULL
        BEGIN
          UPDATE dbo.Attendance
          SET participantExternalID = @customerID
          WHERE attendanceID = @companionAttendanceID;
        END
        ELSE IF @companionAttendanceOwner <> @customerID
        BEGIN
          THROW 51002, 'Companion already checked in with another dealer', 1;
        END;

        IF EXISTS (
          SELECT 1
          FROM dbo.ExpPointLedger WITH (UPDLOCK, HOLDLOCK)
          WHERE CustomerID = @customerID
            AND campaignID = @campaignID
            AND sourceType = N'${COMPANION_DIRECT_NEWCOMER_SOURCE}'
            AND sourceID = @sourceID
        )
        BEGIN
          COMMIT;
          SELECT
            CAST(1 AS bit) AS duplicate,
            @attendanceID AS attendanceID,
            @companionAttendanceID AS companionAttendanceID,
            @eventID AS eventID,
            @eventName AS eventName,
            0 AS expDelta,
            0 AS pointDelta,
            0 AS companionPointDelta,
            (SELECT expTotal FROM dbo.CustomerProgress WHERE CustomerID = @customerID AND campaignID = @campaignID) AS expTotal,
            (SELECT pointBalance FROM dbo.CustomerProgress WHERE CustomerID = @customerID AND campaignID = @campaignID) AS pointBalance;
          RETURN;
        END;

        INSERT dbo.ExpPointLedger (CustomerID, campaignID, expPointRuleID, eventID, sourceType, sourceID, expDelta, pointDelta, note)
        VALUES (
          @customerID,
          @campaignID,
          @ruleID,
          @eventID,
          N'${COMPANION_DIRECT_NEWCOMER_SOURCE}',
          @sourceID,
          @exp,
          @point,
          @eventName
        );

        IF EXISTS (SELECT 1 FROM dbo.CustomerProgress WHERE CustomerID = @customerID AND campaignID = @campaignID)
          UPDATE dbo.CustomerProgress
          SET
            expTotal = expTotal + @exp,
            pointBalance = pointBalance + @point,
            updatedAt = SYSDATETIMEOFFSET()
          WHERE CustomerID = @customerID AND campaignID = @campaignID;
        ELSE
          INSERT dbo.CustomerProgress (CustomerID, campaignID, expTotal, pointBalance)
          VALUES (@customerID, @campaignID, @exp, @point);

        DECLARE @newExp INT = (SELECT expTotal FROM dbo.CustomerProgress WHERE CustomerID = @customerID AND campaignID = @campaignID);
        DECLARE @levelNo INT = (
          SELECT TOP (1) levelNo
          FROM dbo.LevelRule
          WHERE isActive = 1 AND expRequired <= @newExp
          ORDER BY expRequired DESC
        );
        UPDATE dbo.CustomerProgress
        SET currentLevelNo = @levelNo, updatedAt = SYSDATETIMEOFFSET()
        WHERE CustomerID = @customerID AND campaignID = @campaignID;

        COMMIT;

        SELECT
          CAST(0 AS bit) AS duplicate,
          @attendanceID AS attendanceID,
          @companionAttendanceID AS companionAttendanceID,
          @eventID AS eventID,
          @eventName AS eventName,
          @exp AS expDelta,
          @point AS pointDelta,
          0 AS companionPointDelta,
          (SELECT expTotal FROM dbo.CustomerProgress WHERE CustomerID = @customerID AND campaignID = @campaignID) AS expTotal,
          (SELECT pointBalance FROM dbo.CustomerProgress WHERE CustomerID = @customerID AND campaignID = @campaignID) AS pointBalance;
      END TRY
      BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
      END CATCH;
    `);

  return { checkIn: result.recordset[0] };
}

async function staffCheckInContext(qrCode: string) {
  const pool = await getPool("teamup");
  const result = await pool
    .request()
    .input("qrCode", sql.NVarChar(200), qrCode)
    .query(`
      SELECT TOP (1)
        qr.staffQrID,
        qr.eventID,
        e.eventType,
        e.eventName,
        e.startAt
      FROM dbo.StaffQrCode qr
      JOIN dbo.[Event] e ON e.eventID = qr.eventID
      WHERE qr.qrCode = @qrCode
        AND qr.isActive = 1
        AND qr.expiresAt >= SYSDATETIMEOFFSET()
        AND e.isActive = 1
    `);
  const row = result.recordset[0];
  if (!row) throw new ApiError(400, "QR code 過期或失效。\n請洽工作人員。");
  const { campaign } = await assertOpenCampaignEvent(Number(row.eventID));
  return {
    staffQrID: Number(row.staffQrID),
    eventID: Number(row.eventID),
    eventType: String(row.eventType),
    eventName: String(row.eventName),
    startAt: row.startAt,
    campaignID: Number(campaign.id),
    campaignStartsOn: campaign.startsOn,
    campaignEndsOn: campaign.endsOn,
  };
}

async function directNewcomers(customerId: string, eventId: number) {
  if (!Number.isFinite(eventId)) throw new ApiError(400, "Missing eventId");
  const campaign = await openDealerCampaign(taipeiDateKey(new Date()));
  if (!campaign) throw new ApiError(400, "Activity check-in is not open");
  const event = await eventForNewcomerWindow(eventId, campaign.id);
  const [wm, teamup] = await Promise.all([getPool("wm"), getPool("teamup")]);
  const result = await wm
    .request()
    .input("customerID", sql.VarChar(50), customerId)
    .input("eventDate", sql.DateTimeOffset, new Date(event.startAt))
    .query(`
      SELECT CustomerID, FullName, TRY_CONVERT(date, JoinDate) AS joinDate
      FROM dbo.ViewCustCombine
      WHERE RecommendedID1 = @customerID
        AND TRY_CONVERT(date, JoinDate) >= DATEADD(month, -3, CONVERT(date, @eventDate))
        AND TRY_CONVERT(date, JoinDate) <= CONVERT(date, @eventDate)
      ORDER BY TRY_CONVERT(date, JoinDate) DESC, CustomerID ASC
    `);
  const [checkedIn, previousRewardEvents] = await Promise.all([
    teamup
      .request()
      .input("eventID", sql.BigInt, eventId)
      .query(`
        SELECT DISTINCT CustomerID
        FROM dbo.Attendance
        WHERE eventID = @eventID
          AND status = N'checked_in'
      `),
    teamup
      .request()
      .input("customerID", sql.NVarChar(50), customerId)
      .input("campaignID", sql.BigInt, campaign.id)
      .input("sourceType", sql.NVarChar(50), COMPANION_DIRECT_NEWCOMER_SOURCE)
      .input("sourcePrefix", sql.NVarChar(100), `${event.eventType}:`)
      .query(`
        SELECT
          SUBSTRING(ledger.sourceID, LEN(@sourcePrefix) + 1, 100) AS companionCustomerID,
          event.eventID,
          event.eventName,
          event.startAt
        FROM dbo.ExpPointLedger ledger
        JOIN dbo.[Event] event ON event.eventID = ledger.eventID
        WHERE ledger.CustomerID = @customerID
          AND ledger.campaignID = @campaignID
          AND ledger.sourceType = @sourceType
          AND LEFT(ledger.sourceID, LEN(@sourcePrefix)) = @sourcePrefix
        ORDER BY event.startAt DESC, ledger.ledgerID DESC
      `),
  ]);
  const checkedInCustomerIDs = new Set(
    checkedIn.recordset.map((row) => String(row.CustomerID)),
  );
  const rewardEventsByCustomerID = new Map<
    string,
    { eventId: number; eventName: string; startsAt: string }[]
  >();
  for (const row of previousRewardEvents.recordset) {
    const companionCustomerId = String(row.companionCustomerID || "");
    if (!companionCustomerId) continue;
    const events = rewardEventsByCustomerID.get(companionCustomerId) ?? [];
    events.push({
      eventId: Number(row.eventID),
      eventName: String(row.eventName),
      startsAt: date(row.startAt) || "",
    });
    rewardEventsByCustomerID.set(companionCustomerId, events);
  }

  return {
    newcomers: result.recordset.map((row) => ({
      customerId: String(row.CustomerID),
      name: row.FullName || row.CustomerID,
      joinDate: dateOnly(row.joinDate),
      checkedIn: checkedInCustomerIDs.has(String(row.CustomerID)),
      previousRewardEvents: rewardEventsByCustomerID.get(String(row.CustomerID)) ?? [],
    })),
  };
}

async function directNewcomer(customerId: string, companionCustomerId: string, eventStartAt: unknown) {
  const wm = await getPool("wm");
  const result = await wm
    .request()
    .input("customerID", sql.VarChar(50), customerId)
    .input("companionCustomerID", sql.VarChar(50), companionCustomerId)
    .input("eventDate", sql.DateTimeOffset, new Date(date(eventStartAt) || ""))
    .query(`
      SELECT TOP (1) CustomerID
      FROM dbo.ViewCustCombine
      WHERE RecommendedID1 = @customerID
        AND CustomerID = @companionCustomerID
        AND TRY_CONVERT(date, JoinDate) >= DATEADD(month, -3, CONVERT(date, @eventDate))
        AND TRY_CONVERT(date, JoinDate) <= CONVERT(date, @eventDate)
    `);
  return Boolean(result.recordset[0]);
}

async function eventForNewcomerWindow(eventId: number, campaignId: string) {
  const pool = await getPool("teamup");
  const result = await pool
    .request()
    .input("eventID", sql.BigInt, eventId)
    .input("campaignID", sql.BigInt, campaignId)
    .query("SELECT TOP (1) eventID, eventType, startAt FROM dbo.[Event] WHERE eventID = @eventID AND campaignID = @campaignID AND isActive = 1");
  const row = result.recordset[0];
  if (!row) throw new ApiError(404, "Event not found");
  return { eventID: Number(row.eventID), eventType: String(row.eventType), startAt: row.startAt };
}

async function syncCompanionDirectNewcomerCheckIn(
  eventId: number,
  currentCustomerId: string,
  campaignId: number,
) {
  const teamup = await getPool("teamup");
  const attendees = await teamup
    .request()
    .input("eventID", sql.BigInt, eventId)
    .query(`
      SELECT DISTINCT CustomerID
      FROM dbo.Attendance
      WHERE eventID = @eventID
        AND status = N'checked_in'
        AND participantType = N'dealer'
    `);

  const ids = attendees.recordset.map((row) => String(row.CustomerID)).filter(Boolean);
  if (ids.length < 2) return 0;

  const wm = await getPool("wm");
  const request = wm.request().input("currentCustomerID", sql.VarChar(50), currentCustomerId);
  const names = ids.map((id, index) => {
    request.input(`id${index}`, sql.VarChar(50), id);
    return `@id${index}`;
  });
  const relationships = await request.query(`
    SELECT RecommendedID1 AS referrerCustomerID, CustomerID AS newcomerCustomerID
    FROM dbo.ViewCustCombine
    WHERE RecommendedID1 IN (${names.join(",")})
      AND CustomerID IN (${names.join(",")})
      AND (RecommendedID1 = @currentCustomerID OR CustomerID = @currentCustomerID)
      AND TRY_CONVERT(date, JoinDate) >= DATEADD(m, -3, CONVERT(date, GETDATE()))
  `);

  let pointDelta = 0;
  for (const row of relationships.recordset) {
    const referrerCustomerId = String(row.referrerCustomerID);
    const newcomerCustomerId = String(row.newcomerCustomerID);
    const sourceId = `${eventId}:${newcomerCustomerId}`;

    const created = await insertCompanionDirectNewcomerBonus(
      eventId,
      referrerCustomerId,
      sourceId,
      campaignId,
    );
    if (referrerCustomerId === currentCustomerId) pointDelta += created;
  }
  return pointDelta;
}

async function insertCompanionDirectNewcomerBonus(
  eventId: number,
  referrerCustomerId: string,
  sourceId: string,
  campaignId: number,
) {
  const pool = await getPool("teamup");
  const result = await pool
    .request()
    .input("eventID", sql.BigInt, eventId)
    .input("campaignID", sql.BigInt, campaignId)
    .input("referrerCustomerID", sql.NVarChar(50), referrerCustomerId)
    .input("sourceID", sql.NVarChar(100), sourceId)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRY
        BEGIN TRAN;

        DECLARE @ruleID BIGINT, @exp INT, @point INT;
        SELECT TOP (1)
          @ruleID = expPointRuleID,
          @exp = expAmount,
          @point = pointAmount
        FROM dbo.ExpPointRule
        WHERE eventType = N'${COMPANION_DIRECT_NEWCOMER_RULE_TYPE}'
          AND participantType = N'dealer'
          AND isActive = 1
        ORDER BY expPointRuleID ASC;

        IF @ruleID IS NULL
        BEGIN
          COMMIT;
          SELECT CAST(0 AS bit) AS created, 0 AS pointDelta;
          RETURN;
        END;

        IF EXISTS (
          SELECT 1
          FROM dbo.ExpPointLedger WITH (UPDLOCK, HOLDLOCK)
          WHERE CustomerID = @referrerCustomerID
            AND campaignID = @campaignID
            AND sourceType = N'${COMPANION_DIRECT_NEWCOMER_SOURCE}'
            AND sourceID = @sourceID
        )
        BEGIN
          COMMIT;
          SELECT CAST(0 AS bit) AS created, 0 AS pointDelta;
          RETURN;
        END;

        INSERT dbo.ExpPointLedger (CustomerID, campaignID, expPointRuleID, eventID, sourceType, sourceID, expDelta, pointDelta, note)
        VALUES (
          @referrerCustomerID,
          @campaignID,
          @ruleID,
          @eventID,
          N'${COMPANION_DIRECT_NEWCOMER_SOURCE}',
          @sourceID,
          @exp,
          @point,
          N'同場三個月內直推新人'
        );

        IF EXISTS (SELECT 1 FROM dbo.CustomerProgress WHERE CustomerID = @referrerCustomerID AND campaignID = @campaignID)
          UPDATE dbo.CustomerProgress
          SET
            expTotal = expTotal + @exp,
            pointBalance = pointBalance + @point,
            updatedAt = SYSDATETIMEOFFSET()
          WHERE CustomerID = @referrerCustomerID AND campaignID = @campaignID;
        ELSE
          INSERT dbo.CustomerProgress (CustomerID, campaignID, expTotal, pointBalance)
          VALUES (@referrerCustomerID, @campaignID, @exp, @point);

        DECLARE @newExp INT = (SELECT expTotal FROM dbo.CustomerProgress WHERE CustomerID = @referrerCustomerID AND campaignID = @campaignID);
        DECLARE @levelNo INT = (
          SELECT TOP (1) levelNo
          FROM dbo.LevelRule
          WHERE isActive = 1 AND expRequired <= @newExp
          ORDER BY expRequired DESC
        );
        UPDATE dbo.CustomerProgress
        SET currentLevelNo = @levelNo, updatedAt = SYSDATETIMEOFFSET()
        WHERE CustomerID = @referrerCustomerID AND campaignID = @campaignID;

        COMMIT;
        SELECT CAST(1 AS bit) AS created, @point AS pointDelta;
      END TRY
      BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
      END CATCH;
    `);

  return result.recordset[0]?.created ? Number(result.recordset[0].pointDelta) : 0;
}

async function progress(customerId: string) {
  const campaign = await openDealerCampaign(taipeiDateKey(new Date()));
  if (campaign) await syncSpecialRewards(customerId, campaign);
  const pool = await getPool("teamup");
  const result = await pool
    .request()
    .input("customerID", sql.NVarChar(50), customerId)
    .input("campaignID", sql.BigInt, campaign?.id ?? null)
    .query(`
      SELECT p.CustomerID, ISNULL(p.expTotal, 0) AS expTotal, ISNULL(p.pointBalance, 0) AS pointBalance,
        p.currentLevelNo, l.levelName
      FROM dbo.CustomerProgress p
      LEFT JOIN dbo.LevelRule l ON l.levelNo = p.currentLevelNo
      WHERE p.CustomerID = @customerID AND p.campaignID = @campaignID
    `);
  const row = result.recordset[0];
  return {
    progress: {
      ...(row || {
        CustomerID: customerId,
        expTotal: 0,
        pointBalance: 0,
        currentLevelNo: 1,
        levelName: "分享入門",
      }),
      campaignId: campaign?.id ?? null,
    },
  };
}

async function ledger(customerId: string) {
  const pool = await getPool("teamup");
  const result = await pool
    .request()
    .input("customerID", sql.NVarChar(50), customerId)
    .query(`
      SELECT TOP (50) ledgerID, CustomerID, sourceType, sourceID, expDelta, pointDelta, note, createdAt
      FROM dbo.ExpPointLedger
      WHERE CustomerID = @customerID
      ORDER BY createdAt DESC, ledgerID DESC
    `);
  return { ledger: result.recordset.map((row) => ({ ...row, createdAt: date(row.createdAt) })) };
}

async function rewards(customerId: string) {
  const campaign = await openDealerCampaign(taipeiDateKey(new Date()));
  if (campaign) await syncSpecialRewards(customerId, campaign);
  const pool = await getPool("teamup");
  const result = await pool
    .request()
    .input("customerID", sql.NVarChar(50), customerId)
    .input("campaignID", sql.BigInt, campaign?.id ?? null)
    .query(`
      WITH Progress AS (
        SELECT
          @customerID AS CustomerID,
          ISNULL(p.expTotal, 0) AS expTotal,
          ISNULL(p.pointBalance, 0) AS pointBalance,
          ISNULL(p.currentLevelNo, 1) AS currentLevelNo
        FROM (SELECT 1 AS x) seed
        LEFT JOIN dbo.CustomerProgress p ON p.CustomerID = @customerID AND p.campaignID = @campaignID
      ),
      IssuedRewards AS (
        SELECT
          rr.rewardRuleID, rr.levelNo, rr.rewardName, rr.rewardQty, rr.rewardUnit,
          rr.pointCost, rr.rewardType, rr.issueMode, rr.sortOrder,
          p.expTotal, p.pointBalance, p.currentLevelNo,
          cr.customerRewardID, cr.giftCode, cr.status, cr.isGet,
          cr.SalesID, cr.gotAt, cr.issuedAt
        FROM dbo.CustomerReward cr
        JOIN dbo.RewardRule rr ON rr.rewardRuleID = cr.rewardRuleID
        CROSS JOIN Progress p
        WHERE cr.CustomerID = @customerID
          AND cr.campaignID = @campaignID
          AND cr.status <> N'voided'
      ),
      NormalRules AS (
        SELECT
          rr.rewardRuleID, rr.levelNo, rr.rewardName, rr.rewardQty, rr.rewardUnit,
          rr.pointCost, rr.rewardType, rr.issueMode, rr.sortOrder,
          p.expTotal, p.pointBalance, p.currentLevelNo,
          CAST(NULL AS BIGINT) AS customerRewardID,
          CAST(NULL AS NVARCHAR(100)) AS giftCode,
          CAST(NULL AS NVARCHAR(20)) AS status,
          CAST(NULL AS BIT) AS isGet,
          CAST(NULL AS NVARCHAR(50)) AS SalesID,
          CAST(NULL AS DATETIMEOFFSET(0)) AS gotAt,
          CAST(NULL AS DATETIMEOFFSET(0)) AS issuedAt
        FROM dbo.RewardRule rr
        CROSS JOIN Progress p
        WHERE rr.isActive = 1
          AND @campaignID IS NOT NULL
          AND rr.rewardType = N'normal'
          AND rr.issueMode = N'user_redeem'
          AND NOT EXISTS (
            SELECT 1
            FROM dbo.CustomerReward cr
            WHERE cr.CustomerID = @customerID
              AND cr.rewardRuleID = rr.rewardRuleID
              AND cr.campaignID = @campaignID
              AND cr.status <> N'voided'
          )
      )
      SELECT *
      FROM IssuedRewards
      UNION ALL
      SELECT *
      FROM NormalRules
      ORDER BY sortOrder ASC, rewardRuleID ASC, customerRewardID ASC
    `);

  return {
    rewards: result.recordset.map((row) => ({
      ...row,
      rewardRuleID: Number(row.rewardRuleID),
      status:
        row.status ||
        (row.currentLevelNo >= row.levelNo && row.pointBalance >= row.pointCost ? "available" : "locked"),
      SalesID: row.SalesID === DEV_CLAIM_SALES_ID ? null : row.SalesID,
      gotAt: date(row.gotAt),
      issuedAt: date(row.issuedAt),
    })),
  };
}

async function redeem(input: Record<string, unknown>) {
  const customerId = mustString(input.customerId);
  const rewardRuleId = Number(input.rewardRuleId);
  if (!Number.isFinite(rewardRuleId)) throw new ApiError(400, "Invalid rewardRuleId");
  const campaign = await openDealerCampaign(taipeiDateKey(new Date()));
  if (!campaign) throw new ApiError(400, "Reward unavailable");

  const newGiftCode = giftCode();
  const pool = await getPool("teamup");
  const result = await pool
    .request()
    .input("customerID", sql.NVarChar(50), customerId)
    .input("giftCode", sql.NVarChar(100), newGiftCode)
    .input("rewardRuleID", sql.BigInt, rewardRuleId)
    .input("campaignID", sql.BigInt, campaign.id)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRY
        BEGIN TRAN;

        DECLARE @levelNo INT, @name NVARCHAR(200), @qty INT, @unit NVARCHAR(20), @cost INT;
        SELECT
          @levelNo = levelNo,
          @name = rewardName,
          @qty = rewardQty,
          @unit = rewardUnit,
          @cost = pointCost
        FROM dbo.RewardRule
        WHERE rewardRuleID = @rewardRuleID
          AND rewardType = N'normal'
          AND issueMode = N'user_redeem'
          AND isActive = 1;

        IF @levelNo IS NULL THROW 52000, 'Reward unavailable', 1;
        IF EXISTS (
          SELECT 1 FROM dbo.CustomerReward WITH (UPDLOCK, HOLDLOCK)
          WHERE CustomerID = @customerID AND campaignID = @campaignID
            AND rewardRuleID = @rewardRuleID AND status <> N'voided'
        ) THROW 52001, 'Reward already issued', 1;

        DECLARE @currentLevelNo INT, @pointBalance INT;
        SELECT @currentLevelNo = ISNULL(currentLevelNo, 1), @pointBalance = pointBalance
        FROM dbo.CustomerProgress
        WHERE CustomerID = @customerID AND campaignID = @campaignID;

        IF @pointBalance IS NULL THROW 52002, 'No customer progress', 1;
        IF @currentLevelNo < @levelNo THROW 52003, 'Level too low', 1;
        IF @pointBalance < @cost THROW 52004, 'Point balance too low', 1;

        INSERT dbo.CustomerReward (
          CustomerID, campaignID, rewardRuleID, gift, rewardQty, rewardUnit, pointCost, giftCode, status, issueMode, redeemedAt
        )
        VALUES (@customerID, @campaignID, @rewardRuleID, @name, @qty, @unit, @cost, @giftCode, N'issue', N'user_redeem', SYSDATETIMEOFFSET());

        DECLARE @customerRewardID BIGINT = SCOPE_IDENTITY();

        INSERT dbo.ExpPointLedger (CustomerID, campaignID, sourceType, sourceID, expDelta, pointDelta, note)
        VALUES (@customerID, @campaignID, N'reward_redeem', CONVERT(NVARCHAR(100), @customerRewardID), 0, -@cost, @name);

        UPDATE dbo.CustomerProgress
        SET pointBalance = pointBalance - @cost, updatedAt = SYSDATETIMEOFFSET()
        WHERE CustomerID = @customerID AND campaignID = @campaignID;

        COMMIT;

        SELECT customerRewardID, CustomerID, rewardRuleID, gift, rewardQty, rewardUnit, pointCost, giftCode, status, isGet, issuedAt
        FROM dbo.CustomerReward
        WHERE customerRewardID = @customerRewardID;
      END TRY
      BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
      END CATCH;
    `);

  return { reward: result.recordset[0] };
}

async function claim(input: Record<string, unknown>) {
  const giftCode = mustString(input.giftCode);
  const inputSalesId = optionalString(input.salesId);
  const employeeId = mustString(input.employeeId);

  await assertEmployee(employeeId);

  if (REQUIRE_REWARD_CLAIM_SALES_ID && !inputSalesId) {
    throw new ApiError(400, "SalesID required");
  }
  if (inputSalesId) await assertSales(inputSalesId);

  // TeamUp.sql currently requires SalesID when status = got.
  // ponytail: dev placeholder keeps claim giftCode-only until real SalesID is available.
  const salesId = inputSalesId || DEV_CLAIM_SALES_ID;

  const pool = await getPool("teamup");
  const result = await pool
    .request()
    .input("giftCode", sql.NVarChar(100), giftCode)
    .input("salesID", sql.NVarChar(50), salesId)
    .input("employeeID", sql.NVarChar(50), employeeId)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRY
        BEGIN TRAN;

        DECLARE @customerRewardID BIGINT;
        SELECT TOP (1) @customerRewardID = customerRewardID
        FROM dbo.CustomerReward WITH (UPDLOCK, ROWLOCK)
        WHERE giftCode = @giftCode AND status = N'issue' AND isGet = 0;

        IF @customerRewardID IS NULL THROW 53000, 'Reward not claimable', 1;

        UPDATE dbo.CustomerReward
        SET status = N'got',
          isGet = 1,
          gotAt = SYSDATETIMEOFFSET(),
          SalesID = @salesID,
          gotByEmployeeID = @employeeID
        WHERE customerRewardID = @customerRewardID;

        COMMIT;

        SELECT customerRewardID, CustomerID, rewardRuleID, gift, rewardQty, rewardUnit, pointCost, giftCode,
          status, isGet, gotAt, SalesID, gotByEmployeeID
        FROM dbo.CustomerReward
        WHERE customerRewardID = @customerRewardID;
      END TRY
      BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
      END CATCH;
    `);

  const reward = result.recordset[0];
  return {
    reward: {
      ...reward,
      SalesID: reward.SalesID === DEV_CLAIM_SALES_ID ? null : reward.SalesID,
    },
  };
}

async function dealerRanking(customerId: string, period: "month" | "season") {
  const today = taipeiDateKey(new Date());
  const activeCampaign = await openDealerCampaign(today);
  if (!activeCampaign) {
    return { rows: [], profileSummary: { exp: 0, participation: 0, newcomers: 0 } };
  }
  const previous = period === "season"
    ? await previousCampaign(activeCampaign.startsOn)
    : null;
  const bands = rankingBands(period, today, activeCampaign, previous);
  const currentCampaignID = bands.current.campaignId;
  const previousCampaignID = bands.previous?.campaignId ?? null;

  const pool = await getPool("teamup");
  const [totalsResult, summaryResult] = await Promise.all([
    pool
      .request()
      .input("currentStartsOn", sql.Date, bands.current.startsOn)
      .input("currentEndsOn", sql.Date, bands.current.endsOn)
      .input("previousStartsOn", sql.Date, bands.previous?.startsOn ?? null)
      .input("previousEndsOn", sql.Date, bands.previous?.endsOn ?? null)
      .input("currentCampaignID", sql.BigInt, currentCampaignID)
      .input("previousCampaignID", sql.BigInt, previousCampaignID)
      .query(`
        SELECT ledger.CustomerID, SUM(ledger.expDelta) AS exp,
          MAX(CASE WHEN ledger.expDelta > 0 THEN ledger.createdAt END) AS reachedAt
        FROM dbo.ExpPointLedger ledger
        WHERE ledger.campaignID = @currentCampaignID
          AND CONVERT(date, SWITCHOFFSET(ledger.createdAt, '+08:00'))
            BETWEEN @currentStartsOn AND @currentEndsOn
        GROUP BY ledger.CustomerID;

        SELECT ledger.CustomerID, SUM(ledger.expDelta) AS exp,
          MAX(CASE WHEN ledger.expDelta > 0 THEN ledger.createdAt END) AS reachedAt
        FROM dbo.ExpPointLedger ledger
        WHERE @previousCampaignID IS NOT NULL
          AND ledger.campaignID = @previousCampaignID
          AND CONVERT(date, SWITCHOFFSET(ledger.createdAt, '+08:00'))
            BETWEEN @previousStartsOn AND @previousEndsOn
        GROUP BY ledger.CustomerID;
      `),
    pool
      .request()
      .input("customerID", sql.NVarChar(50), customerId)
      .input("currentCampaignID", sql.BigInt, currentCampaignID)
      .input("currentStartsOn", sql.Date, bands.current.startsOn)
      .input("currentEndsOn", sql.Date, bands.current.endsOn)
      .query(`
        SELECT
          (SELECT COUNT(DISTINCT attendance.eventID)
            FROM dbo.Attendance attendance
            JOIN dbo.[Event] event ON event.eventID = attendance.eventID
            WHERE attendance.CustomerID = @customerID
              AND attendance.status = N'checked_in'
              AND event.campaignID = @currentCampaignID
              AND CONVERT(date, SWITCHOFFSET(event.startAt, '+08:00'))
                BETWEEN @currentStartsOn AND @currentEndsOn) AS participation,
          (SELECT COUNT(DISTINCT attendance.CustomerID)
            FROM dbo.Attendance attendance
            JOIN dbo.[Event] event ON event.eventID = attendance.eventID
            WHERE attendance.participantExternalID = @customerID
              AND attendance.CustomerID <> @customerID
              AND attendance.status = N'checked_in'
              AND event.campaignID = @currentCampaignID
              AND CONVERT(date, SWITCHOFFSET(event.startAt, '+08:00'))
                BETWEEN @currentStartsOn AND @currentEndsOn) AS newcomers;
      `),
  ]);

  const totalRecordsets = totalsResult.recordsets as sql.IRecordSet<{
    CustomerID: string;
    exp: number;
    reachedAt: Date | null;
  }>[];
  // ponytail: rank aggregated dealers in memory; move the synthetic dealer row into SQL if volume grows.
  const rankedRows = selectDealerRankingRows(
    totalRecordsets[0].map((row) => ({
      customerId: String(row.CustomerID),
      exp: Number(row.exp),
      reachedAt: date(row.reachedAt),
    })),
    totalRecordsets[1].map((row) => ({
      customerId: String(row.CustomerID),
      exp: Number(row.exp),
      reachedAt: date(row.reachedAt),
    })),
    customerId,
  );
  const names = await customerNames(rankedRows.map((row) => row.customerId));
  const rows = rankedRows.map((row) => {
    const id = row.customerId;
    return {
      id,
      rank: row.rank,
      name: names[id] || id,
      exp: row.exp,
      trend: rankingTrend(row.rank, row.previousRank),
      isCurrent: id === customerId,
    };
  });
  const currentUserRow = rows.find((row) => row.isCurrent)!;
  const summaryRow = summaryResult.recordset[0];
  return {
    rows,
    profileSummary: {
      exp: currentUserRow.exp,
      participation: Number(summaryRow?.participation ?? 0),
      newcomers: Number(summaryRow?.newcomers ?? 0),
    },
  };
}

async function previousCampaign(startsOn: string) {
  const pool = await getPool("teamup");
  const result = await pool
    .request()
    .input("startsOn", sql.Date, startsOn)
    .query(`
      SELECT TOP (1) campaignID, name, startsOn, endsOn, isOpen
      FROM dbo.Campaign
      WHERE endsOn < @startsOn
      ORDER BY endsOn DESC, campaignID DESC
    `);
  return result.recordset[0] ? campaignDto(result.recordset[0]) : null;
}

async function leaderboard(currentCustomerId: string | null) {
  const campaign = await openDealerCampaign(taipeiDateKey(new Date()));
  if (!campaign) return [];
  const pool = await getPool("teamup");
  const result = await pool
    .request()
    .input("campaignID", sql.BigInt, campaign.id)
    .input("currentCustomerID", sql.NVarChar(50), currentCustomerId)
    .query(`
      WITH Totals AS (
        SELECT p.CustomerID, p.expTotal, p.pointBalance, p.currentLevelNo,
          MAX(CASE WHEN ledger.expDelta > 0 THEN ledger.createdAt END) AS reachedAt
        FROM dbo.CustomerProgress p
        LEFT JOIN dbo.ExpPointLedger ledger
          ON ledger.CustomerID = p.CustomerID AND ledger.campaignID = @campaignID
        WHERE p.campaignID = @campaignID
        GROUP BY p.CustomerID, p.expTotal, p.pointBalance, p.currentLevelNo
      ), Ranked AS (
        SELECT *, ROW_NUMBER() OVER (
          ORDER BY expTotal DESC, reachedAt ASC, CustomerID ASC
        ) AS rank
        FROM Totals
      )
      SELECT CustomerID, expTotal, pointBalance, currentLevelNo, reachedAt, rank
      FROM Ranked
      WHERE rank <= 50 OR CustomerID = @currentCustomerID
      ORDER BY rank ASC
    `);
  const names = await customerNames(result.recordset.map((row) => row.CustomerID));
  return result.recordset.map((row) => ({
    rank: Number(row.rank),
    customerId: row.CustomerID,
    name: names[row.CustomerID] || row.CustomerID,
    expTotal: row.expTotal,
    pointBalance: row.pointBalance,
    currentLevelNo: row.currentLevelNo,
  }));
}

async function syncSpecialRewards(customerId: string, campaign: Campaign) {
  const teamup = await getPool("teamup");
  const progressResult = await teamup
    .request()
    .input("customerID", sql.NVarChar(50), customerId)
    .input("campaignID", sql.BigInt, campaign.id)
    .query("SELECT currentLevelNo FROM dbo.CustomerProgress WHERE CustomerID = @customerID AND campaignID = @campaignID");
  const levelNo = Number(progressResult.recordset[0]?.currentLevelNo || 0);
  if (!levelNo) return;

  const wm = await getPool("wm");
  const joined = await wm
    .request()
    .input("customerID", sql.VarChar(50), customerId)
    .query(`
      SELECT CustomerID
      FROM dbo.ViewCustCombine
      WHERE RecommendedID1 = @customerID
        AND TRY_CONVERT(date, JoinDate) >= DATEADD(m, -3, CONVERT(date, GETDATE()))
    `);
  if (!joined.recordset.length) return;

  const rule = await teamup
    .request()
    .input("levelNo", sql.Int, levelNo)
    .query(`
      SELECT TOP (1) *
      FROM dbo.RewardRule
      WHERE rewardType = N'new_manager_special'
        AND issueMode = N'system_auto'
        AND isActive = 1
        AND levelNo <= @levelNo
      ORDER BY levelNo DESC
    `);
  const rewardRule = rule.recordset[0];
  if (!rewardRule) return;

  for (const row of joined.recordset) {
    await teamup
      .request()
      .input("customerID", sql.NVarChar(50), customerId)
      .input("campaignID", sql.BigInt, campaign.id)
      .input("rewardRuleID", sql.BigInt, rewardRule.rewardRuleID)
      .input("gift", sql.NVarChar(200), rewardRule.rewardName)
      .input("rewardQty", sql.Int, rewardRule.rewardQty)
      .input("rewardUnit", sql.NVarChar(20), rewardRule.rewardUnit)
      .input("pointCost", sql.Int, rewardRule.pointCost)
      .input("giftCode", sql.NVarChar(100), giftCode())
      .input("sourceID", sql.NVarChar(100), String(row.CustomerID))
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM dbo.CustomerReward
          WHERE CustomerID = @customerID AND campaignID = @campaignID
            AND sourceType = N'wm_member_join' AND sourceID = @sourceID
        )
        BEGIN
          INSERT dbo.CustomerReward (
            CustomerID, campaignID, rewardRuleID, gift, rewardQty, rewardUnit, pointCost, giftCode,
            status, issueMode, sourceType, sourceID
          )
          VALUES (
            @customerID, @campaignID, @rewardRuleID, @gift, @rewardQty, @rewardUnit, @pointCost, @giftCode,
            N'issue', N'system_auto', N'wm_member_join', @sourceID
          );
        END
        ELSE
        BEGIN
          UPDATE cr
          SET rewardRuleID = @rewardRuleID,
            gift = @gift,
            rewardQty = @rewardQty,
            rewardUnit = @rewardUnit,
            pointCost = @pointCost
          FROM dbo.CustomerReward cr
          JOIN dbo.RewardRule oldRule ON oldRule.rewardRuleID = cr.rewardRuleID
          WHERE cr.CustomerID = @customerID
            AND cr.campaignID = @campaignID
            AND cr.sourceType = N'wm_member_join'
            AND cr.sourceID = @sourceID
            AND cr.status = N'issue'
            AND cr.isGet = 0
            AND oldRule.levelNo < (SELECT levelNo FROM dbo.RewardRule WHERE rewardRuleID = @rewardRuleID);
        END
      `);
  }
}

export function giftCode() {
  return randomBytes(18).toString("hex").slice(0, 35);
}

function parseStaffCheckInInput(value: unknown) {
  const raw = mustString(value).trim();
  if (raw.startsWith("{")) {
    return parseQrPayload(raw, "staff_checkin") as { kind: "staff_checkin"; qrCode: string; eventId?: number };
  }

  try {
    const url = new URL(raw);
    const qrCode = url.searchParams.get("qrCode");
    if (qrCode) {
      const eventId = Number(url.searchParams.get("eventId"));
      return {
        kind: "staff_checkin" as const,
        qrCode,
        eventId: Number.isFinite(eventId) ? eventId : undefined,
      };
    }
  } catch {
    // Not a URL: treat it as the legacy raw QR token.
  }

  return { kind: "staff_checkin" as const, qrCode: raw };
}

function staffCheckInUrl(qrCode: string, eventId: string) {
  const params = new URLSearchParams({ qrCode, eventId });
  return `teamup://scan?${params.toString()}`;
}

async function assertEmployee(employeeId: string) {
  const wm = await getPool("wm");
  const result = await wm
    .request()
    .input("employeeID", sql.VarChar(50), employeeId)
    .query("SELECT TOP (1) EmployeeID FROM dbo.Employee WHERE EmployeeID = @employeeID");
  if (!result.recordset[0]) throw new ApiError(404, "EmployeeID not found in WM");
}

async function assertSales(salesId: string) {
  const wm = await getPool("wm");
  const result = await wm
    .request()
    .input("salesID", sql.VarChar(50), salesId)
    .query("SELECT TOP (1) SalesID FROM dbo.Sales WHERE SalesID = @salesID");
  if (!result.recordset[0]) throw new ApiError(404, "SalesID not found in WM");
}

async function customerNames(ids: string[]) {
  if (!ids.length) return {};
  const wm = await getPool("wm");
  const entries: [string, string][] = [];
  for (let offset = 0; offset < ids.length; offset += 500) {
    const batch = ids.slice(offset, offset + 500);
    const request = wm.request();
    const names = batch.map((id, index) => {
      request.input(`id${index}`, sql.VarChar(50), id);
      return `@id${index}`;
    });
    const result = await request.query(`
      SELECT CustomerID, FullName
      FROM dbo.ViewCustCombine
      WHERE CustomerID IN (${names.join(",")})
    `);
    entries.push(
      ...result.recordset.map(
        (row) => [String(row.CustomerID), String(row.FullName || "")] as [string, string],
      ),
    );
  }
  return Object.fromEntries(entries);
}

function token(prefix: string) {
  return `${prefix}-${randomBytes(5).toString("hex").toUpperCase()}`;
}

function mustString(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw new ApiError(400, "Missing string value");
  return value;
}

function requireRole(principal: AuthPrincipal, role: Role) {
  if (principal.role !== role) throw new AuthHttpError(403, "沒有操作權限");
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function date(value: unknown) {
  return value instanceof Date ? value.toISOString() : value == null ? null : String(value);
}

function dateOnly(value: unknown) {
  return (date(value) || "").slice(0, 10);
}

async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "Invalid JSON body");
  }
}

async function requestPrincipal(req: IncomingMessage): Promise<AuthPrincipal> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new AuthHttpError(401, "請先登入");
  return authenticateAccessToken(header.slice(7).trim());
}

function setCors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  if (data === null) return res.end();
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}
