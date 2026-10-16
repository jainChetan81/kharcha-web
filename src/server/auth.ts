import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const COOKIE = "kharcha_session";
const MAX_AGE_S = 90 * 24 * 3600; // PWA on a phone: sign in rarely. Rotate SESSION_SECRET to log out everywhere.

const sign = (secret: string, payload: string) =>
  crypto.createHmac("sha256", secret).update(payload).digest("base64url");

function equal(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function makeSession(secret: string, now = Date.now()): string {
  const exp = String(Math.floor(now / 1000) + MAX_AGE_S);
  return `${exp}.${sign(secret, exp)}`;
}

export function validSession(secret: string, value: string | undefined, now = Date.now()): boolean {
  if (!value) return false;
  const [exp, mac] = value.split(".");
  if (!exp || !mac || !/^\d+$/.test(exp) || Number(exp) * 1000 < now) return false;
  return equal(mac, sign(secret, exp));
}

/** Format "scrypt:<salt hex>:<key hex>"; generate with the README one-liner. */
export async function checkPassword(stored: string, password: string): Promise<boolean> {
  const [kind, salt, key] = stored.split(":");
  if (kind !== "scrypt" || !salt || !key || password.length > 256) return false;
  const got = await scrypt(password, Buffer.from(salt, "hex"), 64);
  return equal(got.toString("hex"), key);
}

/** Only same-site relative paths, so ?next= can't bounce to another host. */
export const safeNext = (next: unknown) =>
  typeof next === "string" && /^\/(?![/\\])/.test(next) ? next : "/";

export function sessionCookie(value: string, maxAge = MAX_AGE_S): string {
  return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function readCookie(request: Request): string | undefined {
  for (const part of request.headers.get("cookie")?.split(/;\s*/) ?? [])
    if (part.startsWith(`${COOKIE}=`)) return part.slice(COOKIE.length + 1);
}

/** Config from env; undefined means login is not configured and the app fails closed. */
export function authConfig() {
  const secret = process.env.SESSION_SECRET;
  const hash = process.env.APP_PASSWORD_HASH;
  if (!secret || secret.length < 32 || !hash?.startsWith("scrypt:")) return undefined;
  return { secret, hash };
}

export const isSignedIn = (request: Request) => {
  const config = authConfig();
  return !!config && validSession(config.secret, readCookie(request));
};

/** Browser form posts must come from this site (login CSRF, forced logout). */
export function sameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";
  const origin = request.headers.get("origin");
  return !origin || new URL(origin).host === request.headers.get("host");
}

/** Bearer check for the mini's machine endpoints. 503 when INGEST_TOKEN is unset or short, 401 on a wrong token. */
export function ingestAuth(request: Request): Response | undefined {
  const expected = process.env.INGEST_TOKEN;
  const no = (error: string, status: number) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
  if (!expected || expected.length < 32) return no("Disabled on this server.", 503);
  const given = request.headers.get("authorization")?.replace(/^Bearer /i, "") ?? "";
  const digest = (value: string) => crypto.createHash("sha256").update(value).digest();
  if (!given || !crypto.timingSafeEqual(digest(given), digest(expected))) return no("Wrong ingest token.", 401);
}
