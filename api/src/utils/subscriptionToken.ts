import { createHmac, timingSafeEqual } from "node:crypto";
import { getSubscriptionSecuritySettings } from "../config/runtimeConfig.js";

export type SubscriptionTokenAction = "confirm-subscription" | "confirm-unsubscribe";

interface SubscriptionTokenPayload {
  email: string;
  action: SubscriptionTokenAction;
  exp: number;
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64url");
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf-8");
}

function getTokenSecret(): string {
  const settings = getSubscriptionSecuritySettings();
  if (!settings.tokenSecret) {
    throw new Error("Subscription token secret is not configured.");
  }

  return settings.tokenSecret;
}

function signPayload(encodedPayload: string): string {
  return createHmac("sha256", getTokenSecret()).update(encodedPayload).digest("base64url");
}

export function createSubscriptionToken(email: string, action: SubscriptionTokenAction): string {
  const settings = getSubscriptionSecuritySettings();
  const payload: SubscriptionTokenPayload = {
    email: email.trim().toLowerCase(),
    action,
    exp: Date.now() + settings.tokenTtlHours * 60 * 60 * 1000,
  };

  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = signPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifySubscriptionToken(token: string, expectedAction: SubscriptionTokenAction): { email: string } {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    throw new Error("Invalid subscription token.");
  }

  const expectedSignature = signPayload(encodedPayload);
  const providedSignature = Buffer.from(signature, "utf-8");
  const computedSignature = Buffer.from(expectedSignature, "utf-8");

  if (
    providedSignature.length !== computedSignature.length
    || !timingSafeEqual(providedSignature, computedSignature)
  ) {
    throw new Error("Invalid subscription token signature.");
  }

  let payload: SubscriptionTokenPayload;
  try {
    payload = JSON.parse(decodeBase64Url(encodedPayload)) as SubscriptionTokenPayload;
  } catch {
    throw new Error("Invalid subscription token payload.");
  }

  if (payload.action !== expectedAction) {
    throw new Error("Subscription token action mismatch.");
  }

  if (typeof payload.email !== "string" || !payload.email.trim()) {
    throw new Error("Subscription token email is invalid.");
  }

  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp < Date.now()) {
    throw new Error("Subscription token has expired.");
  }

  return {
    email: payload.email.trim().toLowerCase(),
  };
}
