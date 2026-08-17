import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";
import { defaultLocationForBusinessUnit } from "./activity-catalog";
import { getPool, sql } from "./db";

/**
 * scrypt 雜湊參數。
 *
 * 參數必須與密碼資料一起版本化保存，未來若提高安全強度，
 * 才能識別舊資料並在使用者登入成功後重新雜湊。
 */
const SCRYPT_PARAMS = {
  N: 32768,
  r: 8,
  p: 1,
  keyLength: 64,
} as const;

/**
 * maxmem 是 scrypt 執行時可使用的記憶體上限。
 * 必須高於目前 N、r、p 所需的記憶體，否則 Node 會拒絕執行。
 */
const SCRYPT_OPTIONS: ScryptOptions = {
  N: SCRYPT_PARAMS.N,
  r: SCRYPT_PARAMS.r,
  p: SCRYPT_PARAMS.p,
  maxmem: 64 * 1024 * 1024,
};

/**
 * 防止攻擊者傳入異常巨大的密碼字串，
 * 消耗 API Server 過多記憶體與 CPU。
 *
 * 這不是產品密碼長度規則；新密碼的 15 字元規則
 * 會在帳號啟用與重設密碼流程中檢查。
 */
const MAX_PASSWORD_BYTES = 1024;

export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export type PasswordHash = {
  algorithm: "scrypt";
  version: 1;

  // Salt 與 Hash 使用 Base64URL，方便保存至 SQL Server 字串欄位。
  salt: string;
  hash: string;

  // 保存實際使用的參數，方便未來升級雜湊強度。
  params: typeof SCRYPT_PARAMS;
};

export type AuthRole = "dealer" | "staff";

type WmIdentity = {
  id: string;
  name: string;
  role: AuthRole;
  memberId: string;
  businessUnitId?: string;
  defaultLocation?: string;
  office?: string;
};

export type AuthenticatedIdentity = WmIdentity & {
  // 舊 WM 密碼過短時，只能進入修改密碼所需的受限 Session。
  mustChangePassword: boolean;
};

type StoredAuthAccount = {
  role: AuthRole;
  subjectId: string;
  status: "active" | "disabled";
  lockUntil: Date | null;
  mustChangePassword: boolean;
  password: PasswordHash;
};

type LegacyIdentity = WmIdentity & {
  // 此值只允許短暫存在 Server 記憶體，不可回傳、保存或寫入 Log。
  legacyPassword: string;
};

type LegacyLoginThrottle = { lockUntil: Date | null };

export type AuthPrincipal = {
  sessionId: string;
  role: AuthRole;
  subjectId: string;
  mustChangePassword: boolean;
};

export type SessionTokens = {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
};

export class AuthHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const INVALID_LOGIN_MESSAGE = "帳號或密碼錯誤";

// -------------------------------------------------------------------------------------- //
// -------------------------------------------------------------------------------------- //
// -------------------------------------------------------------------------------------- //

/**
 * 明文密碼比較：比較 App 輸入的密碼，與 WM 舊明文密碼。
 * 
 * 先把兩邊轉成固定長度的 SHA-256 結果，再用 timingSafeEqual 比較，避免直接使用字串 === 所產生的時間差。
 * SAH-256 在這裡只用於記憶體內比較，不是密碼保存格式；真正寫入 TeamUp 的密碼仍使用 scrypt。
 */
export function matchesLegacyPassword(
    inputPassword: string,
    wmPassword: string,
): boolean {
    if (!inputPassword || !wmPassword) return false;

    const inputDigest = createHash("sha256")
        .update(inputPassword, "utf8")
        .digest();
    
    const wmDigest = createHash("sha256")
        .update(wmPassword, "utf8")
        .digest();
    return timingSafeEqual(inputDigest, wmDigest);
}

// -------------------------------------------------------------------------------------- //
// -------------------------------------------------------------------------------------- //
// -------------------------------------------------------------------------------------- //

/**
 * 登入與首次遷移主流程
 * 驗證 TeamUp 帳號。
 *
 * 流程：
 * 1. 優先使用已遷移的 AuthAccount。
 * 2. 找不到 AuthAccount 時，才讀取 WM 舊密碼。
 * 3. WM 驗證成功後立即建立 scrypt AuthAccount。
 * 4. 後續登入不再讀取 WM 密碼。
 */
export async function authenticatePassword(
  rawAccountId: string,
  password: string,
): Promise<AuthenticatedIdentity> {
  const accountId = rawAccountId.trim().toUpperCase();

  // 在查詢帳號前統一擋下異常輸入，避免藉由錯誤文字推測遷移狀態。
  try {
    if (!accountId) throw new Error("Invalid account");
    assertPasswordInput(password);
  } catch {
    throw invalidLogin();
  }

  const existingAccount = await loadAuthAccount(accountId);

  if (existingAccount) {
    return authenticateExistingAccount(existingAccount, password);
  }

  return migrateLegacyAccount(accountId, password);
}

/** 新密碼規則只要求長度，不強迫無意義的大小寫或符號組合。 */
export function validateNewPassword(password: string) {
  assertPasswordInput(password);
  if (Array.from(password).length < 15) {
    throw new Error("密碼至少 15 個字元");
  }
}

/** 建立一組只把 Hash 寫入 SQL 的行動裝置 Session。 */
export async function createSession(
  identity: AuthenticatedIdentity,
  deviceName?: string,
): Promise<SessionTokens> {
  const pool = await getPool("teamup");
  const sessionId = randomUUID();
  const familyId = randomUUID();
  const accessToken = generateToken();
  const refreshToken = generateToken();
  const now = Date.now();
  const accessExpiresAt = new Date(now + ACCESS_TOKEN_TTL_MS);
  const refreshExpiresAt = new Date(now + REFRESH_TOKEN_TTL_MS);
  const absoluteExpiresAt = new Date(now + SESSION_ABSOLUTE_TTL_MS);

  await pool
    .request()
    .input("sessionId", sql.UniqueIdentifier, sessionId)
    .input("familyId", sql.UniqueIdentifier, familyId)
    .input("role", sql.NVarChar(10), identity.role)
    .input("subjectId", sql.VarChar(50), identity.id)
    .input("accessTokenHash", sql.Char(64), hashToken(accessToken))
    .input("accessExpiresAt", sql.DateTimeOffset, accessExpiresAt)
    .input("absoluteExpiresAt", sql.DateTimeOffset, absoluteExpiresAt)
    .input("deviceLabel", sql.NVarChar(200), deviceName?.slice(0, 200) || null)
    .input("refreshTokenHash", sql.Char(64), hashToken(refreshToken))
    .input("refreshExpiresAt", sql.DateTimeOffset, refreshExpiresAt)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRAN;

      INSERT dbo.AuthSession (
        sessionID, familyID, role, subjectID, accessTokenHash,
        accessExpiresAt, absoluteExpiresAt, deviceLabel
      )
      VALUES (
        @sessionId, @familyId, @role, @subjectId, @accessTokenHash,
        @accessExpiresAt, @absoluteExpiresAt, @deviceLabel
      );

      INSERT dbo.AuthRefreshToken (sessionID, tokenHash, expiresAt)
      VALUES (@sessionId, @refreshTokenHash, @refreshExpiresAt);

      COMMIT;
    `);

  return {
    accessToken,
    accessExpiresAt: accessExpiresAt.toISOString(),
    refreshToken,
    refreshExpiresAt: refreshExpiresAt.toISOString(),
  };
}

/**
 * 原子消耗 Refresh Token。重複使用已消耗 Token 時，撤銷整個 Family。
 */
export async function refreshSession(refreshToken: string): Promise<SessionTokens> {
  const pool = await getPool("teamup");
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  let finished = false;

  try {
    const tokenHash = hashToken(refreshToken);
    const found = await new sql.Request(transaction)
      .input("tokenHash", sql.Char(64), tokenHash)
      .query(`
        SELECT TOP (1)
          rt.refreshTokenID, rt.sessionID, rt.expiresAt, rt.usedAt, rt.revokedAt,
          s.familyID, s.absoluteExpiresAt, s.revokedAt AS sessionRevokedAt
        FROM dbo.AuthRefreshToken rt WITH (UPDLOCK, HOLDLOCK)
        JOIN dbo.AuthSession s WITH (UPDLOCK, HOLDLOCK) ON s.sessionID = rt.sessionID
        WHERE rt.tokenHash = @tokenHash
      `);
    const row = found.recordset[0];
    if (!row) throw authFailure(401, "Session 已失效");

    if (row.usedAt) {
      await revokeFamily(transaction, row.familyID, "refresh_replay");
      await transaction.commit();
      finished = true;
      throw authFailure(401, "Session 已失效");
    }

    const now = Date.now();
    if (
      row.revokedAt ||
      row.sessionRevokedAt ||
      new Date(row.expiresAt).getTime() <= now ||
      new Date(row.absoluteExpiresAt).getTime() <= now
    ) {
      await revokeFamily(transaction, row.familyID, "expired");
      await transaction.commit();
      finished = true;
      throw authFailure(401, "Session 已失效");
    }

    const accessToken = generateToken();
    const nextRefreshToken = generateToken();
    const accessExpiresAt = new Date(now + ACCESS_TOKEN_TTL_MS);
    const refreshExpiresAt = new Date(
      Math.min(now + REFRESH_TOKEN_TTL_MS, new Date(row.absoluteExpiresAt).getTime()),
    );

    const inserted = await new sql.Request(transaction)
      .input("sessionId", sql.UniqueIdentifier, row.sessionID)
      .input("tokenHash", sql.Char(64), hashToken(nextRefreshToken))
      .input("expiresAt", sql.DateTimeOffset, refreshExpiresAt)
      .query(`
        INSERT dbo.AuthRefreshToken (sessionID, tokenHash, expiresAt)
        OUTPUT inserted.refreshTokenID
        VALUES (@sessionId, @tokenHash, @expiresAt)
      `);
    const replacementId = inserted.recordset[0].refreshTokenID;

    await new sql.Request(transaction)
      .input("refreshTokenId", sql.BigInt, row.refreshTokenID)
      .input("replacementId", sql.BigInt, replacementId)
      .input("sessionId", sql.UniqueIdentifier, row.sessionID)
      .input("accessHash", sql.Char(64), hashToken(accessToken))
      .input("accessExpiresAt", sql.DateTimeOffset, accessExpiresAt)
      .query(`
        UPDATE dbo.AuthRefreshToken
        SET usedAt = SYSDATETIMEOFFSET(), replacedByRefreshTokenID = @replacementId
        WHERE refreshTokenID = @refreshTokenId;

        UPDATE dbo.AuthSession
        SET accessTokenHash = @accessHash,
            accessExpiresAt = @accessExpiresAt,
            lastUsedAt = SYSDATETIMEOFFSET()
        WHERE sessionID = @sessionId;
      `);

    await transaction.commit();
    finished = true;
    return {
      accessToken,
      accessExpiresAt: accessExpiresAt.toISOString(),
      refreshToken: nextRefreshToken,
      refreshExpiresAt: refreshExpiresAt.toISOString(),
    };
  } catch (error) {
    if (!finished) await transaction.rollback().catch(() => undefined);
    throw error;
  }
}

/** 將 Bearer Token 解析成唯一可信任的伺服器 Principal。 */
export async function authenticateAccessToken(accessToken: string): Promise<AuthPrincipal> {
  const pool = await getPool("teamup");
  const result = await pool
    .request()
    .input("tokenHash", sql.Char(64), hashToken(accessToken))
    .query(`
      SELECT TOP (1) s.sessionID, s.role, s.subjectID, a.mustChangePassword
      FROM dbo.AuthSession s
      JOIN dbo.AuthAccount a ON a.role = s.role AND a.subjectID = s.subjectID
      WHERE s.accessTokenHash = @tokenHash
        AND s.revokedAt IS NULL
        AND s.accessExpiresAt > SYSDATETIMEOFFSET()
        AND s.absoluteExpiresAt > SYSDATETIMEOFFSET()
        AND a.status = N'active'
    `);
  const row = result.recordset[0];
  if (!row) throw authFailure(401, "Session 已失效");

  return {
    sessionId: String(row.sessionID),
    role: row.role,
    subjectId: String(row.subjectID),
    mustChangePassword: Boolean(row.mustChangePassword),
  };
}

export async function getSessionUser(principal: AuthPrincipal): Promise<AuthenticatedIdentity> {
  const identity = await loadCurrentWmIdentity(principal.role, principal.subjectId);
  if (!identity) throw authFailure(401, "Session 已失效");
  return { ...identity, mustChangePassword: principal.mustChangePassword };
}

/** 登出一律撤銷 Access Token 與該 Session 的所有 Refresh Token。 */
export async function logoutSession(principal: AuthPrincipal, _refreshToken?: string) {
  const pool = await getPool("teamup");
  await pool
    .request()
    .input("sessionId", sql.UniqueIdentifier, principal.sessionId)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRAN;
      UPDATE dbo.AuthSession
      SET revokedAt = COALESCE(revokedAt, SYSDATETIMEOFFSET()), revokeReason = N'logout'
      WHERE sessionID = @sessionId;
      UPDATE dbo.AuthRefreshToken
      SET revokedAt = COALESCE(revokedAt, SYSDATETIMEOFFSET())
      WHERE sessionID = @sessionId;
      COMMIT;
    `);
}

/** 修改密碼後撤銷所有舊 Session，並核發新的 Token Pair。 */
export async function changePassword(
  principal: AuthPrincipal,
  currentPassword: string,
  newPassword: string,
): Promise<{ user: AuthenticatedIdentity; tokens: SessionTokens }> {
  validateNewPassword(newPassword);
  const account = await loadAuthAccount(principal.subjectId);
  if (!account || !(await verifyPassword(currentPassword, account.password))) {
    throw authFailure(401, INVALID_LOGIN_MESSAGE);
  }

  const password = await hashPassword(newPassword);
  const pool = await getPool("teamup");
  await pool
    .request()
    .input("role", sql.NVarChar(10), principal.role)
    .input("subjectId", sql.VarChar(50), principal.subjectId)
    .input("algorithm", sql.VarChar(20), password.algorithm)
    .input("version", sql.SmallInt, password.version)
    .input("salt", sql.VarChar(64), password.salt)
    .input("hash", sql.VarChar(128), password.hash)
    .input("n", sql.Int, password.params.N)
    .input("r", sql.Int, password.params.r)
    .input("p", sql.Int, password.params.p)
    .input("keyLength", sql.Int, password.params.keyLength)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRAN;
      UPDATE dbo.AuthAccount
      SET passwordAlgorithm = @algorithm, passwordVersion = @version,
          passwordSalt = @salt, passwordHash = @hash,
          scryptN = @n, scryptR = @r, scryptP = @p, scryptKeyLength = @keyLength,
          mustChangePassword = 0, failedAttemptCount = 0, lockUntil = NULL,
          passwordChangedAt = SYSDATETIMEOFFSET(), updatedAt = SYSDATETIMEOFFSET()
      WHERE role = @role AND subjectID = @subjectId;

      UPDATE dbo.AuthSession
      SET revokedAt = COALESCE(revokedAt, SYSDATETIMEOFFSET()), revokeReason = N'password_changed'
      WHERE role = @role AND subjectID = @subjectId;

      UPDATE rt SET revokedAt = COALESCE(rt.revokedAt, SYSDATETIMEOFFSET())
      FROM dbo.AuthRefreshToken rt
      JOIN dbo.AuthSession s ON s.sessionID = rt.sessionID
      WHERE s.role = @role AND s.subjectID = @subjectId;
      COMMIT;
    `);

  const wmIdentity = await loadCurrentWmIdentity(principal.role, principal.subjectId);
  if (!wmIdentity) throw authFailure(401, INVALID_LOGIN_MESSAGE);
  const user = { ...wmIdentity, mustChangePassword: false };
  return { user, tokens: await createSession(user) };
}

/** 內部人員核發一次性重設碼；原始碼只在 CLI 當下顯示一次。 */
export async function issueResetCode(accountId: string) {
  const identity = await resolveWmIdentity(accountId.trim().toUpperCase());
  if (!identity) throw authFailure(404, "找不到帳號");
  const code = randomBytes(8).toString("hex").toUpperCase();
  const pool = await getPool("teamup");
  await pool
    .request()
    .input("role", sql.NVarChar(10), identity.role)
    .input("subjectId", sql.VarChar(50), identity.id)
    .input("tokenHash", sql.Char(64), hashToken(code))
    .input("expiresAt", sql.DateTimeOffset, new Date(Date.now() + 15 * 60 * 1000))
    .query(`
      UPDATE dbo.AuthActivation
      SET usedAt = COALESCE(usedAt, SYSDATETIMEOFFSET())
      WHERE role = @role AND subjectID = @subjectId AND purpose = N'reset' AND usedAt IS NULL;
      INSERT dbo.AuthActivation (role, subjectID, purpose, tokenHash, expiresAt)
      VALUES (@role, @subjectId, N'reset', @tokenHash, @expiresAt);
    `);
  return { code, expiresInMinutes: 15 };
}

/** 使用一次性碼更新或首次建立 AuthAccount，並撤銷該帳號全部 Session。 */
export async function resetPassword(
  rawAccountId: string,
  resetCode: string,
  newPassword: string,
) {
  validateNewPassword(newPassword);
  const accountId = rawAccountId.trim().toUpperCase();
  const password = await hashPassword(newPassword);
  const pool = await getPool("teamup");
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const found = await new sql.Request(transaction)
      .input("subjectId", sql.VarChar(50), accountId)
      .input("tokenHash", sql.Char(64), hashToken(resetCode.trim().toUpperCase()))
      .query(`
        SELECT TOP (1) activationID, role, subjectID, expiresAt, usedAt, attemptCount
        FROM dbo.AuthActivation WITH (UPDLOCK, HOLDLOCK)
        WHERE subjectID = @subjectId AND purpose = N'reset' AND tokenHash = @tokenHash
      `);
    const row = found.recordset[0];
    if (!row || row.usedAt || row.attemptCount >= 5 || new Date(row.expiresAt).getTime() <= Date.now()) {
      throw authFailure(400, "重設碼無效或已過期");
    }

    await new sql.Request(transaction)
      .input("activationId", sql.UniqueIdentifier, row.activationID)
      .input("role", sql.NVarChar(10), row.role)
      .input("subjectId", sql.VarChar(50), row.subjectID)
      .input("algorithm", sql.VarChar(20), password.algorithm)
      .input("version", sql.SmallInt, password.version)
      .input("salt", sql.VarChar(64), password.salt)
      .input("hash", sql.VarChar(128), password.hash)
      .input("n", sql.Int, password.params.N)
      .input("r", sql.Int, password.params.r)
      .input("p", sql.Int, password.params.p)
      .input("keyLength", sql.Int, password.params.keyLength)
      .query(`
        UPDATE dbo.AuthActivation SET usedAt = SYSDATETIMEOFFSET() WHERE activationID = @activationId;

        IF EXISTS (SELECT 1 FROM dbo.AuthAccount WHERE subjectID = @subjectId)
          UPDATE dbo.AuthAccount
          SET passwordAlgorithm = @algorithm, passwordVersion = @version,
              passwordSalt = @salt, passwordHash = @hash,
              scryptN = @n, scryptR = @r, scryptP = @p, scryptKeyLength = @keyLength,
              mustChangePassword = 0, failedAttemptCount = 0, lockUntil = NULL,
              passwordChangedAt = SYSDATETIMEOFFSET(), updatedAt = SYSDATETIMEOFFSET()
          WHERE subjectID = @subjectId;
        ELSE
          INSERT dbo.AuthAccount (
            role, subjectID, passwordAlgorithm, passwordVersion, passwordSalt, passwordHash,
            scryptN, scryptR, scryptP, scryptKeyLength, mustChangePassword, passwordChangedAt
          ) VALUES (
            @role, @subjectId, @algorithm, @version, @salt, @hash,
            @n, @r, @p, @keyLength, 0, SYSDATETIMEOFFSET()
          );

        UPDATE dbo.AuthSession
        SET revokedAt = COALESCE(revokedAt, SYSDATETIMEOFFSET()), revokeReason = N'password_reset'
        WHERE subjectID = @subjectId;
        UPDATE rt SET revokedAt = COALESCE(rt.revokedAt, SYSDATETIMEOFFSET())
        FROM dbo.AuthRefreshToken rt JOIN dbo.AuthSession s ON s.sessionID = rt.sessionID
        WHERE s.subjectID = @subjectId;
      `);
    await transaction.commit();
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
}

/**
 * 驗證已遷移至 TeamUp 的帳號。
 */
async function authenticateExistingAccount(
  account: StoredAuthAccount,
  password: string,
): Promise<AuthenticatedIdentity> {
  /*
   * 即使帳號被停用或暫時鎖定，仍執行 scrypt 驗證，
   * 避免攻擊者利用回應時間推測帳號狀態。
   */
  const [passwordMatches, identity] = await Promise.all([
    verifyPassword(password, account.password),
    loadCurrentWmIdentity(account.role, account.subjectId),
  ]);

  const locked =
    account.lockUntil != null &&
    account.lockUntil.getTime() > Date.now();

  if (
    !passwordMatches ||
    account.status !== "active" ||
    locked ||
    !identity
  ) {
    if (!passwordMatches && account.status === "active" && !locked) {
      await recordFailedLogin(account.role, account.subjectId);
    }

    throw invalidLogin();
  }

  await clearFailedLogin(account.role, account.subjectId);

  return { ...identity, mustChangePassword: account.mustChangePassword };
}

/**
 * 第一次登入時，以 WM 舊明文密碼驗證身分，
 * 成功後立即建立 TeamUp AuthAccount。
 */
async function migrateLegacyAccount(
  accountId: string,
  password: string,
): Promise<AuthenticatedIdentity> {
  // 成功與失敗都先執行一次 scrypt；成功時直接用結果建立 AuthAccount。
  const passwordRecord = await hashPassword(password);
  const throttle = await loadLegacyLoginThrottle(accountId);
  const locked = throttle?.lockUntil != null && throttle.lockUntil.getTime() > Date.now();

  if (locked) throw invalidLogin();

  const legacyIdentity = await loadLegacyWmIdentity(accountId);

  const passwordMatches =
    legacyIdentity != null &&
    matchesLegacyPassword(
      password,
      legacyIdentity.legacyPassword,
    );

  if (!legacyIdentity || !passwordMatches) {
    // 只為真實 WM 帳號留下紀錄，避免任意字串塞滿 throttle 表。
    if (legacyIdentity) await recordLegacyFailedLogin(accountId);
    throw invalidLogin();
  }

  /*
   * 新密碼規則要求至少 15 個字元。
   * 舊 WM 密碼仍可先遷移，但登入後應要求使用者更新。
   */

// 先不要求首次登入強制修改密碼
//   const mustChangePassword =
//     Array.from(password).length < 15;

  await createMigratedAuthAccount(
    legacyIdentity.role,
    legacyIdentity.id,
    passwordRecord,

    // mustChangePassword,
    false, // 先不要求首次登入強制修改密碼
  );
//   await clearLegacyLoginThrottle(accountId);         // 先不要求首次登入強制修改密碼

  /*
   * legacyPassword 不可離開 Server Auth 邊界，
   * 回傳前用解構排除。
   */
  const {
    legacyPassword: _legacyPassword,
    ...identity
  } = legacyIdentity;

  // 先不要求首次登入強制修改密碼：改為 false
  return { ...identity, mustChangePassword: false };
}

// -------------------------------------------------------------------------------------- //
// -------------------------------------------------------------------------------------- //
// -------------------------------------------------------------------------------------- //

/**
 * AuthAccount 查詢
 * 依 accountId 尋找已遷移的 TeamUp AuthAccount。
 *
 * 已確認 CustomerID 與 EmployeeID 不會重複，
 * 因此登入 Request 不需要、也不接受 client 傳入 role。
 */
async function loadAuthAccount(
  accountId: string,
): Promise<StoredAuthAccount | null> {
  const pool = await getPool("teamup");

  const result = await pool
    .request()
    .input("subjectId", sql.VarChar(50), accountId)
    .query(`
      SELECT TOP (1)
        role,
        subjectID,
        status,
        lockUntil,
        mustChangePassword,
        passwordAlgorithm,
        passwordVersion,
        passwordSalt,
        passwordHash,
        scryptN,
        scryptR,
        scryptP,
        scryptKeyLength
      FROM dbo.AuthAccount
      WHERE subjectID = @subjectId
    `);

  const row = result.recordset[0];
  if (!row) return null;

  return {
    role: row.role,
    subjectId: row.subjectID,
    status: row.status,
    lockUntil: row.lockUntil ?? null,
    mustChangePassword: Boolean(row.mustChangePassword),
    password: {
      algorithm: row.passwordAlgorithm,
      version: Number(row.passwordVersion),
      salt: row.passwordSalt,
      hash: row.passwordHash,
      params: {
        N: Number(row.scryptN),
        r: Number(row.scryptR),
        p: Number(row.scryptP),
        keyLength: Number(row.scryptKeyLength),
      },
    } as PasswordHash,
  };
}

/** 解析帳號角色時不讀取 WM 密碼欄位。 */
async function resolveWmIdentity(accountId: string): Promise<WmIdentity | null> {
  const [staff, dealer] = await Promise.all([
    loadCurrentWmIdentity("staff", accountId),
    loadCurrentWmIdentity("dealer", accountId),
  ]);
  return staff && dealer ? null : staff ?? dealer;
}

async function revokeFamily(
  transaction: InstanceType<typeof sql.Transaction>,
  familyId: string,
  reason: string,
) {
  await new sql.Request(transaction)
    .input("familyId", sql.UniqueIdentifier, familyId)
    .input("reason", sql.NVarChar(100), reason)
    .query(`
      UPDATE dbo.AuthSession
      SET revokedAt = COALESCE(revokedAt, SYSDATETIMEOFFSET()), revokeReason = @reason
      WHERE familyID = @familyId;
      UPDATE rt SET revokedAt = COALESCE(rt.revokedAt, SYSDATETIMEOFFSET())
      FROM dbo.AuthRefreshToken rt
      JOIN dbo.AuthSession s ON s.sessionID = rt.sessionID
      WHERE s.familyID = @familyId;
    `);
}

function authFailure(status: number, message: string) {
  return new AuthHttpError(status, message);
}

// -------------------------------------------------------------------------------------- //
// -------------------------------------------------------------------------------------- //
// -------------------------------------------------------------------------------------- //

/**
 * 同時查詢 WM Employee 與 Customer。
 *
 * 因為兩邊 ID 不會重複，所以最多只會得到一個身分。
 * 同時查詢也可避免 client 傳 role，以及減少角色之間的時間差。
 */
async function loadLegacyWmIdentity(
  accountId: string,
): Promise<LegacyIdentity | null> {
  const wm = await getPool("wm");

  const [staffResult, dealerResult] = await Promise.all([
    wm
      .request()
      .input("id", sql.VarChar(50), accountId)
      .query(`
        SELECT TOP (1)
          EmployeeID,
          FullName,
          BusinessUnitID,
          [Password] AS LegacyPassword
        FROM dbo.Employee
        WHERE EmployeeID = @id
      `),

    wm
      .request()
      .input("id", sql.VarChar(50), accountId)
      .query(`
        SELECT TOP (1)
          customer.CustomerID,
          customer.NetPassword AS LegacyPassword,
          customerView.FullName
        FROM dbo.Customer AS customer
        LEFT JOIN dbo.ViewCustCombine AS customerView
          ON customerView.CustomerID = customer.CustomerID
        WHERE customer.CustomerID = @id
      `),
  ]);

  const staff = staffResult.recordset[0];
  const dealer = dealerResult.recordset[0];

  /*
   * 理論上不可能同時存在。
   * 若資料異常真的發生，拒絕登入，避免選錯角色。
   */
  if (staff && dealer) {
    return null;
  }

  if (staff) {
    const businessUnitId =
      staff.BusinessUnitID == null
        ? undefined
        : String(staff.BusinessUnitID);

    const defaultLocation = defaultLocationForBusinessUnit(
      staff.BusinessUnitID,
    );

    return {
      id: String(staff.EmployeeID),
      name: staff.FullName || String(staff.EmployeeID),
      role: "staff",
      memberId: String(staff.EmployeeID),
      businessUnitId,
      defaultLocation,
      office: defaultLocation,
      legacyPassword: String(staff.LegacyPassword ?? ""),
    };
  }

  if (dealer) {
    return {
      id: String(dealer.CustomerID),
      name: dealer.FullName || String(dealer.CustomerID),
      role: "dealer",
      memberId: String(dealer.CustomerID),
      legacyPassword: String(dealer.LegacyPassword ?? ""),
    };
  }

  return null;
}

// -------------------------------------------------------------------------------------- //
// -------------------------------------------------------------------------------------- //
// -------------------------------------------------------------------------------------- //

/**
 * 加入既有帳號的 WM 身份查詢：
 * 已遷移帳號登入時只讀取 WM 身分資料，
 * 不再查詢 NetPassword 或 Employee.Password。
 */
async function loadCurrentWmIdentity(
  role: AuthRole,
  subjectId: string,
): Promise<WmIdentity | null> {
  const wm = await getPool("wm");

  if (role === "dealer") {
    const result = await wm
      .request()
      .input("id", sql.VarChar(50), subjectId)
      .query(`
        SELECT TOP (1)
          customer.CustomerID,
          customerView.FullName
        FROM dbo.Customer AS customer
        LEFT JOIN dbo.ViewCustCombine AS customerView
          ON customerView.CustomerID = customer.CustomerID
        WHERE customer.CustomerID = @id
      `);

    const row = result.recordset[0];
    if (!row) return null;

    return {
      id: String(row.CustomerID),
      name: row.FullName || String(row.CustomerID),
      role: "dealer",
      memberId: String(row.CustomerID),
    };
  }

  const result = await wm
    .request()
    .input("id", sql.VarChar(50), subjectId)
    .query(`
      SELECT TOP (1)
        EmployeeID,
        FullName,
        BusinessUnitID
      FROM dbo.Employee
      WHERE EmployeeID = @id
    `);

  const row = result.recordset[0];
  if (!row) return null;

  const businessUnitId =
    row.BusinessUnitID == null
      ? undefined
      : String(row.BusinessUnitID);

  const defaultLocation = defaultLocationForBusinessUnit(
    row.BusinessUnitID,
  );

  return {
    id: String(row.EmployeeID),
    name: row.FullName || String(row.EmployeeID),
    role: "staff",
    memberId: String(row.EmployeeID),
    businessUnitId,
    defaultLocation,
    office: defaultLocation,
  };
}

// -------------------------------------------------------------------------------------- //
// -------------------------------------------------------------------------------------- //
// -------------------------------------------------------------------------------------- //


/**
 * 加入 AuthAccount 建立與登入失敗限制：
 * 將首次 WM 登入成功的密碼 Hash 保存至 TeamUp。
 *
 * UPDLOCK + HOLDLOCK 防止同一帳號同時首次登入時，
 * 產生重複 AuthAccount。
 */
async function createMigratedAuthAccount(
  role: AuthRole,
  subjectId: string,
  password: PasswordHash,
  mustChangePassword: boolean,
) {
  const pool = await getPool("teamup");

  await pool
    .request()
    .input("role", sql.NVarChar(10), role)
    .input("subjectId", sql.VarChar(50), subjectId)
    .input(
      "passwordAlgorithm",
      sql.VarChar(20),
      password.algorithm,
    )
    .input("passwordVersion", sql.SmallInt, password.version)
    .input("passwordSalt", sql.VarChar(64), password.salt)
    .input("passwordHash", sql.VarChar(128), password.hash)
    .input("scryptN", sql.Int, password.params.N)
    .input("scryptR", sql.Int, password.params.r)
    .input("scryptP", sql.Int, password.params.p)
    .input(
      "scryptKeyLength",
      sql.Int,
      password.params.keyLength,
    )
    .input(
      "mustChangePassword",
      sql.Bit,
      mustChangePassword,
    )
    .query(`
      INSERT dbo.AuthAccount (
        role,
        subjectID,
        passwordAlgorithm,
        passwordVersion,
        passwordSalt,
        passwordHash,
        scryptN,
        scryptR,
        scryptP,
        scryptKeyLength,
        mustChangePassword,
        passwordMigratedAt
      )
      SELECT
        @role,
        @subjectId,
        @passwordAlgorithm,
        @passwordVersion,
        @passwordSalt,
        @passwordHash,
        @scryptN,
        @scryptR,
        @scryptP,
        @scryptKeyLength,
        @mustChangePassword,
        SYSDATETIMEOFFSET()
      WHERE NOT EXISTS (
        SELECT 1
        FROM dbo.AuthAccount WITH (UPDLOCK, HOLDLOCK)
        WHERE role = @role
          AND subjectID = @subjectId
      );
    `);
}

/** 讀取尚未遷移帳號的鎖定狀態。 */
async function loadLegacyLoginThrottle(
  subjectId: string,
): Promise<LegacyLoginThrottle | null> {
  const pool = await getPool("teamup");
  const result = await pool
    .request()
    .input("subjectId", sql.VarChar(50), subjectId)
    .query(`
      SELECT TOP (1) lockUntil
      FROM dbo.AuthLoginThrottle
      WHERE subjectID = @subjectId
    `);

  const row = result.recordset[0];
  return row ? { lockUntil: row.lockUntil ?? null } : null;
}

/**
 * 記錄尚未遷移帳號的失敗次數。
 * Transaction 與範圍鎖避免同一帳號並行登入時遺失計數。
 */
async function recordLegacyFailedLogin(subjectId: string) {
  const pool = await getPool("teamup");
  await pool
    .request()
    .input("subjectId", sql.VarChar(50), subjectId)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRAN;

      UPDATE dbo.AuthLoginThrottle WITH (UPDLOCK, HOLDLOCK)
      SET
        failedAttemptCount = failedAttemptCount + 1,
        lockUntil = CASE
          WHEN failedAttemptCount + 1 >= 10 THEN DATEADD(MINUTE, 15, SYSDATETIMEOFFSET())
          WHEN failedAttemptCount + 1 >= 5 THEN DATEADD(MINUTE, 1, SYSDATETIMEOFFSET())
          ELSE NULL
        END,
        updatedAt = SYSDATETIMEOFFSET()
      WHERE subjectID = @subjectId;

      IF @@ROWCOUNT = 0
        INSERT dbo.AuthLoginThrottle (subjectID, failedAttemptCount)
        VALUES (@subjectId, 1);

      COMMIT;
    `);
}

/** 首次遷移成功後移除不再需要的暫時鎖定資料。 */
async function clearLegacyLoginThrottle(subjectId: string) {
  const pool = await getPool("teamup");
  await pool
    .request()
    .input("subjectId", sql.VarChar(50), subjectId)
    .query(`DELETE FROM dbo.AuthLoginThrottle WHERE subjectID = @subjectId`);
}

/**
 * 登入失敗時採帳號層級的累進鎖定：
 * 第 5 次起鎖 1 分鐘，第 10 次起鎖 15 分鐘。
 */
async function recordFailedLogin(
  role: AuthRole,
  subjectId: string,
) {
  const pool = await getPool("teamup");

  await pool
    .request()
    .input("role", sql.NVarChar(10), role)
    .input("subjectId", sql.VarChar(50), subjectId)
    .query(`
      UPDATE dbo.AuthAccount
      SET
        failedAttemptCount = failedAttemptCount + 1,
        lockUntil =
          CASE
            WHEN failedAttemptCount + 1 >= 10
              THEN DATEADD(MINUTE, 15, SYSDATETIMEOFFSET())
            WHEN failedAttemptCount + 1 >= 5
              THEN DATEADD(MINUTE, 1, SYSDATETIMEOFFSET())
            ELSE NULL
          END,
        updatedAt = SYSDATETIMEOFFSET()
      WHERE role = @role
        AND subjectID = @subjectId;
    `);
}

/**
 * 登入成功後清除失敗次數與暫時鎖定。
 */
async function clearFailedLogin(
  role: AuthRole,
  subjectId: string,
) {
  const pool = await getPool("teamup");

  await pool
    .request()
    .input("role", sql.NVarChar(10), role)
    .input("subjectId", sql.VarChar(50), subjectId)
    .query(`
      UPDATE dbo.AuthAccount
      SET
        failedAttemptCount = 0,
        lockUntil = NULL,
        updatedAt = SYSDATETIMEOFFSET()
      WHERE role = @role
        AND subjectID = @subjectId;
    `);
}

function invalidLogin() {
  // 錯誤帳密是預期中的驗證失敗，必須回 401，不可污染 Server 500 監控。
  return authFailure(401, INVALID_LOGIN_MESSAGE);
}

// -------------------------------------------------------------------------------------- //
// -------------------------------------------------------------------------------------- //
// -------------------------------------------------------------------------------------- //

/**
 * 將明文密碼轉成不可逆的 scrypt Hash。
 *
 * 每次都會產生新的隨機 Salt，因此同一密碼重複雜湊，
 * 也不會得到相同的結果。
 */
export async function hashPassword(
  password: string,
): Promise<PasswordHash> {
  assertPasswordInput(password);

  // 16 Bytes Salt 足以避免預先運算和彩虹表攻擊。
  const salt = randomBytes(16);
  const derivedKey = await deriveKey(password, salt);

  return {
    algorithm: "scrypt",
    version: 1,
    salt: salt.toString("base64url"),
    hash: derivedKey.toString("base64url"),
    params: SCRYPT_PARAMS,
  };
}

/**
 * 驗證使用者輸入的密碼。
 *
 * 密碼不會解密；系統用相同 Salt 與參數重新計算，
 * 再以固定時間比較運算結果。
 */
export async function verifyPassword(
  password: string,
  stored: PasswordHash,
): Promise<boolean> {
  try {
    assertPasswordInput(password);

    // 不接受未知演算法、版本或遭修改的雜湊參數。
    if (
      stored.algorithm !== "scrypt" ||
      stored.version !== 1 ||
      stored.params.N !== SCRYPT_PARAMS.N ||
      stored.params.r !== SCRYPT_PARAMS.r ||
      stored.params.p !== SCRYPT_PARAMS.p ||
      stored.params.keyLength !== SCRYPT_PARAMS.keyLength
    ) {
      return false;
    }

    const expected = Buffer.from(stored.hash, "base64url");
    const actual = await deriveKey(
      password,
      Buffer.from(stored.salt, "base64url"),
    );

    /**
     * timingSafeEqual 避免一般字串比較可能造成的時間差攻擊。
     * 呼叫前必須先確認兩個 Buffer 長度相同，否則 Node 會拋出錯誤。
     */
    return (
      expected.length === actual.length &&
      timingSafeEqual(expected, actual)
    );
  } catch {
    // 對外統一回傳驗證失敗，不洩漏資料格式或內部錯誤。
    return false;
  }
}

/**
 * 產生 Access Token 或 Refresh Token。
 *
 * 32 Bytes 等於 256 Bits 隨機熵；Base64URL 適合放在
 * HTTP Header、JSON 與 SecureStore 中。
 */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * 將 Token 轉成 SHA-256 Hash。
 *
 * SQL Server 只能保存 Token Hash，不可保存原始 Token。
 * API 回傳給 App 的則是原始 Token。
 */
export function hashToken(token: string): string {
  return createHash("sha256")
    .update(token, "utf8")
    .digest("hex");
}

/**
 * 檢查密碼是否屬於可接受的輸入範圍。
 *
 * 刻意不 trim 密碼，因為空白可能是使用者密碼的一部分。
 */
function assertPasswordInput(password: string) {
  const byteLength = Buffer.byteLength(password, "utf8");

  if (!byteLength || byteLength > MAX_PASSWORD_BYTES) {
    throw new Error("Invalid password");
  }
}

/**
 * 將 callback 形式的 node:crypto.scrypt 包成 Promise，
 * 讓登入流程可以使用 async/await。
 */
function deriveKey(
  password: string,
  salt: Buffer,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      SCRYPT_PARAMS.keyLength,
      SCRYPT_OPTIONS,
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(derivedKey);
      },
    );
  });
}
