import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BlobServiceClient } from "@azure/storage-blob";
import type { Briefing, BriefingEdition } from "../shared/contracts.js";
import { getBriefingStorageSettings, getEnvironmentSettings } from "../config/runtimeConfig.js";
import { createCorrelationId, createLogger, type LogContext } from "../utils/logger.js";
import { runDailyBriefingPipeline } from "./dailyBriefingPipeline.js";

export type DailyBriefingJobStatus = "queued" | "running" | "completed" | "failed";
export type DailyBriefingJobTrigger = "manual" | "scheduled";

export interface DailyBriefingJobRecord {
  id: string;
  status: DailyBriefingJobStatus;
  createdAt: string;
  updatedAt: string;
  date?: string;
  edition?: BriefingEdition;
  overwrite: boolean;
  briefingId?: string;
  error?: string;
  trigger: DailyBriefingJobTrigger;
}

interface StartDailyBriefingJobInput {
  date?: string;
  edition?: BriefingEdition;
  overwrite?: boolean;
  logContext?: LogContext;
}

interface PersistedDailyBriefingJobStoreFile {
  jobs: DailyBriefingJobRecord[];
}

const logger = createLogger("daily-briefing-job");
const jobs = new Map<string, DailyBriefingJobRecord>();
const storageSettings = getBriefingStorageSettings();
const environment = getEnvironmentSettings();
const MAX_PERSISTED_JOBS = 20;
const DEFAULT_STORAGE_FILE = path.join(process.cwd(), ".data", "daily-briefing-jobs.json");
const storageFilePath = environment.isProduction && process.env.HOME
  ? `${process.env.HOME}/data/daily-briefing-jobs.json`
  : DEFAULT_STORAGE_FILE;
const storageBlobName = "daily-briefing-jobs.json";

let persistedJobsCache: DailyBriefingJobRecord[] | undefined;

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

function createEmptyStore(): PersistedDailyBriefingJobStoreFile {
  return { jobs: [] };
}

function cloneJob(record: DailyBriefingJobRecord): DailyBriefingJobRecord {
  return { ...record };
}

function normalizeJobs(records: DailyBriefingJobRecord[]): DailyBriefingJobRecord[] {
  return records
    .map(cloneJob)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_PERSISTED_JOBS);
}

async function getBlobClient() {
  if (!storageSettings.connectionString) {
    throw new Error("Daily briefing job storage connection string is not configured.");
  }

  const serviceClient = BlobServiceClient.fromConnectionString(storageSettings.connectionString);
  const containerClient = serviceClient.getContainerClient(storageSettings.blobContainerName);
  await containerClient.createIfNotExists();
  return containerClient.getBlockBlobClient(storageBlobName);
}

async function loadBlobStore(): Promise<PersistedDailyBriefingJobStoreFile> {
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

  const parsed = JSON.parse(raw) as PersistedDailyBriefingJobStoreFile;
  return {
    jobs: Array.isArray(parsed.jobs) ? normalizeJobs(parsed.jobs) : [],
  };
}

async function saveBlobStore(store: PersistedDailyBriefingJobStoreFile): Promise<void> {
  const blobClient = await getBlobClient();
  const body = `${JSON.stringify({ jobs: normalizeJobs(store.jobs) }, null, 2)}\n`;
  await blobClient.upload(body, Buffer.byteLength(body), {
    blobHTTPHeaders: {
      blobContentType: "application/json; charset=utf-8",
    },
  });
}

async function loadFileStore(): Promise<PersistedDailyBriefingJobStoreFile> {
  try {
    const raw = await readFile(storageFilePath, "utf-8");
    if (!raw.trim()) {
      return createEmptyStore();
    }

    const parsed = JSON.parse(raw) as PersistedDailyBriefingJobStoreFile;
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

async function saveFileStore(store: PersistedDailyBriefingJobStoreFile): Promise<void> {
  await mkdir(path.dirname(storageFilePath), { recursive: true });
  await writeFile(
    storageFilePath,
    `${JSON.stringify({ jobs: normalizeJobs(store.jobs) }, null, 2)}\n`,
    "utf-8",
  );
}

async function loadStore(): Promise<PersistedDailyBriefingJobStoreFile> {
  return shouldUseBlobStorage() ? loadBlobStore() : loadFileStore();
}

async function saveStore(store: PersistedDailyBriefingJobStoreFile): Promise<void> {
  if (shouldUseBlobStorage()) {
    await saveBlobStore(store);
    return;
  }

  await saveFileStore(store);
}

async function getPersistedJobs(): Promise<DailyBriefingJobRecord[]> {
  if (persistedJobsCache !== undefined) {
    return normalizeJobs(persistedJobsCache);
  }

  const store = await loadStore();
  persistedJobsCache = normalizeJobs(store.jobs);
  return normalizeJobs(persistedJobsCache);
}

async function persistJob(record: DailyBriefingJobRecord): Promise<void> {
  const existingJobs = await getPersistedJobs();
  const remaining = existingJobs.filter((item) => item.id !== record.id);
  persistedJobsCache = normalizeJobs([record, ...remaining]);
  await saveStore({ jobs: persistedJobsCache });
}

function cacheJob(record: DailyBriefingJobRecord): DailyBriefingJobRecord {
  jobs.set(record.id, record);
  void persistJob(record);
  return record;
}

function updateJob(
  jobId: string,
  patch: Partial<DailyBriefingJobRecord>,
  defaults: Partial<DailyBriefingJobRecord> = {},
): DailyBriefingJobRecord {
  const existing = jobs.get(jobId);
  const now = nextTimestamp();
  const next: DailyBriefingJobRecord = {
    id: jobId,
    status: patch.status ?? existing?.status ?? defaults.status ?? "queued",
    createdAt: existing?.createdAt ?? defaults.createdAt ?? now,
    updatedAt: now,
    overwrite: patch.overwrite ?? existing?.overwrite ?? defaults.overwrite ?? false,
    trigger: patch.trigger ?? existing?.trigger ?? defaults.trigger ?? "manual",
    date: patch.date ?? existing?.date ?? defaults.date,
    edition: patch.edition ?? existing?.edition ?? defaults.edition,
    briefingId: patch.briefingId ?? existing?.briefingId ?? defaults.briefingId,
    error: patch.error ?? existing?.error ?? defaults.error,
  };

  return cacheJob(next);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = "cause" in error ? (error as Error & { cause?: unknown }).cause : undefined;
    const causeMessage = cause instanceof Error ? cause.message : undefined;
    return causeMessage && causeMessage !== error.message
      ? `${error.message}: ${causeMessage}`
      : error.message;
  }

  return "Unknown job failure.";
}

export function recordDailyBriefingJobQueued(input: {
  id: string;
  date?: string;
  edition?: BriefingEdition;
  overwrite?: boolean;
  trigger?: DailyBriefingJobTrigger;
}): DailyBriefingJobRecord {
  return updateJob(
    input.id,
    {
      status: "queued",
      date: input.date,
      edition: input.edition,
      overwrite: input.overwrite === true,
      trigger: input.trigger ?? "manual",
      error: undefined,
    },
    {
      createdAt: nextTimestamp(),
    },
  );
}

export function recordDailyBriefingJobStarted(input: {
  id: string;
  date?: string;
  edition?: BriefingEdition;
  overwrite?: boolean;
  trigger?: DailyBriefingJobTrigger;
}): DailyBriefingJobRecord {
  return updateJob(
    input.id,
    {
      status: "running",
      date: input.date,
      edition: input.edition,
      overwrite: input.overwrite === true,
      trigger: input.trigger ?? "manual",
      error: undefined,
    },
    {
      createdAt: nextTimestamp(),
    },
  );
}

export function recordDailyBriefingJobCompleted(input: {
  id: string;
  date?: string;
  edition?: BriefingEdition;
  overwrite?: boolean;
  briefingId?: string;
  trigger?: DailyBriefingJobTrigger;
}): DailyBriefingJobRecord {
  return updateJob(input.id, {
    status: "completed",
    date: input.date,
    edition: input.edition,
    overwrite: input.overwrite === true,
    briefingId: input.briefingId,
    trigger: input.trigger ?? "manual",
    error: undefined,
  });
}

export function recordDailyBriefingJobFailed(input: {
  id: string;
  date?: string;
  edition?: BriefingEdition;
  overwrite?: boolean;
  briefingId?: string;
  error?: string;
  trigger?: DailyBriefingJobTrigger;
}): DailyBriefingJobRecord {
  return updateJob(input.id, {
    status: "failed",
    date: input.date,
    edition: input.edition,
    overwrite: input.overwrite === true,
    briefingId: input.briefingId,
    error: input.error,
    trigger: input.trigger ?? "manual",
  });
}

export function startDailyBriefingJob(input: StartDailyBriefingJobInput = {}): DailyBriefingJobRecord {
  const jobId = createCorrelationId("briefing-job");
  const jobRecord = recordDailyBriefingJobQueued({
    id: jobId,
    date: input.date,
    edition: input.edition,
    overwrite: input.overwrite,
    trigger: "manual",
  });

  void (async () => {
    const jobLogContext: LogContext = {
      ...input.logContext,
      correlationId: jobId,
      operationName: "runDailyBriefingJob",
      component: "job",
    };

    recordDailyBriefingJobStarted({
      id: jobId,
      date: input.date,
      edition: input.edition,
      overwrite: input.overwrite,
      trigger: "manual",
    });
    logger.child(jobLogContext).info("Started background daily briefing job.", {
      date: input.date,
      edition: input.edition,
      overwrite: input.overwrite === true,
    });

    try {
      const briefing: Briefing = await runDailyBriefingPipeline({
        date: input.date,
        edition: input.edition,
        overwrite: input.overwrite,
        logContext: jobLogContext,
      });

      recordDailyBriefingJobCompleted({
        id: jobId,
        date: briefing.date,
        edition: briefing.edition,
        overwrite: input.overwrite,
        briefingId: briefing.id,
        trigger: "manual",
      });

      logger.child(jobLogContext).info("Completed background daily briefing job.", {
        briefingId: briefing.id,
        date: briefing.date,
        edition: briefing.edition,
      });
    } catch (error) {
      const message = toErrorMessage(error);
      recordDailyBriefingJobFailed({
        id: jobId,
        date: input.date,
        edition: input.edition,
        overwrite: input.overwrite,
        error: message,
        trigger: "manual",
      });

      logger.child(jobLogContext).exception("Background daily briefing job failed.", error, {
        date: input.date,
      });
    }
  })();

  return jobRecord;
}

export function getDailyBriefingJob(jobId: string): DailyBriefingJobRecord | null {
  return jobs.get(jobId) ?? null;
}

export async function getLatestDailyBriefingJob(): Promise<DailyBriefingJobRecord | null> {
  const inMemoryLatest = [...jobs.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  if (inMemoryLatest) {
    return cloneJob(inMemoryLatest);
  }

  const persistedJobs = await getPersistedJobs();
  return persistedJobs[0] ? cloneJob(persistedJobs[0]) : null;
}

export async function listRecentDailyBriefingJobs(limit = MAX_PERSISTED_JOBS): Promise<DailyBriefingJobRecord[]> {
  const merged = new Map<string, DailyBriefingJobRecord>();

  for (const job of await getPersistedJobs()) {
    merged.set(job.id, cloneJob(job));
  }

  for (const job of jobs.values()) {
    const existing = merged.get(job.id);
    if (!existing || job.updatedAt > existing.updatedAt) {
      merged.set(job.id, cloneJob(job));
    }
  }

  return [...merged.values()]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit)
    .map(cloneJob);
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
