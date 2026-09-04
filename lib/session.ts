const encoder = new TextEncoder();

export const SESSION_COOKIE = "uktl_dashboard_session";
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

type SessionPayload = { exp: number; v: 1 };

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

export async function createSessionToken(secret: string, now = Date.now()): Promise<string> {
  const payload: SessionPayload = { exp: Math.floor(now / 1000) + SESSION_MAX_AGE_SECONDS, v: 1 };
  const encoded = base64Url(encoder.encode(JSON.stringify(payload)));
  return `${encoded}.${await sign(encoded, secret)}`;
}

export async function verifySessionToken(token: string | undefined, secret: string | undefined, now = Date.now()): Promise<boolean> {
  if (!token || !secret || secret.length < 32) return false;
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) return false;
  if (!safeEqual(signature, await sign(encoded, secret))) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(encoded))) as SessionPayload;
    return payload.v === 1 && Number.isInteger(payload.exp) && payload.exp > Math.floor(now / 1000);
  } catch {
    return false;
  }
}

export function readCookie(cookieHeader: string | null, name: string): string | undefined {
  return cookieHeader?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

export async function requestHasValidSession(request: Request): Promise<boolean> {
  return verifySessionToken(readCookie(request.headers.get("cookie"), SESSION_COOKIE), process.env.AUTH_SECRET);
}
