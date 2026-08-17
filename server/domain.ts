export type QrKind = "staff_checkin" | "reward_claim";

export type QrPayload =
  | { kind: "staff_checkin"; qrCode: string }
  | { kind: "reward_claim"; giftCode: string };

export type LevelRule = {
  levelNo: number;
  levelName: string;
  expRequired: number;
};

export type EventRow = {
  eventID: number;
  eventType: string;
  eventName: string;
  isActive: boolean;
};

export type StaffQrRow = {
  staffQrID: number;
  eventID: number;
  qrCode: string;
  expiresAt: string;
  isActive: boolean;
};

export type ExpPointRuleRow = {
  expPointRuleID: number;
  eventType: string;
  participantType: string;
  expAmount: number;
  pointAmount: number;
  isActive: boolean;
};

export type RewardRuleRow = {
  rewardRuleID: number;
  levelNo: number;
  rewardName: string;
  rewardQty: number;
  rewardUnit: string;
  pointCost: number;
  rewardType: "normal" | "new_manager_special";
  issueMode: "user_redeem" | "system_auto";
  sortOrder: number;
  isActive: boolean;
};

export type AttendanceRow = {
  attendanceID: number;
  eventID: number;
  staffQrID: number;
  CustomerID: string;
  participantType: string;
  participantName?: string;
  status: "checked_in" | "voided";
};

export type LedgerRow = {
  CustomerID: string;
  expPointRuleID?: number;
  sourceType: string;
  sourceID: string;
  expDelta: number;
  pointDelta: number;
};

export type ProgressRow = {
  CustomerID: string;
  expTotal: number;
  pointBalance: number;
  currentLevelNo: number | null;
};

export type CustomerRewardRow = {
  customerRewardID: number;
  CustomerID: string;
  rewardRuleID: number;
  gift: string;
  rewardQty: number;
  rewardUnit: string;
  pointCost: number;
  giftCode: string;
  status: "issue" | "got" | "voided";
  issueMode: "user_redeem" | "system_auto";
  sourceType?: string;
  sourceID?: string;
  redeemedAt?: string;
  isGet: boolean;
  gotAt?: string;
  SalesID?: string;
  gotByEmployeeID?: string;
};

export type WorkflowState = {
  levels: LevelRule[];
  events: EventRow[];
  qrCodes: StaffQrRow[];
  expRules: ExpPointRuleRow[];
  rewardRules: RewardRuleRow[];
  attendances: AttendanceRow[];
  ledger: LedgerRow[];
  progress: Record<string, ProgressRow>;
  customerRewards: CustomerRewardRow[];
};

export type DirectNewcomerRelationship = {
  referrerCustomerId: string;
  newcomerCustomerId: string;
  joinDate: string;
};

export const COMPANION_DIRECT_NEWCOMER_SOURCE = "companion_direct_newcomer";
export const COMPANION_DIRECT_NEWCOMER_RULE_TYPE = "direct_newcomer_companion";

export function companionDirectNewcomerSourceID(eventType: string, companionCustomerId: string) {
  return `${eventType}:${companionCustomerId}`;
}

export function parseQrPayload(value: string, expectedKind?: QrKind): QrPayload {
  let payload: unknown;
  try {
    payload = JSON.parse(value);
  } catch {
    throw new Error("Invalid QR payload");
  }

  if (!payload || typeof payload !== "object" || !("kind" in payload)) {
    throw new Error("Invalid QR payload");
  }

  const kind = (payload as { kind: unknown }).kind;
  if (expectedKind && kind !== expectedKind) {
    throw new Error(`Expected ${expectedKind} QR`);
  }

  if (kind === "staff_checkin" && typeof (payload as { qrCode?: unknown }).qrCode === "string") {
    return payload as QrPayload;
  }

  if (kind === "reward_claim" && typeof (payload as { giftCode?: unknown }).giftCode === "string") {
    return payload as QrPayload;
  }

  throw new Error("Invalid QR payload");
}

export function currentLevelNo(expTotal: number, levels: LevelRule[]) {
  return [...levels]
    .filter((level) => expTotal >= level.expRequired)
    .sort((a, b) => b.expRequired - a.expRequired)[0]?.levelNo ?? null;
}

function progressFor(state: WorkflowState, customerId: string): ProgressRow {
  state.progress[customerId] ??= {
    CustomerID: customerId,
    expTotal: 0,
    pointBalance: 0,
    currentLevelNo: currentLevelNo(0, state.levels),
  };
  return state.progress[customerId];
}

export function applyCheckIn(
  state: WorkflowState,
  input: {
    qrCode: string;
    customerId: string;
    participantType: string;
    participantName?: string;
    now: string;
  },
) {
  const qr = state.qrCodes.find((item) => item.qrCode === input.qrCode && item.isActive);
  if (!qr || Date.parse(qr.expiresAt) < Date.parse(input.now)) {
    throw new Error("QR code 過期或失效。\n請洽工作人員。");
  }

  const event = state.events.find((item) => item.eventID === qr.eventID && item.isActive);
  if (!event) throw new Error("Event inactive");

  const existing = state.attendances.find(
    (attendance) =>
      attendance.staffQrID === qr.staffQrID &&
      attendance.CustomerID === input.customerId &&
      attendance.participantType === input.participantType &&
      attendance.status === "checked_in",
  );
  if (existing) return { duplicate: true, attendance: existing, expDelta: 0, pointDelta: 0 };

  const rule = state.expRules.find(
    (item) =>
      item.eventType === event.eventType &&
      item.participantType === input.participantType &&
      item.isActive,
  );
  if (!rule) throw new Error("No active point rule");

  const attendance: AttendanceRow = {
    attendanceID: state.attendances.length + 1,
    eventID: event.eventID,
    staffQrID: qr.staffQrID,
    CustomerID: input.customerId,
    participantType: input.participantType,
    participantName: input.participantName,
    status: "checked_in",
  };
  state.attendances.push(attendance);
  state.ledger.push({
    CustomerID: input.customerId,
    expPointRuleID: rule.expPointRuleID,
    sourceType: "attendance",
    sourceID: String(attendance.attendanceID),
    expDelta: rule.expAmount,
    pointDelta: rule.pointAmount,
  });

  const progress = progressFor(state, input.customerId);
  progress.expTotal += rule.expAmount;
  progress.pointBalance += rule.pointAmount;
  progress.currentLevelNo = currentLevelNo(progress.expTotal, state.levels);

  return {
    duplicate: false,
    attendance,
    expDelta: rule.expAmount,
    pointDelta: rule.pointAmount,
  };
}

export function applyRedeem(
  state: WorkflowState,
  input: { customerId: string; rewardRuleID: number; giftCode: string; now: string },
) {
  const rule = state.rewardRules.find(
    (item) =>
      item.rewardRuleID === input.rewardRuleID &&
      item.rewardType === "normal" &&
      item.issueMode === "user_redeem" &&
      item.isActive,
  );
  if (!rule) throw new Error("Reward unavailable");

  const progress = progressFor(state, input.customerId);
  if ((progress.currentLevelNo ?? 0) < rule.levelNo) throw new Error("Level too low");
  if (progress.pointBalance < rule.pointCost) throw new Error("Point balance too low");

  const reward = createReward(state, input.customerId, rule, input.giftCode, input.now);
  reward.redeemedAt = input.now;
  progress.pointBalance -= rule.pointCost;
  state.ledger.push({
    CustomerID: input.customerId,
    sourceType: "reward_redeem",
    sourceID: String(reward.customerRewardID),
    expDelta: 0,
    pointDelta: -rule.pointCost,
  });
  return reward;
}

export function applyRewardClaim(
  state: WorkflowState,
  input: { giftCode: string; salesId: string; employeeId: string; now: string },
) {
  const reward = state.customerRewards.find(
    (item) => item.giftCode === input.giftCode && item.status === "issue" && !item.isGet,
  );
  if (!reward) throw new Error("Reward not claimable");

  reward.status = "got";
  reward.isGet = true;
  reward.gotAt = input.now;
  reward.SalesID = input.salesId;
  reward.gotByEmployeeID = input.employeeId;
  return reward;
}

export function syncSpecialRewards(
  state: WorkflowState,
  input: { customerId: string; joinedCustomerIds: string[]; now: string },
) {
  const progress = progressFor(state, input.customerId);
  const rule = state.rewardRules
    .filter(
      (item) =>
        item.rewardType === "new_manager_special" &&
        item.issueMode === "system_auto" &&
        item.isActive &&
        item.levelNo <= (progress.currentLevelNo ?? 0),
    )
    .sort((a, b) => b.levelNo - a.levelNo)[0];
  if (!rule) return [];

  const created: CustomerRewardRow[] = [];
  for (const joinedCustomerId of input.joinedCustomerIds) {
    const existing = state.customerRewards.find(
      (item) =>
        item.CustomerID === input.customerId &&
        item.sourceType === "wm_member_join" &&
        item.sourceID === joinedCustomerId,
    );
    if (existing) {
      const existingRule = state.rewardRules.find((item) => item.rewardRuleID === existing.rewardRuleID);
      if (
        existing.status === "issue" &&
        !existing.isGet &&
        existingRule &&
        existingRule.levelNo < rule.levelNo
      ) {
        existing.rewardRuleID = rule.rewardRuleID;
        existing.gift = rule.rewardName;
        existing.rewardQty = rule.rewardQty;
        existing.rewardUnit = rule.rewardUnit;
        existing.pointCost = rule.pointCost;
      }
      continue;
    }

    created.push(
      createReward(
        state,
        input.customerId,
        rule,
        `GFT-S-${joinedCustomerId}`,
        input.now,
        "wm_member_join",
        joinedCustomerId,
      ),
    );
  }

  return created;
}

export function syncCompanionDirectNewcomerBonuses(
  state: WorkflowState,
  input: {
    eventID: number;
    currentCustomerId: string;
    relationships: DirectNewcomerRelationship[];
    joinedSince: string;
    now: string;
  },
) {
  const rule = state.expRules.find(
    (item) =>
      item.eventType === COMPANION_DIRECT_NEWCOMER_RULE_TYPE &&
      item.participantType === "dealer" &&
      item.isActive,
  );
  if (!rule) return [];

  const checkedIn = new Set(
    state.attendances
      .filter((attendance) => attendance.eventID === input.eventID && attendance.status === "checked_in")
      .map((attendance) => attendance.CustomerID),
  );
  const joinedSince = Date.parse(input.joinedSince);
  const created: LedgerRow[] = [];

  for (const relationship of input.relationships) {
    if (
      relationship.referrerCustomerId !== input.currentCustomerId &&
      relationship.newcomerCustomerId !== input.currentCustomerId
    ) {
      continue;
    }
    if (!checkedIn.has(relationship.referrerCustomerId) || !checkedIn.has(relationship.newcomerCustomerId)) {
      continue;
    }
    if (Date.parse(relationship.joinDate) < joinedSince) continue;

    const sourceID = `${input.eventID}:${relationship.newcomerCustomerId}`;
    const existing = state.ledger.find(
      (item) =>
        item.CustomerID === relationship.referrerCustomerId &&
        item.sourceType === COMPANION_DIRECT_NEWCOMER_SOURCE &&
        item.sourceID === sourceID,
    );
    if (existing) continue;

    const ledger: LedgerRow = {
      CustomerID: relationship.referrerCustomerId,
      expPointRuleID: rule.expPointRuleID,
      sourceType: COMPANION_DIRECT_NEWCOMER_SOURCE,
      sourceID,
      expDelta: rule.expAmount,
      pointDelta: rule.pointAmount,
    };
    state.ledger.push(ledger);

    const progress = progressFor(state, relationship.referrerCustomerId);
    progress.expTotal += rule.expAmount;
    progress.pointBalance += rule.pointAmount;
    progress.currentLevelNo = currentLevelNo(progress.expTotal, state.levels);
    created.push(ledger);
  }

  return created;
}

export function applyRule2CompanionCheckIn(
  state: WorkflowState,
  input: {
    eventID: number;
    staffQrID: number;
    referrerCustomerId: string;
    companionCustomerId: string;
    relationships: DirectNewcomerRelationship[];
    eventDate: string;
  },
) {
  if (!input.companionCustomerId.trim()) throw new Error("Companion required");

  const event = state.events.find((item) => item.eventID === input.eventID && item.isActive);
  if (!event) throw new Error("Event inactive");

  const relationship = eligibleDirectNewcomer(
    input.relationships,
    input.referrerCustomerId,
    input.companionCustomerId,
    input.eventDate,
  );
  if (!relationship) throw new Error("Companion is not an eligible direct newcomer");

  const rule = state.expRules.find(
    (item) => item.eventType === event.eventType && item.participantType === "dealer" && item.isActive,
  );
  if (!rule) throw new Error("No active point rule");

  const referrerAttendance = ensureAttendance(state, input.eventID, input.staffQrID, input.referrerCustomerId);
  const companionAttendance = ensureAttendance(state, input.eventID, input.staffQrID, input.companionCustomerId);
  const sourceID = companionDirectNewcomerSourceID(event.eventType, input.companionCustomerId);
  const existing = state.ledger.find(
    (item) =>
      item.CustomerID === input.referrerCustomerId &&
      item.sourceType === COMPANION_DIRECT_NEWCOMER_SOURCE &&
      item.sourceID === sourceID,
  );
  if (existing) {
    return {
      duplicate: true,
      attendance: referrerAttendance,
      companionAttendance,
      expDelta: 0,
      pointDelta: 0,
    };
  }

  state.ledger.push({
    CustomerID: input.referrerCustomerId,
    expPointRuleID: rule.expPointRuleID,
    sourceType: COMPANION_DIRECT_NEWCOMER_SOURCE,
    sourceID,
    expDelta: rule.expAmount,
    pointDelta: rule.pointAmount,
  });

  const progress = progressFor(state, input.referrerCustomerId);
  progress.expTotal += rule.expAmount;
  progress.pointBalance += rule.pointAmount;
  progress.currentLevelNo = currentLevelNo(progress.expTotal, state.levels);

  return {
    duplicate: false,
    attendance: referrerAttendance,
    companionAttendance,
    expDelta: rule.expAmount,
    pointDelta: rule.pointAmount,
  };
}

function ensureAttendance(
  state: WorkflowState,
  eventID: number,
  staffQrID: number,
  customerId: string,
): AttendanceRow {
  const existing = state.attendances.find(
    (attendance) =>
      attendance.eventID === eventID &&
      attendance.CustomerID === customerId &&
      attendance.participantType === "dealer" &&
      attendance.status === "checked_in",
  );
  if (existing) return existing;

  const attendance: AttendanceRow = {
    attendanceID: state.attendances.length + 1,
    eventID,
    staffQrID,
    CustomerID: customerId,
    participantType: "dealer",
    status: "checked_in",
  };
  state.attendances.push(attendance);
  return attendance;
}

function eligibleDirectNewcomer(
  relationships: DirectNewcomerRelationship[],
  referrerCustomerId: string,
  newcomerCustomerId: string,
  eventDate: string,
) {
  const eventTime = Date.parse(eventDate);
  if (!Number.isFinite(eventTime)) throw new Error("Invalid event date");
  const windowStart = new Date(eventTime);
  windowStart.setMonth(windowStart.getMonth() - 3);

  return relationships.find((relationship) => {
    if (
      relationship.referrerCustomerId !== referrerCustomerId ||
      relationship.newcomerCustomerId !== newcomerCustomerId
    ) {
      return false;
    }
    const joinTime = Date.parse(relationship.joinDate);
    return Number.isFinite(joinTime) && joinTime >= windowStart.getTime() && joinTime <= eventTime;
  });
}

function createReward(
  state: WorkflowState,
  customerId: string,
  rule: RewardRuleRow,
  giftCode: string,
  now: string,
  sourceType?: string,
  sourceID?: string,
): CustomerRewardRow {
  const reward: CustomerRewardRow = {
    customerRewardID: state.customerRewards.length + 1,
    CustomerID: customerId,
    rewardRuleID: rule.rewardRuleID,
    gift: rule.rewardName,
    rewardQty: rule.rewardQty,
    rewardUnit: rule.rewardUnit,
    pointCost: rule.pointCost,
    giftCode,
    status: "issue",
    issueMode: rule.issueMode,
    sourceType,
    sourceID,
    redeemedAt: rule.issueMode === "user_redeem" ? now : undefined,
    isGet: false,
  };
  state.customerRewards.push(reward);
  return reward;
}
