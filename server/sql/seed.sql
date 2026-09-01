SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.Campaign', N'U') IS NULL
  CREATE TABLE dbo.Campaign (
    campaignID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Campaign PRIMARY KEY,
    name NVARCHAR(100) NOT NULL,
    startsOn DATE NOT NULL,
    endsOn DATE NOT NULL,
    isOpen BIT NOT NULL CONSTRAINT DF_Campaign_isOpen DEFAULT (0),
    createdAt DATETIMEOFFSET(0) NOT NULL CONSTRAINT DF_Campaign_createdAt DEFAULT (SYSDATETIMEOFFSET()),
    updatedAt DATETIMEOFFSET(0) NULL,
    CONSTRAINT CK_Campaign_DateRange CHECK (endsOn >= startsOn)
  );

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'UX_Campaign_OneOpen'
    AND object_id = OBJECT_ID(N'dbo.Campaign')
)
  CREATE UNIQUE INDEX UX_Campaign_OneOpen
  ON dbo.Campaign(isOpen)
  WHERE isOpen = 1;

IF OBJECT_ID(N'dbo.Activity', N'U') IS NULL
  CREATE TABLE dbo.Activity (
    eventType NVARCHAR(50) NOT NULL CONSTRAINT PK_Activity PRIMARY KEY,
    activityName NVARCHAR(200) NOT NULL,
    defaultPoint INT NOT NULL,
    isActive BIT NOT NULL CONSTRAINT DF_Activity_isActive DEFAULT (1),
    sortOrder INT NOT NULL,
    createdAt DATETIMEOFFSET(0) NOT NULL CONSTRAINT DF_Activity_createdAt DEFAULT (SYSDATETIMEOFFSET()),
    updatedAt DATETIMEOFFSET(0) NULL,
    CONSTRAINT CK_Activity_defaultPoint CHECK (defaultPoint >= 0)
  );

MERGE dbo.Activity AS target
USING (VALUES
  (N'elite', N'菁英研習營', 20, 10),
  (N'sha', N'SHA一日訓', 15, 20),
  (N'product_basic', N'產品初階訓課', 10, 30),
  (N'product_brief', N'產品說明會', 5, 40),
  (N'business_brief', N'事業說明會', 5, 50),
  (N'health_meeting', N'與健康有約', 5, 60),
  (N'business_meeting', N'與經營有約', 5, 70),
  (N'new_meeting', N'新經理見面會', 5, 80),
  (N'tea_time', N'下午茶', 5, 90),
  (N'young_meeting', N'青春同學會', 5, 100)
) AS source(eventType, activityName, defaultPoint, sortOrder)
ON target.eventType = source.eventType
WHEN MATCHED THEN
  UPDATE SET
    activityName = source.activityName,
    defaultPoint = source.defaultPoint,
    sortOrder = source.sortOrder,
    isActive = 1,
    updatedAt = SYSDATETIMEOFFSET()
WHEN NOT MATCHED THEN
  INSERT (eventType, activityName, defaultPoint, sortOrder)
  VALUES (source.eventType, source.activityName, source.defaultPoint, source.sortOrder);

IF NOT EXISTS (
  SELECT 1
  FROM sys.foreign_keys
  WHERE name = N'FK_Event_Activity'
    AND parent_object_id = OBJECT_ID(N'dbo.Event')
)
  ALTER TABLE dbo.[Event] WITH CHECK ADD CONSTRAINT FK_Event_Activity
  FOREIGN KEY (eventType) REFERENCES dbo.Activity(eventType);

IF COL_LENGTH(N'dbo.ExpPointLedger', N'eventID') IS NULL
  ALTER TABLE dbo.ExpPointLedger ADD eventID BIGINT NULL;

IF COL_LENGTH(N'dbo.Event', N'campaignID') IS NULL
  ALTER TABLE dbo.[Event] ADD campaignID BIGINT NULL;

IF COL_LENGTH(N'dbo.ExpPointLedger', N'campaignID') IS NULL
  ALTER TABLE dbo.ExpPointLedger ADD campaignID BIGINT NULL;

IF COL_LENGTH(N'dbo.CustomerProgress', N'campaignID') IS NULL
  ALTER TABLE dbo.CustomerProgress ADD campaignID BIGINT NULL;

IF COL_LENGTH(N'dbo.CustomerProgress', N'customerProgressID') IS NULL
BEGIN
  ALTER TABLE dbo.CustomerProgress DROP CONSTRAINT PK_CustomerProgress;
  ALTER TABLE dbo.CustomerProgress ADD customerProgressID BIGINT IDENTITY(1,1) NOT NULL;
  ALTER TABLE dbo.CustomerProgress ADD CONSTRAINT PK_CustomerProgress PRIMARY KEY (customerProgressID);
END;

IF COL_LENGTH(N'dbo.CustomerReward', N'campaignID') IS NULL
  ALTER TABLE dbo.CustomerReward ADD campaignID BIGINT NULL;

GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.foreign_keys
  WHERE name = N'FK_ExpPointLedger_Event'
    AND parent_object_id = OBJECT_ID(N'dbo.ExpPointLedger')
)
  ALTER TABLE dbo.ExpPointLedger WITH CHECK ADD CONSTRAINT FK_ExpPointLedger_Event
  FOREIGN KEY (eventID) REFERENCES dbo.[Event](eventID);

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_ExpPointLedger_Campaign')
  ALTER TABLE dbo.ExpPointLedger WITH CHECK ADD CONSTRAINT FK_ExpPointLedger_Campaign
  FOREIGN KEY (campaignID) REFERENCES dbo.Campaign(campaignID);

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Event_Campaign')
  ALTER TABLE dbo.[Event] WITH CHECK ADD CONSTRAINT FK_Event_Campaign
  FOREIGN KEY (campaignID) REFERENCES dbo.Campaign(campaignID);

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_CustomerProgress_Campaign')
  ALTER TABLE dbo.CustomerProgress WITH CHECK ADD CONSTRAINT FK_CustomerProgress_Campaign
  FOREIGN KEY (campaignID) REFERENCES dbo.Campaign(campaignID);

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_CustomerReward_Campaign')
  ALTER TABLE dbo.CustomerReward WITH CHECK ADD CONSTRAINT FK_CustomerReward_Campaign
  FOREIGN KEY (campaignID) REFERENCES dbo.Campaign(campaignID);

;WITH EventCampaign AS (
  SELECT event.eventID, MIN(campaign.campaignID) AS campaignID
  FROM dbo.[Event] event
  JOIN dbo.Campaign campaign
    ON CONVERT(date, SWITCHOFFSET(event.startAt, '+08:00'))
      BETWEEN campaign.startsOn AND campaign.endsOn
  WHERE event.campaignID IS NULL
  GROUP BY event.eventID
  HAVING COUNT(*) = 1
)
UPDATE event
SET campaignID = owner.campaignID
FROM dbo.[Event] event
JOIN EventCampaign owner ON owner.eventID = event.eventID;

UPDATE ledger
SET eventID = attendance.eventID
FROM dbo.ExpPointLedger ledger
JOIN dbo.Attendance attendance
  ON attendance.attendanceID = TRY_CONVERT(BIGINT, ledger.sourceID)
  AND attendance.CustomerID = ledger.CustomerID
WHERE ledger.eventID IS NULL
  AND ledger.sourceType = N'attendance';

;WITH LegacyCompanionCandidates AS (
  SELECT ledger.ledgerID, event.eventID
  FROM dbo.ExpPointLedger ledger
  CROSS APPLY (SELECT CHARINDEX(N':', ledger.sourceID) AS separator) parsed
  CROSS APPLY (
    SELECT
      TRY_CONVERT(BIGINT, LEFT(ledger.sourceID, NULLIF(parsed.separator, 0) - 1)) AS eventID,
      SUBSTRING(ledger.sourceID, parsed.separator + 1, 100) AS companionCustomerID
  ) source
  JOIN dbo.[Event] event ON event.eventID = source.eventID
  JOIN dbo.Attendance dealerAttendance
    ON dealerAttendance.eventID = event.eventID
    AND dealerAttendance.CustomerID = ledger.CustomerID
    AND dealerAttendance.status = N'checked_in'
  JOIN dbo.Attendance companionAttendance
    ON companionAttendance.eventID = event.eventID
    AND companionAttendance.CustomerID = source.companionCustomerID
    AND companionAttendance.status = N'checked_in'
  WHERE ledger.eventID IS NULL
    AND ledger.sourceType = N'companion_direct_newcomer'
    AND parsed.separator > 1
)
UPDATE ledger
SET eventID = candidate.eventID
FROM dbo.ExpPointLedger ledger
JOIN LegacyCompanionCandidates candidate ON candidate.ledgerID = ledger.ledgerID;

;WITH Rule2Candidates AS (
  SELECT ledger.ledgerID, event.eventID
  FROM dbo.ExpPointLedger ledger
  CROSS APPLY (SELECT CHARINDEX(N':', ledger.sourceID) AS separator) parsed
  CROSS APPLY (
    SELECT
      LEFT(ledger.sourceID, NULLIF(parsed.separator, 0) - 1) AS eventType,
      SUBSTRING(ledger.sourceID, parsed.separator + 1, 100) AS companionCustomerID
  ) source
  JOIN dbo.[Event] event ON event.eventType = source.eventType
  JOIN dbo.Attendance dealerAttendance
    ON dealerAttendance.eventID = event.eventID
    AND dealerAttendance.CustomerID = ledger.CustomerID
    AND dealerAttendance.status = N'checked_in'
  JOIN dbo.Attendance companionAttendance
    ON companionAttendance.eventID = event.eventID
    AND companionAttendance.CustomerID = source.companionCustomerID
    AND companionAttendance.status = N'checked_in'
  WHERE ledger.eventID IS NULL
    AND ledger.sourceType = N'companion_direct_newcomer'
    AND parsed.separator > 1
    AND dealerAttendance.checkedInAt BETWEEN DATEADD(minute, -1, ledger.createdAt) AND ledger.createdAt
    AND companionAttendance.checkedInAt BETWEEN DATEADD(minute, -1, ledger.createdAt) AND ledger.createdAt
), UniqueRule2Candidates AS (
  SELECT ledgerID, MIN(eventID) AS eventID
  FROM Rule2Candidates
  GROUP BY ledgerID
  HAVING COUNT(DISTINCT eventID) = 1
)
UPDATE ledger
SET eventID = candidate.eventID
FROM dbo.ExpPointLedger ledger
JOIN UniqueRule2Candidates candidate ON candidate.ledgerID = ledger.ledgerID;

UPDATE ledger
SET campaignID = event.campaignID
FROM dbo.ExpPointLedger ledger
JOIN dbo.[Event] event ON event.eventID = ledger.eventID
WHERE ledger.campaignID IS NULL
  AND event.campaignID IS NOT NULL;

UPDATE ledger
SET campaignID = campaign.campaignID
FROM dbo.ExpPointLedger ledger
JOIN dbo.Campaign campaign
  ON CONVERT(date, SWITCHOFFSET(ledger.createdAt, '+08:00')) BETWEEN campaign.startsOn AND campaign.endsOn
WHERE ledger.campaignID IS NULL;

UPDATE reward
SET campaignID = campaign.campaignID
FROM dbo.CustomerReward reward
JOIN dbo.Campaign campaign
  ON CONVERT(date, SWITCHOFFSET(reward.issuedAt, '+08:00')) BETWEEN campaign.startsOn AND campaign.endsOn
WHERE reward.campaignID IS NULL;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'IX_ExpPointLedger_CustomerEvent'
    AND object_id = OBJECT_ID(N'dbo.ExpPointLedger')
)
  CREATE INDEX IX_ExpPointLedger_CustomerEvent
  ON dbo.ExpPointLedger(CustomerID, eventID, createdAt DESC);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Event_CampaignStart' AND object_id = OBJECT_ID(N'dbo.Event'))
  CREATE INDEX IX_Event_CampaignStart
  ON dbo.[Event](campaignID, startAt);

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_ExpPointLedger_Source' AND object_id = OBJECT_ID(N'dbo.ExpPointLedger'))
  DROP INDEX UX_ExpPointLedger_Source ON dbo.ExpPointLedger;

CREATE UNIQUE INDEX UX_ExpPointLedger_Source
ON dbo.ExpPointLedger(CustomerID, campaignID, sourceType, sourceID)
WHERE campaignID IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ExpPointLedger_CustomerCampaign' AND object_id = OBJECT_ID(N'dbo.ExpPointLedger'))
  CREATE INDEX IX_ExpPointLedger_CustomerCampaign
  ON dbo.ExpPointLedger(CustomerID, campaignID, createdAt DESC);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_CustomerProgress_CustomerCampaign' AND object_id = OBJECT_ID(N'dbo.CustomerProgress'))
  CREATE UNIQUE INDEX UX_CustomerProgress_CustomerCampaign
  ON dbo.CustomerProgress(CustomerID, campaignID)
  WHERE campaignID IS NOT NULL;

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_CustomerReward_Source' AND object_id = OBJECT_ID(N'dbo.CustomerReward'))
  DROP INDEX UX_CustomerReward_Source ON dbo.CustomerReward;

CREATE UNIQUE INDEX UX_CustomerReward_Source
ON dbo.CustomerReward(CustomerID, campaignID, sourceType, sourceID)
WHERE campaignID IS NOT NULL AND sourceType IS NOT NULL AND sourceID IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_CustomerReward_CustomerCampaign' AND object_id = OBJECT_ID(N'dbo.CustomerReward'))
  CREATE INDEX IX_CustomerReward_CustomerCampaign
  ON dbo.CustomerReward(CustomerID, campaignID, status);

IF NOT EXISTS (SELECT 1 FROM dbo.LevelRule WHERE levelNo = 1)
  INSERT dbo.LevelRule (levelNo, levelName, expRequired) VALUES (1, N'分享入門', 0);
IF NOT EXISTS (SELECT 1 FROM dbo.LevelRule WHERE levelNo = 2)
  INSERT dbo.LevelRule (levelNo, levelName, expRequired) VALUES (2, N'分享玩家', 50);
IF NOT EXISTS (SELECT 1 FROM dbo.LevelRule WHERE levelNo = 3)
  INSERT dbo.LevelRule (levelNo, levelName, expRequired) VALUES (3, N'分享達人', 100);
IF NOT EXISTS (SELECT 1 FROM dbo.LevelRule WHERE levelNo = 4)
  INSERT dbo.LevelRule (levelNo, levelName, expRequired) VALUES (4, N'分享大使', 250);

IF EXISTS (
  SELECT 1
  FROM sys.check_constraints
  WHERE name = N'CK_ExpPointRule_eventType'
    AND parent_object_id = OBJECT_ID(N'dbo.ExpPointRule')
)
  ALTER TABLE dbo.ExpPointRule DROP CONSTRAINT CK_ExpPointRule_eventType;

ALTER TABLE dbo.ExpPointRule WITH CHECK ADD CONSTRAINT CK_ExpPointRule_eventType CHECK (eventType IN (
  N'elite',
  N'sha',
  N'product_basic',
  N'product_brief',
  N'business_brief',
  N'health_meeting',
  N'business_meeting',
  N'new_meeting',
  N'tea_time',
  N'young_meeting',
  N'direct_newcomer_companion'
));

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'IX_Attendance_EventCustomer'
    AND object_id = OBJECT_ID(N'dbo.Attendance')
)
  CREATE INDEX IX_Attendance_EventCustomer ON dbo.Attendance(eventID, status, CustomerID);

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'UX_Attendance_EventCustomer_CheckedIn'
    AND object_id = OBJECT_ID(N'dbo.Attendance')
)
  CREATE UNIQUE INDEX UX_Attendance_EventCustomer_CheckedIn
  ON dbo.Attendance(eventID, CustomerID, participantType)
  WHERE status = N'checked_in';

DECLARE @eventRules TABLE (eventType NVARCHAR(50), pointAmount INT);
INSERT @eventRules (eventType, pointAmount) VALUES
  (N'elite', 20),
  (N'sha', 15),
  (N'product_basic', 10),
  (N'product_brief', 5),
  (N'business_brief', 5),
  (N'health_meeting', 5),
  (N'business_meeting', 5),
  (N'new_meeting', 5),
  (N'tea_time', 5),
  (N'young_meeting', 5);

DECLARE @participants TABLE (participantType NVARCHAR(50));
INSERT @participants (participantType) VALUES (N'dealer');

INSERT dbo.ExpPointRule (eventType, participantType, ruleName, expAmount, pointAmount)
SELECT
  rules.eventType,
  participants.participantType,
  CONCAT(rules.eventType, N' ', participants.participantType),
  rules.pointAmount,
  rules.pointAmount
FROM @eventRules rules
CROSS JOIN @participants participants
WHERE NOT EXISTS (
  SELECT 1
  FROM dbo.ExpPointRule existing
  WHERE existing.eventType = rules.eventType
    AND existing.participantType = participants.participantType
);

UPDATE target
SET
  ruleName = CONCAT(rules.eventType, N' dealer'),
  expAmount = rules.pointAmount,
  pointAmount = rules.pointAmount,
  isActive = 1
FROM dbo.ExpPointRule target
JOIN @eventRules rules ON rules.eventType = target.eventType
WHERE target.participantType = N'dealer';

UPDATE dbo.ExpPointRule
SET isActive = 0
WHERE participantType IN (N'new_friend', N'direct_manager');

IF EXISTS (
  SELECT 1
  FROM dbo.ExpPointRule
  WHERE eventType = N'direct_newcomer_companion'
    AND participantType = N'dealer'
)
  UPDATE dbo.ExpPointRule
  SET ruleName = N'同場三個月內直推新人',
    expAmount = 5,
    pointAmount = 5,
    isActive = 1
  WHERE eventType = N'direct_newcomer_companion'
    AND participantType = N'dealer';
ELSE
  INSERT dbo.ExpPointRule (eventType, participantType, ruleName, expAmount, pointAmount)
  VALUES (N'direct_newcomer_companion', N'dealer', N'同場三個月內直推新人', 5, 5);

DECLARE @rewards TABLE (
  levelNo INT,
  rewardName NVARCHAR(200),
  rewardQty INT,
  rewardUnit NVARCHAR(20),
  pointCost INT,
  rewardType NVARCHAR(50),
  issueMode NVARCHAR(50),
  sortOrder INT
);
INSERT @rewards VALUES
  (1, N'萬用清潔劑', 1, N'份', 10, N'normal', N'user_redeem', 10),
  (1, N'商品兌換券 $500', 1, N'張', 20, N'normal', N'user_redeem', 20),
  (1, N'菁英研習營優惠券 $500', 1, N'張', 20, N'normal', N'user_redeem', 30),
  (2, N'萬用沐浴精', 1, N'份', 10, N'normal', N'user_redeem', 40),
  (2, N'商品兌換券 $1000', 1, N'張', 20, N'normal', N'user_redeem', 50),
  (2, N'菁英研習營優惠券 $500', 1, N'張', 20, N'normal', N'user_redeem', 60),
  (2, N'每推薦一位新經理 送裸包', 3, N'包', 0, N'new_manager_special', N'system_auto', 70),
  (3, N'洗髮精+沐浴精', 1, N'份', 15, N'normal', N'user_redeem', 80),
  (3, N'菁英研習營優惠券 $500', 1, N'張', 20, N'normal', N'user_redeem', 90),
  (3, N'菁英旅遊獎金 $10000', 1, N'元', 100, N'normal', N'user_redeem', 100),
  (3, N'每推薦一位新經理 送裸包', 5, N'包', 0, N'new_manager_special', N'system_auto', 110),
  (4, N'清潔系列組合', 1, N'份', 25, N'normal', N'user_redeem', 120),
  (4, N'菁英研習營優惠券 $500', 1, N'張', 20, N'normal', N'user_redeem', 130),
  (4, N'菁英旅遊獎金 $15000', 1, N'元', 150, N'normal', N'user_redeem', 140),
  (4, N'每推薦一位新經理 送裸包', 7, N'包', 0, N'new_manager_special', N'system_auto', 150);

INSERT dbo.RewardRule (
  levelNo,
  rewardName,
  rewardQty,
  rewardUnit,
  pointCost,
  rewardType,
  issueMode,
  sortOrder
)
SELECT
  levelNo,
  rewardName,
  rewardQty,
  rewardUnit,
  pointCost,
  rewardType,
  issueMode,
  sortOrder
FROM @rewards source
WHERE NOT EXISTS (
  SELECT 1
  FROM dbo.RewardRule target
  WHERE target.levelNo = source.levelNo
    AND target.rewardName = source.rewardName
    AND target.rewardType = source.rewardType
    AND target.issueMode = source.issueMode
);

UPDATE target
SET rewardQty = source.rewardQty
FROM dbo.RewardRule target
JOIN @rewards source ON source.levelNo = target.levelNo
  AND source.rewardName = target.rewardName
  AND source.rewardType = target.rewardType
  AND source.issueMode = target.issueMode
WHERE target.rewardType = N'new_manager_special';
