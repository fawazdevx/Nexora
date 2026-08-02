import {createHmac, timingSafeEqual} from "node:crypto";
import {isAddress} from "viem";
import {config} from "./config.js";

export type AuthContext = {
  address?: string;
  tokenValid: boolean;
};

const MAX_BODY_BYTES = 256_000;
const MAX_TEXT_LENGTH = 5_000;
const MAX_URL_LENGTH = 2_048;
const MAX_USDC_AMOUNT = 1_000_000;
const MAX_EVM_CHAIN_ID = 4_294_967_295;
const nonceTtlMs = 5 * 60 * 1000;
const nonces = new Map<string, {address: string; expiresAt: number}>();

export function securityHeaders() {
  return {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "cross-origin-resource-policy": "cross-origin"
  };
}

export function corsOrigin(origin?: string) {
  const allowed = allowedOrigins();
  if (allowed.length === 0) return "*";
  if (origin && allowed.includes(origin)) return origin;
  return allowed[0] ?? "null";
}

export function allowedOrigins() {
  return (process.env.CORS_ALLOWED_ORIGINS ?? process.env.NEXORA_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((item) => item.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

export function assertAllowedOrigin(origin?: string) {
  const allowed = allowedOrigins();
  if (allowed.length === 0 || !origin) return;
  if (!allowed.includes(origin.replace(/\/+$/, ""))) throw new Error("origin is not allowed");
}

export function assertBodySize(raw: string) {
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    const error = new Error("request body is too large");
    (error as Error & {status?: number}).status = 413;
    throw error;
  }
}

export function issueAuthNonce(addressValue: string) {
  const address = requiredAddress(addressValue, "address");
  const nonce = `nexora:${address}:${crypto.randomUUID()}`;
  nonces.set(nonce, {address: address.toLowerCase(), expiresAt: Date.now() + nonceTtlMs});
  cleanupNonces();
  return nonce;
}

export async function verifyAuthSignature(input: {address: string; nonce: string; signature?: string}) {
  const address = requiredAddress(input.address, "address");
  const nonce = requiredLimitedString(input.nonce, "nonce", 240);
  const record = nonces.get(nonce);
  if (!record || record.address !== address.toLowerCase() || record.expiresAt < Date.now()) {
    throw new Error("auth nonce is invalid or expired");
  }
  nonces.delete(nonce);

  if (input.signature) {
    const {verifyMessage} = await import("viem");
    const valid = await verifyMessage({
      address: address as `0x${string}`,
      message: nonce,
      signature: input.signature as `0x${string}`
    });
    if (!valid) throw new Error("auth signature is invalid");
  } else if (config.security.requireSignedAuth) {
    throw new Error("auth signature is required");
  }

  return signToken({address, nonce});
}

export function authContext(authorization?: string): AuthContext {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return {tokenValid: false};
  const parsed = verifyToken(token);
  return parsed ? {address: parsed.address, tokenValid: true} : {tokenValid: false};
}

export function assertTokenAddress(auth: AuthContext, expected: string, label = "wallet") {
  const address = requiredAddress(expected, label);
  if (!config.security.requireSignedAuth) return address;
  if (!auth.tokenValid || auth.address?.toLowerCase() !== address.toLowerCase()) {
    throw new Error(`${label} authentication required`);
  }
  return address;
}

export function assertSharedSecret(actual: string | undefined, expected: string, label: string) {
  if (!expected) return;
  if (!actual || !safeEqual(actual, expected)) throw new Error(`${label} secret is invalid`);
}

export function requiredAddress(value: unknown, label: string) {
  if (typeof value !== "string" || !isAddress(value)) throw new Error(`${label} must be a valid EVM address`);
  return value;
}

export function optionalAddress(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredAddress(value, label);
}

export function requiredTxHash(value: unknown, label: string) {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(value)) throw new Error(`${label} must be a valid transaction hash`);
  return value;
}

export function optionalTxHash(value: unknown, label = "txHash") {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredTxHash(value, label);
}

export function requiredBytes32(value: unknown, label: string) {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(value)) throw new Error(`${label} must be bytes32`);
  return value;
}

export function requiredLimitedString(value: unknown, label: string, max = MAX_TEXT_LENGTH) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is required`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new Error(`${label} is too long`);
  return trimmed;
}

export function optionalLimitedString(value: unknown, label: string, max = MAX_TEXT_LENGTH) {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredLimitedString(value, label, max);
}

export function requiredUsdcAmount(value: unknown, label: string, max = MAX_USDC_AMOUNT) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) throw new Error(`${label} must be greater than zero`);
  if (numberValue > max) throw new Error(`${label} exceeds the allowed limit`);
  return Math.round(numberValue * 1_000_000) / 1_000_000;
}

export function nonNegativeUsdcAmount(value: unknown, label: string, max = MAX_USDC_AMOUNT) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) throw new Error(`${label} must be zero or greater`);
  if (numberValue > max) throw new Error(`${label} exceeds the allowed limit`);
  return Math.round(numberValue * 1_000_000) / 1_000_000;
}

export function optionalBps(value: unknown, fallback: number, max: number) {
  if (value === undefined || value === null || value === "") return fallback;
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 0 || numberValue > max) throw new Error("basis points value is invalid");
  return numberValue;
}

export function requiredPositiveInteger(value: unknown, label: string, max = 10_000) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(numberValue) || numberValue <= 0 || numberValue > max) throw new Error(`${label} must be a positive integer`);
  return numberValue;
}

export function requiredChainId(value: unknown, label = "chainId") {
  return requiredPositiveInteger(value, label, MAX_EVM_CHAIN_ID);
}

export function optionalChainId(value: unknown, label = "chainId") {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredChainId(value, label);
}

export function addressArray(value: unknown, label: string, max = 25) {
  if (!Array.isArray(value)) return [];
  if (value.length > max) throw new Error(`${label} has too many entries`);
  return [...new Set(value.map((item, index) => requiredAddress(item, `${label}[${index}]`).toLowerCase()))];
}

export function safeHttpUrl(value: unknown, label = "url") {
  const raw = requiredLimitedString(value, label, MAX_URL_LENGTH);
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(withProtocol);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error(`${label} must use http or https`);
  if (isPrivateHostname(parsed.hostname)) throw new Error(`${label} host is not allowed`);
  parsed.username = "";
  parsed.password = "";
  return parsed.toString();
}

export function assertJsonObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function cleanupNonces() {
  const now = Date.now();
  for (const [nonce, record] of nonces.entries()) {
    if (record.expiresAt < now) nonces.delete(nonce);
  }
}

function signToken(input: {address: string; nonce: string}) {
  const payload = {
    address: input.address,
    nonce: input.nonce,
    exp: Math.floor(Date.now() / 1000) + 60 * 60
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = hmac(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function verifyToken(token: string) {
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(signature, hmac(payload))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {address?: string; exp?: number};
    if (!parsed.address || !isAddress(parsed.address) || !parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return {address: parsed.address};
  } catch {
    return null;
  }
}

function hmac(value: string) {
  return createHmac("sha256", config.security.authSecret).update(value).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function isPrivateHostname(hostname: string) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "0.0.0.0" || host === "::1") return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  return false;
}
