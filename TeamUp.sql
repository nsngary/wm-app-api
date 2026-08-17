CREATE DATABASE TeamUp;
GO

USE TeamUp;
GO

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

CREATE UNIQUE INDEX UX_Campaign_OneOpen ON dbo.Campaign(isOpen) WHERE isOpen = 1;

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

CREATE TABLE dbo.[Event] (
  eventID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Event PRIMARY KEY,
  campaignID BIGINT NULL,
  eventType NVARCHAR(50) NOT NULL,
  eventName NVARCHAR(200) NOT NULL,
  startAt DATETIMEOFFSET(0) NOT NULL,
  endAt DATETIMEOFFSET(0) NULL,
  location NVARCHAR(200) NULL,
  description NVARCHAR(1000) NULL,
  isActive BIT NOT NULL CONSTRAINT DF_Event_isActive DEFAULT (1),
  createdAt DATETIMEOFFSET(0) NOT NULL CONSTRAINT DF_Event_createdAt DEFAULT (SYSDATETIMEOFFSET()),
  updatedAt DATETIMEOFFSET(0) NULL,
  CONSTRAINT CK_Event_eventType CHECK (eventType IN (
    N'elite',
    N'sha',
    N'product_basic',
    N'product_brief',
    N'business_brief',
    N'health_meeting',
    N'business_meeting',
    N'new_meeting',
    N'tea_time',
    N'young_meeting'
  )),
  CONSTRAINT FK_Event_Activity FOREIGN KEY (eventType) REFERENCES dbo.Activity(eventType),
  CONSTRAINT FK_Event_Campaign FOREIGN KEY (campaignID) REFERENCES dbo.Campaign(campaignID)
);

CREATE TABLE dbo.LevelRule (
  levelNo INT NOT NULL CONSTRAINT PK_LevelRule PRIMARY KEY,
  levelName NVARCHAR(100) NOT NULL,
  expRequired INT NOT NULL,
  isActive BIT NOT NULL CONSTRAINT DF_LevelRule_isActive DEFAULT (1),
  createdAt DATETIMEOFFSET(0) NOT NULL CONSTRAINT DF_LevelRule_createdAt DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT CK_LevelRule_expRequired CHECK (expRequired >= 0)
);

CREATE TABLE dbo.ExpPointRule (
  expPointRuleID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ExpPointRule PRIMARY KEY,
  eventType NVARCHAR(50) NOT NULL,
  participantType NVARCHAR(50) NOT NULL,
  ruleName NVARCHAR(200) NOT NULL,
  expAmount INT NOT NULL,
  pointAmount INT NOT NULL,
  isActive BIT NOT NULL CONSTRAINT DF_ExpPointRule_isActive DEFAULT (1),
  createdAt DATETIMEOFFSET(0) NOT NULL CONSTRAINT DF_ExpPointRule_createdAt DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT CK_ExpPointRule_eventType CHECK (eventType IN (
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
  )),
  CONSTRAINT CK_ExpPointRule_amount CHECK (expAmount >= 0 AND pointAmount >= 0)
);

CREATE TABLE dbo.StaffQrCode (
  staffQrID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_StaffQrCode PRIMARY KEY,
  eventID BIGINT NOT NULL,
  EmployeeID NVARCHAR(50) NOT NULL,
  qrCode NVARCHAR(200) NOT NULL,
  generatedAt DATETIMEOFFSET(0) NOT NULL CONSTRAINT DF_StaffQrCode_generatedAt DEFAULT (SYSDATETIMEOFFSET()),
  expiresAt DATETIMEOFFSET(0) NOT NULL,
  isActive BIT NOT NULL CONSTRAINT DF_StaffQrCode_isActive DEFAULT (1),
  revokedAt DATETIMEOFFSET(0) NULL,
  CONSTRAINT FK_StaffQrCode_Event FOREIGN KEY (eventID) REFERENCES dbo.[Event](eventID),
  CONSTRAINT UQ_StaffQrCode_qrCode UNIQUE (qrCode)
);

CREATE TABLE dbo.Attendance (
  attendanceID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Attendance PRIMARY KEY,
  eventID BIGINT NOT NULL,
  staffQrID BIGINT NOT NULL,
  CustomerID NVARCHAR(50) NOT NULL,
  participantType NVARCHAR(50) NOT NULL,
  participantName NVARCHAR(100) NULL,
  participantExternalID NVARCHAR(50) NULL,
  checkedInAt DATETIMEOFFSET(0) NOT NULL CONSTRAINT DF_Attendance_checkedInAt DEFAULT (SYSDATETIMEOFFSET()),
  status NVARCHAR(20) NOT NULL CONSTRAINT DF_Attendance_status DEFAULT (N'checked_in'),
  voidedAt DATETIMEOFFSET(0) NULL,
  voidReason NVARCHAR(500) NULL,
  createdAt DATETIMEOFFSET(0) NOT NULL CONSTRAINT DF_Attendance_createdAt DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT FK_Attendance_Event FOREIGN KEY (eventID) REFERENCES dbo.[Event](eventID),
  CONSTRAINT FK_Attendance_StaffQrCode FOREIGN KEY (staffQrID) REFERENCES dbo.StaffQrCode(staffQrID),
  CONSTRAINT CK_Attendance_status CHECK (status IN (N'checked_in', N'voided'))
);

CREATE TABLE dbo.ExpPointLedger (
  ledgerID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ExpPointLedger PRIMARY KEY,
  CustomerID NVARCHAR(50) NOT NULL,
  campaignID BIGINT NULL,
  expPointRuleID BIGINT NULL,
  eventID BIGINT NULL,
  sourceType NVARCHAR(50) NOT NULL,
  sourceID NVARCHAR(100) NOT NULL,
  expDelta INT NOT NULL CONSTRAINT DF_ExpPointLedger_expDelta DEFAULT (0),
  pointDelta INT NOT NULL CONSTRAINT DF_ExpPointLedger_pointDelta DEFAULT (0),
  note NVARCHAR(500) NULL,
  createdAt DATETIMEOFFSET(0) NOT NULL CONSTRAINT DF_ExpPointLedger_createdAt DEFAULT (SYSDATETIMEOFFSET()),
  createdByEmployeeID NVARCHAR(50) NULL,
  CONSTRAINT FK_ExpPointLedger_ExpPointRule FOREIGN KEY (expPointRuleID) REFERENCES dbo.ExpPointRule(expPointRuleID),
  CONSTRAINT FK_ExpPointLedger_Event FOREIGN KEY (eventID) REFERENCES dbo.[Event](eventID),
  CONSTRAINT FK_ExpPointLedger_Campaign FOREIGN KEY (campaignID) REFERENCES dbo.Campaign(campaignID),
  CONSTRAINT CK_ExpPointLedger_delta CHECK (expDelta <> 0 OR pointDelta <> 0)
);

CREATE TABLE dbo.CustomerProgress (
  customerProgressID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CustomerProgress PRIMARY KEY,
  CustomerID NVARCHAR(50) NOT NULL,
  campaignID BIGINT NULL,
  expTotal INT NOT NULL CONSTRAINT DF_CustomerProgress_expTotal DEFAULT (0),
  pointBalance INT NOT NULL CONSTRAINT DF_CustomerProgress_pointBalance DEFAULT (0),
  currentLevelNo INT NULL,
  createdAt DATETIMEOFFSET(0) NOT NULL CONSTRAINT DF_CustomerProgress_createdAt DEFAULT (SYSDATETIMEOFFSET()),
  updatedAt DATETIMEOFFSET(0) NOT NULL CONSTRAINT DF_CustomerProgress_updatedAt DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT FK_CustomerProgress_LevelRule FOREIGN KEY (currentLevelNo) REFERENCES dbo.LevelRule(levelNo),
  CONSTRAINT FK_CustomerProgress_Campaign FOREIGN KEY (campaignID) REFERENCES dbo.Campaign(campaignID),
  CONSTRAINT CK_CustomerProgress_amount CHECK (expTotal >= 0 AND pointBalance >= 0)
);

CREATE TABLE dbo.RewardRule (
  rewardRuleID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_RewardRule PRIMARY KEY,
  levelNo INT NOT NULL,
  rewardName NVARCHAR(200) NOT NULL,
  rewardQty INT NOT NULL,
  rewardUnit NVARCHAR(20) NOT NULL,
  pointCost INT NOT NULL CONSTRAINT DF_RewardRule_pointCost DEFAULT (0),
  rewardType NVARCHAR(50) NOT NULL,
  issueMode NVARCHAR(50) NOT NULL,
  sortOrder INT NOT NULL CONSTRAINT DF_RewardRule_sortOrder DEFAULT (0),
  isActive BIT NOT NULL CONSTRAINT DF_RewardRule_isActive DEFAULT (1),
  createdAt DATETIMEOFFSET(0) NOT NULL CONSTRAINT DF_RewardRule_createdAt DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT FK_RewardRule_LevelRule FOREIGN KEY (levelNo) REFERENCES dbo.LevelRule(levelNo),
  CONSTRAINT CK_RewardRule_qty CHECK (rewardQty > 0),
  CONSTRAINT CK_RewardRule_pointCost CHECK (pointCost >= 0),
  CONSTRAINT CK_RewardRule_rewardType CHECK (rewardType IN (N'normal', N'new_manager_special')),
  CONSTRAINT CK_RewardRule_issueMode CHECK (issueMode IN (N'user_redeem', N'system_auto'))
);

CREATE TABLE dbo.CustomerReward (
  customerRewardID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CustomerReward PRIMARY KEY,
  CustomerID NVARCHAR(50) NOT NULL,
  campaignID BIGINT NULL,
  rewardRuleID BIGINT NOT NULL,
  gift NVARCHAR(200) NOT NULL,
  rewardQty INT NOT NULL,
  rewardUnit NVARCHAR(20) NOT NULL,
  pointCost INT NOT NULL CONSTRAINT DF_CustomerReward_pointCost DEFAULT (0),
  giftCode NVARCHAR(100) NOT NULL,
  status NVARCHAR(20) NOT NULL CONSTRAINT DF_CustomerReward_status DEFAULT (N'issue'),
  issueMode NVARCHAR(50) NOT NULL,
  sourceType NVARCHAR(50) NULL,
  sourceID NVARCHAR(100) NULL,
  redeemedAt DATETIMEOFFSET(0) NULL,
  issuedAt DATETIMEOFFSET(0) NOT NULL CONSTRAINT DF_CustomerReward_issuedAt DEFAULT (SYSDATETIMEOFFSET()),
  isGet BIT NOT NULL CONSTRAINT DF_CustomerReward_isGet DEFAULT (0),
  gotAt DATETIMEOFFSET(0) NULL,
  SalesID NVARCHAR(50) NULL,
  gotByEmployeeID NVARCHAR(50) NULL,
  voidedAt DATETIMEOFFSET(0) NULL,
  voidReason NVARCHAR(500) NULL,
  createdAt DATETIMEOFFSET(0) NOT NULL CONSTRAINT DF_CustomerReward_createdAt DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT FK_CustomerReward_RewardRule FOREIGN KEY (rewardRuleID) REFERENCES dbo.RewardRule(rewardRuleID),
  CONSTRAINT FK_CustomerReward_Campaign FOREIGN KEY (campaignID) REFERENCES dbo.Campaign(campaignID),
  CONSTRAINT UQ_CustomerReward_giftCode UNIQUE (giftCode),
  CONSTRAINT CK_CustomerReward_status CHECK (status IN (N'issue', N'got', N'voided')),
  CONSTRAINT CK_CustomerReward_issueMode CHECK (issueMode IN (N'user_redeem', N'system_auto')),
  CONSTRAINT CK_CustomerReward_sourcePair CHECK (
    (sourceType IS NULL AND sourceID IS NULL)
    OR
    (sourceType IS NOT NULL AND sourceID IS NOT NULL)
  ),
  CONSTRAINT CK_CustomerReward_isGet CHECK (
    (status = N'got' AND isGet = 1 AND gotAt IS NOT NULL AND SalesID IS NOT NULL)
    OR
    (status <> N'got' AND isGet = 0)
  )
);

CREATE INDEX IX_Attendance_Customer ON dbo.Attendance(CustomerID, checkedInAt DESC);
CREATE INDEX IX_Event_CampaignStart ON dbo.[Event](campaignID, startAt);
CREATE INDEX IX_Attendance_EventCustomer ON dbo.Attendance(eventID, status, CustomerID);
CREATE UNIQUE INDEX UX_Attendance_EventCustomer_CheckedIn
ON dbo.Attendance(eventID, CustomerID, participantType)
WHERE status = N'checked_in';
CREATE INDEX IX_ExpPointLedger_Customer ON dbo.ExpPointLedger(CustomerID, createdAt DESC);
CREATE INDEX IX_ExpPointLedger_CustomerEvent ON dbo.ExpPointLedger(CustomerID, eventID, createdAt DESC);
CREATE INDEX IX_ExpPointLedger_CustomerCampaign ON dbo.ExpPointLedger(CustomerID, campaignID, createdAt DESC);
CREATE UNIQUE INDEX UX_ExpPointLedger_Source ON dbo.ExpPointLedger(CustomerID, campaignID, sourceType, sourceID)
WHERE campaignID IS NOT NULL;
CREATE UNIQUE INDEX UX_CustomerProgress_CustomerCampaign ON dbo.CustomerProgress(CustomerID, campaignID)
WHERE campaignID IS NOT NULL;
CREATE INDEX IX_CustomerReward_Customer ON dbo.CustomerReward(CustomerID, status);
CREATE INDEX IX_CustomerReward_CustomerCampaign ON dbo.CustomerReward(CustomerID, campaignID, status);
CREATE UNIQUE INDEX UX_CustomerReward_Source ON dbo.CustomerReward(CustomerID, campaignID, sourceType, sourceID)
WHERE campaignID IS NOT NULL AND sourceType IS NOT NULL AND sourceID IS NOT NULL;
GO
