import type { Db } from "../db/client";

/** detectors job (§8), nightly. Owner: Insights+AI agent. */
export async function runDetectors(_db?: Db): Promise<{ found: number }> {
  return { found: 0 };
}

/** digest job (§8), Monday 07:00 IST. Owner: Insights+AI agent. */
export async function runDigest(_db?: Db): Promise<{ written: boolean }> {
  return { written: false };
}
