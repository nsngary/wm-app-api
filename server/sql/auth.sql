SET NOCOUNT ON;
SET XACT_ABORT ON;

/*
 * TeamUp 自有登入帳號。
 *
 * 這張表只保存經過 scrypt 處理的 Salt 與 Hash，
 * 絕對不能加入 WM 的 NetPassword、Password 或其他明文密碼。
 */
IF OBJECT_ID(N'dbo.AuthAccount', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.AuthAccount (
    role NVARCHAR(10) NOT NULL,
    subjectID VARCHAR(50) NOT NULL,

    passwordAlgorithm VARCHAR(20) NOT NULL,
    passwordVersion SMALLINT NOT NULL,
    passwordSalt VARCHAR(64) NOT NULL,
    passwordHash VARCHAR(128) NOT NULL,

    scryptN INT NOT NULL,
    scryptR INT NOT NULL,
    scryptP INT NOT NULL,
    scryptKeyLength INT NOT NULL,

    /*
     * active：可以登入
     * disabled：帳號已停用
     */
    status NVARCHAR(20) NOT NULL
      CONSTRAINT DF_AuthAccount_status DEFAULT (N'active'),

    failedAttemptCount INT NOT NULL
      CONSTRAINT DF_AuthAccount_failedAttemptCount DEFAULT (0),

    /*
     * 累進登入失敗限制。
     * lockUntil 為 NULL 或早於現在時，才允許再次嘗試登入。
     */
    lockUntil DATETIMEOFFSET(0) NULL,

    /*
     * 從 WM 遷移的舊密碼若不符合新密碼規則，
     * 登入成功後可以要求使用者設定新密碼。
     */
    mustChangePassword BIT NOT NULL
      CONSTRAINT DF_AuthAccount_mustChangePassword DEFAULT (0),

    passwordMigratedAt DATETIMEOFFSET(0) NULL,
    passwordChangedAt DATETIMEOFFSET(0) NULL,

    createdAt DATETIMEOFFSET(0) NOT NULL
      CONSTRAINT DF_AuthAccount_createdAt DEFAULT (SYSDATETIMEOFFSET()),

    updatedAt DATETIMEOFFSET(0) NULL,

    CONSTRAINT PK_AuthAccount
      PRIMARY KEY (role, subjectID),

    CONSTRAINT CK_AuthAccount_role
      CHECK (role IN (N'dealer', N'staff')),

    CONSTRAINT CK_AuthAccount_status
      CHECK (status IN (N'active', N'disabled')),

    CONSTRAINT CK_AuthAccount_failedAttemptCount
      CHECK (failedAttemptCount >= 0),

    CONSTRAINT CK_AuthAccount_passwordVersion
      CHECK (passwordVersion > 0),

    CONSTRAINT CK_AuthAccount_scryptParameters
      CHECK (
        scryptN > 1
        AND scryptR > 0
        AND scryptP > 0
        AND scryptKeyLength >= 32
      )
  );
END;

/*
 * 登入契約只接受 accountId，且 WM 已確認員工與經銷商 ID 不重複。
 * 用唯一索引把這項產品前提固定在資料庫，避免 TOP (1) 選到錯誤角色。
 */
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'UX_AuthAccount_SubjectID'
    AND object_id = OBJECT_ID(N'dbo.AuthAccount')
)
  CREATE UNIQUE INDEX UX_AuthAccount_SubjectID
  ON dbo.AuthAccount(subjectID);

/*
 * 尚未遷移的 WM 帳號沒有 AuthAccount，必須另外保存失敗次數。
 * 本表只保存帳號 ID 與節流狀態，不保存角色、密碼或個人資料。
 */
IF OBJECT_ID(N'dbo.AuthLoginThrottle', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.AuthLoginThrottle (
    subjectID VARCHAR(50) NOT NULL CONSTRAINT PK_AuthLoginThrottle PRIMARY KEY,
    failedAttemptCount INT NOT NULL CONSTRAINT DF_AuthLoginThrottle_failedAttemptCount DEFAULT (0),
    lockUntil DATETIMEOFFSET(0) NULL,
    updatedAt DATETIMEOFFSET(0) NOT NULL CONSTRAINT DF_AuthLoginThrottle_updatedAt DEFAULT (SYSDATETIMEOFFSET()),
    CONSTRAINT CK_AuthLoginThrottle_failedAttemptCount CHECK (failedAttemptCount >= 0)
  );
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_AuthLoginThrottle_LockUntil'
    AND object_id = OBJECT_ID(N'dbo.AuthLoginThrottle')
)
  CREATE INDEX IX_AuthLoginThrottle_LockUntil
  ON dbo.AuthLoginThrottle(lockUntil, updatedAt);

/*
 * 一次性帳號啟用與重設密碼 Token。
 *
 * 帳號啟用 Token 可能在 AuthAccount 建立之前產生，
 * 因此這張表不直接對 AuthAccount 建立 Foreign Key。
 */
IF OBJECT_ID(N'dbo.AuthActivation', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.AuthActivation (
    activationID UNIQUEIDENTIFIER NOT NULL
      CONSTRAINT DF_AuthActivation_activationID DEFAULT (NEWID()),

    role NVARCHAR(10) NOT NULL,
    subjectID VARCHAR(50) NOT NULL,

    purpose NVARCHAR(20) NOT NULL,

    /*
     * 只保存 SHA-256 Token Hash。
     * 原始 Token 只能出現在發給使用者的一次性連結或驗證碼中。
     */
    tokenHash CHAR(64) NOT NULL,

    expiresAt DATETIMEOFFSET(0) NOT NULL,
    usedAt DATETIMEOFFSET(0) NULL,

    attemptCount INT NOT NULL
      CONSTRAINT DF_AuthActivation_attemptCount DEFAULT (0),

    createdAt DATETIMEOFFSET(0) NOT NULL
      CONSTRAINT DF_AuthActivation_createdAt DEFAULT (SYSDATETIMEOFFSET()),

    CONSTRAINT PK_AuthActivation
      PRIMARY KEY (activationID),

    CONSTRAINT CK_AuthActivation_role
      CHECK (role IN (N'dealer', N'staff')),

    CONSTRAINT CK_AuthActivation_purpose
      CHECK (purpose IN (N'activate', N'reset')),

    CONSTRAINT CK_AuthActivation_attemptCount
      CHECK (attemptCount >= 0)
  );
END;

/*
 * Token Hash 必須唯一，避免同一組啟用 Token 對應多筆資料。
 */
IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'UX_AuthActivation_TokenHash'
    AND object_id = OBJECT_ID(N'dbo.AuthActivation')
)
BEGIN
  CREATE UNIQUE INDEX UX_AuthActivation_TokenHash
    ON dbo.AuthActivation(tokenHash);
END;

/*
 * 用於清理過期或已使用的 Activation。
 */
IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'IX_AuthActivation_ExpiresAt'
    AND object_id = OBJECT_ID(N'dbo.AuthActivation')
)
BEGIN
  CREATE INDEX IX_AuthActivation_ExpiresAt
    ON dbo.AuthActivation(expiresAt, usedAt);
END;

/*
 * App 登入 Session。
 *
 * 一筆 Session 代表一個裝置上的登入生命週期，
 * 並保存目前有效的 Access Token Hash。
 */
IF OBJECT_ID(N'dbo.AuthSession', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.AuthSession (
    sessionID UNIQUEIDENTIFIER NOT NULL
      CONSTRAINT DF_AuthSession_sessionID DEFAULT (NEWID()),

    /*
     * Refresh Token 發生重放時，以 familyID 撤銷整個 Token Family。
     */
    familyID UNIQUEIDENTIFIER NOT NULL
      CONSTRAINT DF_AuthSession_familyID DEFAULT (NEWID()),

    role NVARCHAR(10) NOT NULL,
    subjectID VARCHAR(50) NOT NULL,

    /*
     * Access Token 原始值只回傳 App；
     * SQL Server 只保存 SHA-256 Hash。
     */
    accessTokenHash CHAR(64) NOT NULL,
    accessExpiresAt DATETIMEOFFSET(0) NOT NULL,

    /*
     * Refresh Token 可以輪替，但整個 Session 不可超過絕對期限。
     */
    absoluteExpiresAt DATETIMEOFFSET(0) NOT NULL,

    deviceLabel NVARCHAR(200) NULL,

    createdAt DATETIMEOFFSET(0) NOT NULL
      CONSTRAINT DF_AuthSession_createdAt DEFAULT (SYSDATETIMEOFFSET()),

    lastUsedAt DATETIMEOFFSET(0) NOT NULL
      CONSTRAINT DF_AuthSession_lastUsedAt DEFAULT (SYSDATETIMEOFFSET()),

    revokedAt DATETIMEOFFSET(0) NULL,
    revokeReason NVARCHAR(100) NULL,

    CONSTRAINT PK_AuthSession
      PRIMARY KEY (sessionID),

    /*
     * Session 必須隸屬已存在的 TeamUp AuthAccount。
     */
    CONSTRAINT FK_AuthSession_AuthAccount
      FOREIGN KEY (role, subjectID)
      REFERENCES dbo.AuthAccount(role, subjectID)
  );
END;

/*
 * Access Token Hash 必須唯一，避免 Token 對應多個 Session。
 */
IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'UX_AuthSession_AccessTokenHash'
    AND object_id = OBJECT_ID(N'dbo.AuthSession')
)
BEGIN
  CREATE UNIQUE INDEX UX_AuthSession_AccessTokenHash
    ON dbo.AuthSession(accessTokenHash);
END;

/*
 * 加速依帳號尋找有效 Session，以及密碼重設時撤銷全部 Session。
 */
IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'IX_AuthSession_Subject'
    AND object_id = OBJECT_ID(N'dbo.AuthSession')
)
BEGIN
  CREATE INDEX IX_AuthSession_Subject
    ON dbo.AuthSession(role, subjectID, revokedAt);
END;

/*
 * 加速清除已過期的 Access Token 與 Session。
 */
IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'IX_AuthSession_AccessExpiresAt'
    AND object_id = OBJECT_ID(N'dbo.AuthSession')
)
BEGIN
  CREATE INDEX IX_AuthSession_AccessExpiresAt
    ON dbo.AuthSession(accessExpiresAt, revokedAt);
END;

/*
 * Refresh Token 歷史。
 *
 * 舊 Refresh Token 不會被覆蓋或直接刪除，
 * 系統需要保留 usedAt，才能偵測 Token 重放攻擊。
 */
IF OBJECT_ID(N'dbo.AuthRefreshToken', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.AuthRefreshToken (
    refreshTokenID BIGINT IDENTITY(1, 1) NOT NULL,
    sessionID UNIQUEIDENTIFIER NOT NULL,

    /*
     * SQL Server 只保存 SHA-256 Token Hash。
     */
    tokenHash CHAR(64) NOT NULL,

    expiresAt DATETIMEOFFSET(0) NOT NULL,

    /*
     * Refresh 成功輪替時設定 usedAt。
     * 如果 usedAt 已存在卻再次收到同一 Token，即視為重放。
     */
    usedAt DATETIMEOFFSET(0) NULL,
    revokedAt DATETIMEOFFSET(0) NULL,

    /*
     * 指向輪替後的新 Refresh Token。
     */
    replacedByRefreshTokenID BIGINT NULL,

    createdAt DATETIMEOFFSET(0) NOT NULL
      CONSTRAINT DF_AuthRefreshToken_createdAt DEFAULT (SYSDATETIMEOFFSET()),

    CONSTRAINT PK_AuthRefreshToken
      PRIMARY KEY (refreshTokenID),

    CONSTRAINT FK_AuthRefreshToken_AuthSession
      FOREIGN KEY (sessionID)
      REFERENCES dbo.AuthSession(sessionID)
  );
END;

/*
 * Refresh Token Hash 必須唯一。
 */
IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'UX_AuthRefreshToken_TokenHash'
    AND object_id = OBJECT_ID(N'dbo.AuthRefreshToken')
)
BEGIN
  CREATE UNIQUE INDEX UX_AuthRefreshToken_TokenHash
    ON dbo.AuthRefreshToken(tokenHash);
END;

/*
 * 加速依 Session 查詢、撤銷與輪替 Refresh Token。
 */
IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'IX_AuthRefreshToken_Session'
    AND object_id = OBJECT_ID(N'dbo.AuthRefreshToken')
)
BEGIN
  CREATE INDEX IX_AuthRefreshToken_Session
    ON dbo.AuthRefreshToken(sessionID, revokedAt, usedAt);
END;

/*
 * 加速清理過期 Refresh Token。
 */
IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'IX_AuthRefreshToken_ExpiresAt'
    AND object_id = OBJECT_ID(N'dbo.AuthRefreshToken')
)
BEGIN
  CREATE INDEX IX_AuthRefreshToken_ExpiresAt
    ON dbo.AuthRefreshToken(expiresAt, revokedAt);
END;

/*
 * Refresh Token 的自我參照 Foreign Key 必須等資料表存在後才能加入。
 */
IF NOT EXISTS (
  SELECT 1
  FROM sys.foreign_keys
  WHERE name = N'FK_AuthRefreshToken_ReplacedBy'
    AND parent_object_id = OBJECT_ID(N'dbo.AuthRefreshToken')
)
BEGIN
  ALTER TABLE dbo.AuthRefreshToken WITH CHECK
  ADD CONSTRAINT FK_AuthRefreshToken_ReplacedBy
    FOREIGN KEY (replacedByRefreshTokenID)
    REFERENCES dbo.AuthRefreshToken(refreshTokenID);
END;
