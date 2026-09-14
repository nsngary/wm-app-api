import assert from "node:assert/strict";

async function main() {
  const api = await import("./api.js");
  const previewDto = (api as Record<string, unknown>).rewardClaimPreviewDto as
    | ((row: Record<string, unknown>, customerName?: string) => unknown)
    | undefined;

  assert.equal(
    typeof previewDto,
    "function",
    "The claim flow must expose an authoritative reward preview before fulfillment.",
  );
  assert.deepEqual(
    previewDto?.(
      {
        CustomerID: "TW2626362",
        gift: "商品兌換券 $1000",
        rewardQty: 1,
        rewardUnit: "張",
        campaignID: "3",
        campaignName: "2026 第三季",
        giftCode: "4281b74740772ad78f105925141f68cfeea",
        issuedAt: new Date("2026-09-14T14:35:00+08:00"),
        status: "issue",
        isGet: false,
      },
      "王小明",
    ),
    {
      customerId: "TW2626362",
      customerName: "王小明",
      rewardName: "商品兌換券 $1000",
      rewardQty: 1,
      rewardUnit: "張",
      campaignId: "3",
      campaignName: "2026 第三季",
      giftCode: "4281b74740772ad78f105925141f68cfeea",
      issuedAt: "2026-09-14T06:35:00.000Z",
    },
  );
  assert.throws(
    () => previewDto?.({ status: "got", isGet: true }),
    /此兌換碼無效或已完成領取/,
    "A fulfilled reward must never produce a confirmation preview.",
  );
}

void main();
