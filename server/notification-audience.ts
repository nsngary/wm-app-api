import { getPool, sql } from "./db";
import { taipeiDateKey } from "./dealer-event-status";

type AudienceRow = {
  campaignID: number | string;
  campaignEndDate: Date | string;
  CustomerID: string | null;
};

export const REDEMPTION_AUDIENCE_SQL = `
  WITH OpenCampaign AS (
    SELECT TOP (1) campaignID, endsOn
    FROM dbo.Campaign
    WHERE isOpen = 1
      AND startsOn <= @today
      AND endsOn >= @today
    ORDER BY startsOn DESC, campaignID DESC
  )
  SELECT
    campaign.campaignID,
    campaign.endsOn AS campaignEndDate,
    p.CustomerID
  FROM OpenCampaign AS campaign
  LEFT JOIN dbo.CustomerProgress AS p
    ON p.campaignID = campaign.campaignID
   AND EXISTS (
      SELECT 1
      FROM dbo.RewardRule AS rr
      WHERE rr.isActive = 1
        AND rr.rewardType = N'normal'
        AND rr.issueMode = N'user_redeem'
        AND p.currentLevelNo >= rr.levelNo
        AND p.pointBalance >= rr.pointCost
        AND NOT EXISTS (
          SELECT 1
          FROM dbo.CustomerReward AS cr
          WHERE cr.CustomerID = p.CustomerID
            AND cr.campaignID = campaign.campaignID
            AND cr.rewardRuleID = rr.rewardRuleID
            AND cr.status <> N'voided'
        )
   )
  ORDER BY p.CustomerID;
`;

export async function redemptionNotificationAudience(now = new Date()) {
  const pool = await getPool("teamup");
  const result = await pool.request()
    .input("today", sql.Date, taipeiDateKey(now))
    .query(REDEMPTION_AUDIENCE_SQL);
  return mapRedemptionAudience(result.recordset as AudienceRow[]);
}

export function mapRedemptionAudience(rows: AudienceRow[]) {
  const first = rows[0];
  if (!first) return null;
  return {
    campaignID: Number(first.campaignID),
    campaignEndDate: dateOnly(first.campaignEndDate),
    dealerIDs: [...new Set(rows.flatMap((row) => row.CustomerID ? [String(row.CustomerID)] : []))],
  };
}

function dateOnly(value: Date | string) {
  return (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);
}
