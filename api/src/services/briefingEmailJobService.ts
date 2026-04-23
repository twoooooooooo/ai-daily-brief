import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BlobServiceClient } from "@azure/storage-blob";
import type { BriefingEdition } from "../shared/contracts.js";
import { getBriefingStorageSettings, getEnvironmentSettings } from "../config/runtimeConfig.js";

export type BriefingEmailJobStatus = "running" | "completed" | "failed" | "skipped";

export interface BriefingEmailJobRecord {
  id: string;
  status: BriefingEmailJobStatus;
  updatedAt: string;
  date?: string;
  edition?: BriefingEdition;
  briefingId?: string;
  recipientCount?: number;
  reason?: string;
  error?: string;
}

interface PersistedBriefingEmailJobStoreFile {
  jobs: BriefingEmailJobRecord[];
}

const jobs = new Map<string, BriefingEmailJobRecord>();
const storageSettings = getBriefingStorageSettings();
const environment = getEnvironmentSettings();
const MAX_PERSISTED_EMAIL_JOBS = 30;
const DEFAULT_STORAGE_FILE = path.join(process.cwd(), ".data", "briefing-email-jobs.json");
const storageFilePath = environment.isProduction && process.env.HOME
  ? `${process.env.HOME}/data/briefing-email-jobs.json`
  : DEFAULT_STORAGE_FILE;
const storageBlobName = "briefing-email-jobs.json";

let persistedJobsCache: BriefingEmailJobRecord[] | undefined;

function nextTimestamp(): string {
  return new Date().toISOString();
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

function createEmptyStore(): PersistedBriefingEmailJobStoreFile {
  return { jobs: [] };
}

function cloneJob(record: BriefingEmailJobRecord): BriefingEmailJobRecord {
  return { ...record };
}

function normalizeJobs(records: BriefingEmailJobRecord[]): BriefingEmailJobRecord[] {
  return records
    .map(cloneJob)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_PERSISTED_EMAIL_JOBS);
}

async function getBlobClient() {
  if (!storageSettings.connectionString) {
    throw new Error("Briefing email job storage connection string is not configured.");
  }

  const serviceClient = BlobServiceClient.fromConnectionString(storageSettings.connectionString);
  const containerClient = serviceClient.getContainerClient(storageSettings.blobContainerName);
  await containerClient.createIfNotExists();
  return containerClient.getBlockBlobClient(storageBlobName);
}

async function loadBlobStore(): Promise<PersistedBriefingEmailJobStoreFile> {
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

  const parsed = JSON.parse(raw) as PersistedBriefingEmailJobStoreFile;
  return {
    jobs: Array.isArray(parsed.jobs) ? normalizeJobs(parsed.jobs) : [],
  };
}

async function saveBlobStore(store: PersistedBriefingEmailJobStoreFile): Promise<void> {
  const blobClient = await getBlobClient();
  const body = `${JSON.stringify({ jobs: normalizeJobs(store.jobs) }, null, 2)}\n`;
  await blobClient.upload(body, Buffer.byteLength(body), {
    blobHTTPHeaders: {
      blobContentType: "application/json; charset=utf-8",
    },
  });
}

async function loadFileStore(): Promise<PersistedBriefingEmailJobStoreFile> {
  try {
    const raw = await readFile(storageFilePath, "utf-8");
    if (!raw.trim()) {
      return createEmptyStore();
    }

    const parsed = JSON.parse(raw) as PersistedBriefingEmailJobStoreFile;
    return {
      jobs: Array.isArray(parsed.jobs) ? normalizeJobs(parsed.jobs) : [],
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return createEmptyStore();
    }

    throw error;
  }
}

async function saveFileStore(store: PersistedBriefingEmailJobStoreFile): Promise<void> {
  await mkdir(path.dirname(storageFilePath), { recursive: true });
  await writeFile(
    storageFilePath,
    `${JSON.stringify({ jobs: normalizeJobs(store.jobs) }, null, 2)}\n`,
    "utf-8",
  );
}

async function loadStore(): Promise<PersistedBriefingEmailJobStoreFile> {
  return shouldUseBlobStorage() ? loadBlobStore() : loadFileStore();
}

async function saveStore(store: PersistedBriefingEmailJobStoreFile): Promise<void> {
  if (shouldUseBlobStorage()) {
    await saveBlobStore(store);
    return;
  }

  await saveFileStore(store);
}

async function getPersistedJobs(): Promise<BriefingEmailJobRecord[]> {
  if (persistedJobsCache !== undefined) {
    return normalizeJobs(persistedJobsCache);
  }

  const store = await loadStore();
  persistedJobsCache = normalizeJobs(store.jobs);
  return normalizeJobs(persistedJobsCache);
}

async function persistJob(record: BriefingEmailJobRecord): Promise<void> {
  const existingJobs = await getPersistedJobs();
  const remaining = existingJobs.filter((item) => item.id !== record.id);
  persistedJobsCache = normalizeJobs([record, ...remaining]);
  await saveStore({ jobs: persistedJobsCache });
}

function cacheJob(record: BriefingEmailJobRecord): BriefingEmailJobRecord {
  jobs.set(record.id, record);
  void persistJob(record);
  return record;
}

function updateJob(
  jobId: string,
  patch: Partial<BriefingEmailJobRecord>,
  defaults: Partial<BriefingEmailJobRecord> = {},
): BriefingEmailJobRecord {
  const existing = jobs.get(jobId);
  const next: BriefingEmailJobRecord = {
    id: jobId,
    status: patch.status ?? existing?.status ?? defaults.status ?? "running",
    updatedAt: nextTimestamp(),
    date: patch.date ?? existing?.date ?? defaults.date,
    edition: patch.edition ?? existing?.edition ?? defaults.edition,
    briefingId: patch.briefingId ?? existing?.briefingId ?? defaults.briefingId,
    recipientCount: patch.recipientCount ?? existing?.recipientCount ?? defaults.recipientCount,
    reason: patch.reason ?? existing?.reason ?? defaults.reason,
    error: patch.error ?? existing?.error ?? defaults.error,
  };

  return cacheJob(next);
}

export function recordBriefingEmailJobStarted(input: {
  id: string;
  date?: string;
  edition?: BriefingEdition;
  briefingId?: string;
}): BriefingEmailJobRecord {
  return updateJob(input.id, {
    status: "running",
    date: input.date,
    edition: input.edition,
    briefingId: input.briefingId,
    recipientCount: undefined,
    reason: undefined,
    error: undefined,
  });
}

export function recordBriefingEmailJobCompleted(input: {
  id: string;
  date?: string;
  edition?: BriefingEdition;
  briefingId?: string;
  recipientCount?: number;
}): BriefingEmailJobRecord {
  return updateJob(input.id, {
    status: "completed",
    date: input.date,
    edition: input.edition,
    briefingId: input.briefingId,
    recipientCount: input.recipientCount,
    reason: undefined,
    error: undefined,
  });
}

export function recordBriefingEmailJobSkipped(input: {
  id: string;
  date?: string;
  edition?: BriefingEdition;
  briefingId?: string;
  reason?: string;
}): BriefingEmailJobRecord {
  return updateJob(input.id, {
    status: "skipped",
    date: input.date,
    edition: input.edition,
    briefingId: input.briefingId,
    recipientCount: undefined,
    reason: input.reason,
    error: undefined,
  });
}

export function recordBriefingEmailJobFailed(input: {
  id: string;
  date?: string;
  edition?: BriefingEdition;
  briefingId?: string;
  error?: string;
}): BriefingEmailJobRecord {
  return updateJob(input.id, {
    status: "failed",
    date: input.date,
    edition: input.edition,
    briefingId: input.briefingId,
    recipientCount: undefined,
    reason: undefined,
    error: input.error,
  });
}

export async function getLatestBriefingEmailJob(): Promise<BriefingEmailJobRecord | null> {
  const live = [...jobs.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  if (live) {
    return cloneJob(live);
  }

  const persisted = await getPersistedJobs();
  return persisted[0] ? cloneJob(persisted[0]) : null;
}

export async function listRecentBriefingEmailJobs(limit = 10): Promise<BriefingEmailJobRecord[]> {
  const combined = normalizeJobs([
    ...[...jobs.values()].map(cloneJob),
    ...(await getPersistedJobs()),
  ]);

  const seen = new Set<string>();
  return combined.filter((job) => {
    if (seen.has(job.id)) {
      return false;
    }
    seen.add(job.id);
    return true;
  }).slice(0, Math.max(1, limit));
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
