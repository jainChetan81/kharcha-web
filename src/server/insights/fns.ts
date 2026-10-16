// Insights, digest, Ask. Owner: Insights+AI agent.
import { createServerFn } from "@tanstack/react-start";

export type DigestLine = { pre: string; num: string; post: string; href: string };
export type Digest =
  | { status: "ok"; weekStart: string; label: string; lines: DigestLine[] }
  | { status: "unavailable" }
  | { status: "none" };

/** CONTRACT (used by Today): this week's digest, or why it is missing. */
export const getDigest = createServerFn({ method: "GET" }).handler(async (): Promise<Digest> => ({ status: "none" }));
