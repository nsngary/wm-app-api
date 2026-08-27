import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    generateToken,
    hashPassword,
    hashToken,
    matchesLegacyPassword,
    ACCESS_TOKEN_TTL_MS,
    REFRESH_TOKEN_TTL_MS,
    SESSION_ABSOLUTE_TTL_MS,
    validateNewPassword,
    verifyPassword,
} from "./auth";

async function main() {
    const authSql = readFileSync("server/sql/auth.sql", "utf8");
    const authSource = readFileSync("server/auth.ts", "utf8");
    const resetSource = readFileSync("server/reset.ts", "utf8");

    // 只檢查可執行 SQL，避免安全註解中的 WM 欄位名稱造成誤判。
    const executableAuthSql = authSql.replace(/\/\*[\s\S]*?\*\//g, "");

    // 四張 Auth 核心資料表都必須由 TeamUp 資料庫管理。
    for (const table of [
        "AuthAccount",
        "AuthActivation",
        "AuthSession",
        "AuthRefreshToken",
        "AuthLoginThrottle",
    ]) {
        assert.match(
            authSql,
            new RegExp(`CREATE TABLE dbo\\.${table}`, "i"),
            `缺少 dbo.${table}`,
        );
    }

    // Token 必須使用唯一索引，避免相同 Token Hash 被重複保存。
    assert.match(authSql, /UX_AuthActivation_TokenHash/i);
    assert.match(authSql, /UX_AuthSession_AccessTokenHash/i);
    assert.match(authSql, /UX_AuthRefreshToken_TokenHash/i);
    assert.match(authSql, /UX_AuthAccount_SubjectID/i);

    // TeamUp Auth Schema 不可保存或引用 WM 的明文密碼欄位。
    assert.doesNotMatch(
        executableAuthSql,
        /NetPassword|plainPassword|plaintextPassword/i,
    );

    // 尚未遷移的 WM 帳號也必須留下登入失敗與鎖定紀錄。
    assert.match(authSource, /loadLegacyLoginThrottle/);
    assert.match(authSource, /recordLegacyFailedLogin/);
    assert.match(authSource, /clearLegacyLoginThrottle/);
    assert.match(authSource, /function invalidLogin\(\)[\s\S]*authFailure\(401,/);

    // Session API 必須具備登入、輪替、撤銷與 Principal 驗證邊界。
    for (const contract of [
        "createSession",
        "refreshSession",
        "authenticateAccessToken",
        "logoutSession",
        "changePassword",
        "deleteAccount",
        "resetPassword",
    ]) {
        assert.match(authSource, new RegExp(`export async function ${contract}`));
    }

    assert.equal(ACCESS_TOKEN_TTL_MS, 15 * 60 * 1000);
    assert.equal(REFRESH_TOKEN_TTL_MS, 30 * 24 * 60 * 60 * 1000);
    assert.equal(SESSION_ABSOLUTE_TTL_MS, 90 * 24 * 60 * 60 * 1000);

    assert.throws(() => validateNewPassword("too-short"), /至少 15 個字元/);
    assert.doesNotThrow(() => validateNewPassword("123456789012345"));
    assert.doesNotThrow(() => validateNewPassword("x".repeat(64)));

    // reset.ts 執行既有資料重置前，必須先確保 Auth Schema 存在。
    assert.match(
        resetSource,
        /server", "sql", "auth\.sql"/,
    );

    // WM 舊密碼目前是明文，只能在 API Server 記憶體中比較。
    assert.equal(
        matchesLegacyPassword("WM-password-123", "WM-password-123"),
        true,
    );

    assert.equal(
        matchesLegacyPassword("wrong-password", "WM-password-123"),
        false,
    );

    // 密碼不可 trim；前後空白可能是原密碼的一部分。
    assert.equal(
        matchesLegacyPassword(" WM-password-123 ", "WM-password-123"),
        false,
    );

    const password = "correct horse battery staple";

    // 同一組密碼重複雜湊時，必須產生不同 Salt 與 Hash，
    // 避免相同密碼在資料庫中呈現相同結果。
    const first = await hashPassword(password);
    const second = await hashPassword(password);

    assert.equal(first.algorithm, "scrypt");
    assert.equal(first.version, 1);
    assert.notEqual(first.salt, second.salt);
    assert.notEqual(first.hash, second.hash);

    // 正確密碼應通過；錯誤密碼不可通過。
    assert.equal(await verifyPassword(password, first), true);
    assert.equal(await verifyPassword("wrong password", first), false);

    // 超過 Server 上限時只能驗證失敗，不可洩漏內部例外。
    assert.equal(await verifyPassword("x".repeat(1025), first), false);

    const tokens = new Set<string>();

    const deleteAccountSource = authSource.slice(
        authSource.indexOf("export async function deleteAccount"),
        authSource.indexOf(
            "/** 內部人員核發一次性重設碼",
        ),
    );

    assert.match(
        deleteAccountSource,
        /verifyPassword\(currentPassword,\s*account\.password\)/,
    );

    for (const table of [
        "CustomerReward",
        "ExpPointLedger",
        "CustomerProgress",
        "Attendance",
        "AuthRefreshToken",
        "AuthSession",
        "AuthActivation",
        "AuthLoginThrottle",
        "AuthAccount",
    ]) {
        assert.match(
            deleteAccountSource,
            new RegExp(`DELETE[\\s\\S]*dbo\\.${table}`),
            `刪除帳號流程缺少 dbo.${table}`,
        );
    }

    assert.match(
        deleteAccountSource,
        /participantExternalID = NULL/,
    );

    assert.match(
        deleteAccountSource,
        /sourceID = CONCAT\([\s\S]*N'deleted:'[\s\S]*@deletionId/,
    );

    assert.doesNotMatch(
        deleteAccountSource,
        /status\s*=\s*N'disabled'/,
    );

    // 驗證每個 Token 至少包含 32 Bytes（256 Bits）隨機資料，
    // 並確認重複產生時沒有出現相同 Token。
    for (let index = 0; index < 50; index += 1) {
        const token = generateToken();
        const tokenHash = hashToken(token);

        assert.ok(Buffer.from(token, "base64url").length >= 32);

        // SHA-256 的十六進位結果固定為 64 個字元。
        assert.equal(tokenHash.length, 64);

        // 原始 Token 與資料庫保存的 Token Hash 不可相同。
        assert.notEqual(tokenHash, token);

        tokens.add(token);
    }

    assert.equal(tokens.size, 50);

    console.log("auth crypto contracts ok");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
