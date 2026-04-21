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

function createEmptyStore(): PersistedSubscriberFile {
  return { subscribers: [] };
}

function cloneRecord(record: SubscriberRecord): SubscriberRecord {
  return { ...record };
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
  return raw.trim() ? JSON.parse(raw) as PersistedSubscriberFile : createEmptyStore();
}

async function saveBlobStore(store: PersistedSubscriberFile): Promise<void> {
  const blobClient = await getBlobClient();
  const body = `${JSON.stringify(store, null, 2)}\n`;
  await blobClient.upload(body, Buffer.byteLength(body), {
    blobHTTPHeaders: {
      blobContentType: "application/json; charset=utf-8",
    },
  });
}

async function loadFileStore(): Promise<PersistedSubscriberFile> {
  try {
    const raw = await readFile(storageFilePath, "utf-8");
    return raw.trim() ? JSON.parse(raw) as PersistedSubscriberFile : createEmptyStore();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return createEmptyStore();
    }

    throw error;
  }
}

async function saveFileStore(store: PersistedSubscriberFile): Promise<void> {
  await mkdir(path.dirname(storageFilePath), { recursive: true });
  await writeFile(storageFilePath, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
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

export async function getSubscriberStats(): Promise<{ active: number; pending: number; total: number; provider: "blob" | "file" }> {
  const store = await loadStore();
  const active = store.subscribers.filter((subscriber) => subscriber.status === "active").length;
  const pending = store.subscribers.filter((subscriber) => subscriber.status === "pending").length;
  return {
    active,
    pending,
    total: store.subscribers.length,
    provider: shouldUseBlobStorage() ? "blob" : "file",
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
