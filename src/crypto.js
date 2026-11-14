import { appError } from "./http.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const keyCache = new Map();

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function randomToken(byteLength = 32) {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toBase64Url(new Uint8Array(digest));
}

async function encryptionKey(env) {
  const secret = env.TOKEN_ENCRYPTION_KEY;
  if (!secret) throw appError("Add TOKEN_ENCRYPTION_KEY (32 random bytes, base64) to this Worker.", 503);
  if (keyCache.has(secret)) return keyCache.get(secret);
  let raw;
  try {
    raw = fromBase64(secret);
  } catch {
    raw = new Uint8Array();
  }
  if (raw.length !== 32) throw appError("TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as base64.", 503);
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  keyCache.set(secret, key);
  return key;
}

export function hasEncryptionKey(env) {
  if (!env.TOKEN_ENCRYPTION_KEY) return false;
  try {
    return fromBase64(env.TOKEN_ENCRYPTION_KEY).length === 32;
  } catch {
    return false;
  }
}

// Stored as "v1.<iv>.<ciphertext>" so the format can change later.
export async function encryptSecret(env, plaintext) {
  if (!plaintext) return "";
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(env), encoder.encode(plaintext));
  return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptSecret(env, stored) {
  if (!stored) return "";
  const [version, iv, ciphertext] = String(stored).split(".");
  if (version !== "v1" || !iv || !ciphertext) throw appError("A stored provider token is unreadable. Reconnect the provider.", 401);
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, await encryptionKey(env), fromBase64(ciphertext));
    return decoder.decode(plaintext);
  } catch (error) {
    if (error.status) throw error;
    throw appError("A stored provider token could not be decrypted. Reconnect the provider.", 401);
  }
}
