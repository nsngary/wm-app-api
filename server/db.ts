import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as sql from "mssql";

type DbName = "teamup" | "wm";

let teamupPool: sql.ConnectionPool | null = null;
let wmPool: sql.ConnectionPool | null = null;

loadDotEnv();

export function apiHost() {
  return process.env.TEAMUP_API_HOST || "0.0.0.0";
}

export function apiPort() {
  return Number(process.env.TEAMUP_API_PORT || 8787);
}

export async function getPool(db: DbName) {
  if (db === "teamup") {
    teamupPool ??= await new sql.ConnectionPool(config(process.env.TEAMUP_DB || "TeamUp")).connect();
    return teamupPool;
  }

  wmPool ??= await new sql.ConnectionPool(config(process.env.WM_DB || "WM")).connect();
  return wmPool;
}

export { sql };

function config(database: string): sql.config {
  return {
    server: process.env.TEAMUP_SQL_SERVER || "192.168.0.149",
    port: Number(process.env.TEAMUP_SQL_PORT || 1433),
    database,
    user: process.env.TEAMUP_SQL_USER || "sa",
    password: process.env.TEAMUP_SQL_PASSWORD || "",
    options: {
      encrypt: bool(process.env.TEAMUP_SQL_ENCRYPT, true),
      trustServerCertificate: bool(process.env.TEAMUP_SQL_TRUST_CERT, true),
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30_000,
    },
  };
}

function bool(value: string | undefined, fallback: boolean) {
  if (value == null) return fallback;
  return ["1", "true", "yes"].includes(value.toLowerCase());
}

function loadDotEnv() {
  const file = path.join(process.cwd(), ".env");
  if (!existsSync(file)) return;

  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    process.env[key] ??= value;
  }
}
