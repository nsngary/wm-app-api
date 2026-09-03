export type ActivityDefinition = {
  eventType: string;
  name: string;
  points: number;
  isActive: boolean;
  sortOrder: number;
};

export type EventSessionInput = {
  role: string;
  employeeId: string;
  eventType: string;
  eventName: string;
  startAt: string;
  endAt: string | null;
  location: string;
  locationAddress: string | null;
  description: string;
};

export const activityCatalog: ActivityDefinition[] = [
  { eventType: "elite", name: "菁英研習營", points: 20, isActive: true, sortOrder: 10 },
  { eventType: "sha", name: "SHA一日訓", points: 15, isActive: true, sortOrder: 20 },
  { eventType: "product_basic", name: "產品初階訓課", points: 10, isActive: true, sortOrder: 30 },
  { eventType: "product_brief", name: "產品說明會", points: 5, isActive: true, sortOrder: 40 },
  { eventType: "business_brief", name: "事業說明會", points: 5, isActive: true, sortOrder: 50 },
  { eventType: "health_meeting", name: "與健康有約", points: 5, isActive: true, sortOrder: 60 },
  { eventType: "business_meeting", name: "與經營有約", points: 5, isActive: true, sortOrder: 70 },
  { eventType: "new_meeting", name: "新經理見面會", points: 5, isActive: true, sortOrder: 80 },
  { eventType: "tea_time", name: "下午茶", points: 5, isActive: true, sortOrder: 90 },
  { eventType: "young_meeting", name: "青春同學會", points: 5, isActive: true, sortOrder: 100 },
];

export function defaultLocationForBusinessUnit(value: unknown) {
  return String(value ?? "").trim() === "2" ? "北區" : "中區";
}

export function parseEventSessionInput(
  input: Record<string, unknown>,
  catalog: ActivityDefinition[],
): EventSessionInput {
  if (input.role !== "staff") throw new Error("Staff role required");

  const employeeId = string(input.employeeId, "employeeId");
  const eventType = string(input.eventType, "eventType");
  const activity = catalog.find((item) => item.eventType === eventType && item.isActive);
  if (!activity) throw new Error("Unknown activity");

  const startAt = isoDate(input.startAt, "startAt");
  const endAt = optionalIsoDate(input.endAt, "endAt");
  if (endAt && Date.parse(endAt) < Date.parse(startAt)) throw new Error("endAt must be after startAt");

  return {
    role: "staff",
    employeeId,
    eventType,
    eventName: activity.name,
    startAt,
    endAt,
    location: boundedString(input.location, "location", 200),
    locationAddress: optionalBoundedString(input.locationAddress, "locationAddress", 300),
    description: optionalString(input.description),
  };
}

function string(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${name}`);
  return value.trim();
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function boundedString(value: unknown, name: string, maxLength: number) {
  const text = string(value, name);
  if (text.length > maxLength) throw new Error(`${name} must be at most ${maxLength} characters`);
  return text;
}

function optionalBoundedString(value: unknown, name: string, maxLength: number) {
  if (value == null || (typeof value === "string" && !value.trim())) return null;
  return boundedString(value, name, maxLength);
}

function isoDate(value: unknown, name: string) {
  const text = string(value, name);
  if (Number.isNaN(Date.parse(text))) throw new Error(`Invalid ${name}`);
  return text;
}

function optionalIsoDate(value: unknown, name: string) {
  if (value == null || value === "") return null;
  return isoDate(value, name);
}
