import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const COOKIE = "stopwatch_session";
const SESSION_SECONDS = 7 * 24 * 60 * 60;

function equal(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

function signature(expires: string): string {
  return createHmac("sha256", process.env.APP_SESSION_SECRET ?? "")
    .update(expires).digest("hex");
}

export function configurationError(): string | null {
  if (!process.env.DATABASE_URL) return "DATABASE_URL is required";
  if (!process.env.APP_PASSWORD && process.env.NODE_ENV === "production") {
    return "APP_PASSWORD is required in production";
  }
  if (process.env.APP_PASSWORD && !process.env.APP_SESSION_SECRET) {
    return "APP_SESSION_SECRET is required when APP_PASSWORD is set";
  }
  return null;
}

export function authenticated(request: Request): boolean {
  if (!process.env.APP_PASSWORD) return true;
  const cookie = request.headers.get("cookie")?.split(";")
    .map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
  const token = cookie?.slice(COOKIE.length + 1) ?? "";
  const [expires, suppliedSignature, extra] = token.split(".");
  if (!expires || !suppliedSignature || extra || !/^\d+$/.test(expires)) return false;
  if (Number(expires) <= Math.floor(Date.now() / 1000)) return false;
  return equal(suppliedSignature, signature(expires));
}

export function session(request: Request) {
  return { authenticated: authenticated(request), enabled: Boolean(process.env.APP_PASSWORD) };
}

export function login(password: string): { cookie: string; session: { authenticated: boolean; enabled: boolean } } | null {
  if (!process.env.APP_PASSWORD || !equal(password, process.env.APP_PASSWORD)) return null;
  const expires = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return {
    cookie: `${COOKIE}=${expires}.${signature(expires)}; Max-Age=${SESSION_SECONDS}; Path=/api; HttpOnly; SameSite=Strict${secure}`,
    session: { authenticated: true, enabled: true },
  };
}

export function logoutCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=; Max-Age=0; Path=/api; HttpOnly; SameSite=Strict${secure}`;
}
