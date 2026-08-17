import { issueResetCode } from "./auth";

async function main() {
  const accountId = process.argv[2];
  if (!accountId) throw new Error("Usage: npm run auth:issue-reset -- <accountId>");

  const result = await issueResetCode(accountId);
  // 此一次性碼是唯一允許輸出的秘密，只顯示給已完成身分核對的內部人員。
  console.log(`Reset code: ${result.code} (expires in ${result.expiresInMinutes} minutes)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
