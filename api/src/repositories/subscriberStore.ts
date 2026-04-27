import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BlobServiceClient } from "@azure/storage-blob";
import { getEnvironmentSettings, getSubscriberStorageSettings } from "../config/runtimeConfig.js";

export interface SubscriberRecord {
  email: string;
  status: "pending" | "active" | "unsubscribed";
  createdAt: string;
  updatedAt: string;
  source: "website";
  confirmationEmailAttemptCount?: number;
  confirmationEmailLastAttemptAt?: string;
  confirmationEmailLastSentAt?: string;
  confirmationEmailNextRetryAt?: string;
  confirmationEmailLastError?: string;
}

export type SubscriberUpsertAction =
  | "created-pending"
  | "reactivated-pending"
  | "already-pending"
  | "created"
  | "reactivated"
  | "already-active"
  | "deactivated"
  | "already-unsubscribed"
  | "not-found";

export interface SubscriberUpsertResult {
  action: SubscriberUpsertAction;
  subscriber: SubscriberRecord | null;
}

interface PersistedSubscriberFile {
  subscribers: SubscriberRecord[];
}

const storageSettings = getSubscriberStorageSettings();
const environment = getEnvironmentSettings();
const DEFAULT_STORAGE_FILE = path.join(process.cwd(), ".data", "subscribers.json");
const storageFilePath = storageSettings.filePath || DEFAULT_STORAGE_FILE;
const CONFIRMATION_EMAIL_RETRY_DELAYS_MINUTES = [5, 15, 30, 60, 120, 240];

function isValidSubscriberEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim().toLowerCase());
}

function sanitizeSubscribers(subscribers: SubscriberRecord[]): SubscriberRecord[] {
  const deduped = new Map<string, SubscriberRecord>();

  for (const subscriber of subscribers) {
    const normalizedEmail = typeof subscriber.email === "string"
      ? subscriber.email.trim().toLowerCase()
      : "";

    if (!normalizedEmail || !isValidSubscriberEmail(normalizedEmail)) {
      continue;
    }

    const normalizedSubscriber: SubscriberRecord = {
      ...subscriber,
      email: normalizedEmail,
    };

    const existing = deduped.get(normalizedEmail);
    if (!existing) {
      deduped.set(normalizedEmail, normalizedSubscriber);
      continue;
    }

    deduped.set(
      normalizedEmail,
      existing.updatedAt >= normalizedSubscriber.updatedAt ? existing : normalizedSubscriber,
    );
  }

  return [...deduped.values()];
}

function createEmptyStore(): PersistedSubscriberFile {
  return { subscribers: [] };
}

function cloneRecord(record: SubscriberRecord): SubscriberRecord {
  return { ...record };
}

function resetConfirmationEmailState(record: SubscriberRecord): void {
  record.confirmationEmailAttemptCount = undefined;
  record.confirmationEmailLastAttemptAt = undefined;
  record.confirmationEmailLastSentAt = undefined;
  record.confirmationEmailNextRetryAt = undefined;
  record.confirmationEmailLastError = undefined;
}

function initializePendingConfirmationState(record: SubscriberRecord, nowIso: string): void {
  record.confirmationEmailAttemptCount = 0;
  record.confirmationEmailLastAttemptAt = undefined;
  record.confirmationEmailLastSentAt = undefined;
  record.confirmationEmailNextRetryAt = nowIso;
  record.confirmationEmailLastError = undefined;
}

function buildNextConfirmationRetryAt(attemptCount: number, nowIso: string): string {
  const delayMinutes = CONFIRMATION_EMAIL_RETRY_DELAYS_MINUTES[
    Math.min(Math.max(attemptCount - 1, 0), CONFIRMATION_EMAIL_RETRY_DELAYS_MINUTES.length - 1)
  ] ?? CONFIRMATION_EMAIL_RETRY_DELAYS_MINUTES[CONFIRMATION_EMAIL_RETRY_DELAYS_MINUTES.length - 1];
  const nextRetry = new Date(nowIso);
  nextRetry.setMinutes(nextRetry.getMinutes() + delayMinutes);
  return nextRetry.toISOString();
}

function shouldUseBlobStorage(): boolean {
  if (storageSettings.provider === "blob") {
    return true;
  }

  if (storageSettings.provider === "file") {
    return false;
  }

  return environment.isProduction && typeof storageSettings.connectionString === "string";
}

async function getBlobClient() {
  if (!storageSettings.connectionString) {
    throw new Error("Subscriber storage connection string is not configured.");
  }

  const serviceClient = BlobServiceClient.fromConnectionString(storageSettings.connectionString);
  const containerClient = serviceClient.getContainerClient(storageSettings.blobContainerName);
  await containerClient.createIfNotExists();
  return containerClient.getBlockBlobClient(storageSettings.blobName);
}

async function loadBlobStore(): Promise<PersistedSubscriberFile> {
  const blobClient = await getBlobClient();
  const exists = await blobClient.exists();
  if (!exists) {
    return createEmptyStore();
  }

  const download = await blobClient.download();
  const raw = await streamToString(download.readableStreamBody);
  if (!raw.trim()) {
    return createEmptyStore();
  }

  const parsed = JSON.parse(raw) as PersistedSubscriberFile;
  return {
    subscribers: sanitizeSubscribers(Array.isArray(parsed.subscribers) ? parsed.subscribers : []),
  };
}

async function saveBlobStore(store: PersistedSubscriberFile): Promise<void> {
  const blobClient = await getBlobClient();
  const body = `${JSON.stringify({
    subscribers: sanitizeSubscribers(store.subscribers),
  }, null, 2)}\n`;
  await blobClient.upload(body, Buffer.byteLength(body), {
    blobHTTPHeaders: {
      blobContentType: "application/json; charset=utf-8",
    },
  });
}

async function loadFileStore(): Promise<PersistedSubscriberFile> {
  try {
    const raw = await readFile(storageFilePath, "utf-8");
    if (!raw.trim()) {
      return createEmptyStore();
    }

    const parsed = JSON.parse(raw) as PersistedSubscriberFile;
    return {
      subscribers: sanitizeSubscribers(Array.isArray(parsed.subscribers) ? parsed.subscribers : []),
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return createEmptyStore();
    }

    throw error;
  }
}

async function saveFileStore(store: PersistedSubscriberFile): Promise<void> {
  await mkdir(path.dirname(storageFilePath), { recursive: true });
  await writeFile(storageFilePath, `${JSON.stringify({
    subscribers: sanitizeSubscribers(store.subscribers),
  }, null, 2)}\n`, "utf-8");
}

async function loadStore(): Promise<PersistedSubscriberFile> {
  return shouldUseBlobStorage() ? loadBlobStore() : loadFileStore();
}

async function saveStore(store: PersistedSubscriberFile): Promise<void> {
  if (shouldUseBlobStorage()) {
    await saveBlobStore(store);
    return;
  }

  await saveFileStore(store);
}

export async function upsertSubscriber(
  email: string,
  status: SubscriberRecord["status"],
): Promise<SubscriberUpsertResult> {
  const store = await loadStore();
  const normalizedEmail = email.trim().toLowerCase();
  const now = new Date().toISOString();
  const existing = store.subscribers.find((subscriber) => subscriber.email === normalizedEmail);

  if (existing) {
    if (existing.status === status) {
      if (status === "pending") {
        existing.updatedAt = now;
        existing.confirmationEmailNextRetryAt = now;
        await saveStore(store);
        return {
          action: "already-pending",
          subscriber: cloneRecord(existing),
        };
      }

      return {
        action: status === "active" ? "already-active" : "already-unsubscribed",
        subscriber: cloneRecord(existing),
      };
    }

    existing.status = status;
    existing.updatedAt = now;
    if (status === "pending") {
      initializePendingConfirmationState(existing, now);
    } else {
      resetConfirmationEmailState(existing);
    }
    await saveStore(store);
    return {
      action: status === "pending"
        ? "reactivated-pending"
        : status === "active"
          ? "reactivated"
          : "deactivated",
      subscriber: cloneRecord(existing),
    };
  }

  if (status === "unsubscribed") {
    return {
      action: "not-found",
      subscriber: null,
    };
  }

  const nextRecord: SubscriberRecord = {
    email: normalizedEmail,
    status,
    createdAt: now,
    updatedAt: now,
    source: "website",
  };
  if (status === "pending") {
    initializePendingConfirmationState(nextRecord, now);
  }
  store.subscribers.push(nextRecord);
  await saveStore(store);
  return {
    action: status === "pending" ? "created-pending" : "created",
    subscriber: cloneRecord(nextRecord),
  };
}

export async function listActiveSubscribers(): Promise<SubscriberRecord[]> {
  const store = await loadStore();
  return store.subscribers
    .filter((subscriber) => subscriber.status === "active")
    .sort((left, right) => left.email.localeCompare(right.email))
    .map(cloneRecord);
}

export async function getSubscriberByEmail(email: string): Promise<SubscriberRecord | null> {
  const store = await loadStore();
  const normalizedEmail = email.trim().toLowerCase();
  const subscriber = store.subscribers.find((item) => item.email === normalizedEmail);
  return subscriber ? cloneRecord(subscriber) : null;
}

export async function recordSubscriberConfirmationEmailAttempt(
  email: string,
  input: { sent: boolean; error?: string },
): Promise<SubscriberRecord | null> {
  const store = await loadStore();
  const normalizedEmail = email.trim().toLowerCase();
  const subscriber = store.subscribers.find((item) => item.email === normalizedEmail);
  if (!subscriber || subscriber.status !== "pending") {
    return subscriber ? cloneRecord(subscriber) : null;
  }

  const now = new Date().toISOString();
  const nextAttemptCount = (subscriber.confirmationEmailAttemptCount ?? 0) + 1;
  subscriber.updatedAt = now;
  subscriber.confirmationEmailAttemptCount = nextAttemptCount;
  subscriber.confirmationEmailLastAttemptAt = now;

  if (input.sent) {
    subscriber.confirmationEmailLastSentAt = now;
    subscriber.confirmationEmailNextRetryAt = undefined;
    subscriber.confirmationEmailLastError = undefined;
  } else {
    subscriber.confirmationEmailLastSentAt = undefined;
    subscriber.confirmationEmailNextRetryAt = buildNextConfirmationRetryAt(nextAttemptCount, now);
    subscriber.confirmationEmailLastError = input.error?.trim() || "Confirmation email delivery failed.";
  }

  await saveStore(store);
  return cloneRecord(subscriber);
}

export async function listDuePendingConfirmationSubscribers(limit = 25): Promise<SubscriberRecord[]> {
  const store = await loadStore();
  const now = Date.now();

  return store.subscribers
    .filter((subscriber) => {
      if (subscriber.status !== "pending") {
        return false;
      }

      if (subscriber.confirmationEmailLastSentAt) {
        return false;
      }

      const nextRetryAt = subscriber.confirmationEmailNextRetryAt ?? subscriber.updatedAt;
      const parsed = new Date(nextRetryAt);
      if (Number.isNaN(parsed.getTime())) {
        return true;
      }

      return parsed.getTime() <= now;
    })
    .sort((left, right) => {
      const leftKey = left.confirmationEmailNextRetryAt ?? left.updatedAt;
      const rightKey = right.confirmationEmailNextRetryAt ?? right.updatedAt;
      return leftKey.localeCompare(rightKey);
    })
    .slice(0, Math.max(1, limit))
    .map(cloneRecord);
}

export async function getSubscriberStats(): Promise<{
  active: number;
  pending: number;
  total: number;
  provider: "blob" | "file";
  pendingConfirmationEmailCount: number;
  pendingConfirmationRetryDueCount: number;
}> {
  const store = await loadStore();
  const active = store.subscribers.filter((subscriber) => subscriber.status === "active").length;
  const pending = store.subscribers.filter((subscriber) => subscriber.status === "pending").length;
  const now = Date.now();
  const pendingSubscribers = store.subscribers.filter((subscriber) => subscriber.status === "pending");
  const pendingConfirmationEmailCount = pendingSubscribers.filter((subscriber) => !subscriber.confirmationEmailLastSentAt).length;
  const pendingConfirmationRetryDueCount = pendingSubscribers.filter((subscriber) => {
    if (subscriber.confirmationEmailLastSentAt) {
      return false;
    }

    const nextRetryAt = subscriber.confirmationEmailNextRetryAt ?? subscriber.updatedAt;
    const parsed = new Date(nextRetryAt);
    return Number.isNaN(parsed.getTime()) || parsed.getTime() <= now;
  }).length;
  return {
    active,
    pending,
    total: store.subscribers.length,
    provider: shouldUseBlobStorage() ? "blob" : "file",
    pendingConfirmationEmailCount,
    pendingConfirmationRetryDueCount,
  };
}

async function streamToString(stream: NodeJS.ReadableStream | null | undefined): Promise<string> {
  if (!stream) {
    return "";
  }

  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf-8");
}
