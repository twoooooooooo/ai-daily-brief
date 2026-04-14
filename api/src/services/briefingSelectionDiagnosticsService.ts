import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BlobServiceClient } from "@azure/storage-blob";
import { getBriefingStorageSettings, getEnvironmentSettings } from "../config/runtimeConfig.js";
import type { BriefingEdition } from "../shared/contracts.js";

export interface BriefingSelectionDiagnosticEntry {
  id: string;
  title: string;
  source: string;
  publishedAt?: string;
  publishedAtKnown: boolean;
  cluster: string;
  impactScore: number;
  freshnessScore: number;
  totalScore: number;
  reasons: string[];
}

export interface BriefingSelectionDiagnosticRecord {
  updatedAt: string;
  date: string;
  edition: BriefingEdition;
  selectedArticleCount: number;
  entries: BriefingSelectionDiagnosticEntry[];
}

interface PersistedSelectionDiagnosticsFile {
  latestSelectionDiagnostics: BriefingSelectionDiagnosticRecord | null;
}

const storageSettings = getBriefingStorageSettings();
const environment = getEnvironmentSettings();
const DEFAULT_STORAGE_FILE = path.join(process.cwd(), ".data", "selection-diagnostics.json");
const storageFilePath = environment.isProduction && process.env.HOME
  ? `${process.env.HOME}/data/selection-diagnostics.json`
  : DEFAULT_STORAGE_FILE;
const storageBlobName = "selection-diagnostics.json";

let latestSelectionDiagnostics: BriefingSelectionDiagnosticRecord | null | undefined;

function shouldUseBlobStorage(): boolean {
  if (storageSettings.provider === "blob") {
    return true;
  }

  if (storageSettings.provider === "file") {
    return false;
  }

  return environment.isProduction && typeof storageSettings.connectionString === "string";
}

function createEmptyStore(): PersistedSelectionDiagnosticsFile {
  return {
    latestSelectionDiagnostics: null,
  };
}

function cloneRecord(record: BriefingSelectionDiagnosticRecord): BriefingSelectionDiagnosticRecord {
  return {
    ...record,
    entries: record.entries.map((entry) => ({
      ...entry,
      reasons: [...entry.reasons],
    })),
  };
}

async function getBlobClient() {
  if (!storageSettings.connectionString) {
    throw new Error("Selection diagnostics storage connection string is not configured.");
  }

  const serviceClient = BlobServiceClient.fromConnectionString(storageSettings.connectionString);
  const containerClient = serviceClient.getContainerClient(storageSettings.blobContainerName);
  await containerClient.createIfNotExists();
  return containerClient.getBlockBlobClient(storageBlobName);
}

async function loadBlobStore(): Promise<PersistedSelectionDiagnosticsFile> {
  const blobClient = await getBlobClient();
  const exists = await blobClient.exists();
  if (!exists) {
    return createEmptyStore();
  }

  const download = await blobClient.download();
  const raw = await streamToString(download.readableStreamBody);
  return raw.trim() ? JSON.parse(raw) as PersistedSelectionDiagnosticsFile : createEmptyStore();
}

async function saveBlobStore(store: PersistedSelectionDiagnosticsFile): Promise<void> {
  const blobClient = await getBlobClient();
  const body = `${JSON.stringify(store, null, 2)}\n`;
  await blobClient.upload(body, Buffer.byteLength(body), {
    blobHTTPHeaders: {
      blobContentType: "application/json; charset=utf-8",
    },
  });
}

async function loadFileStore(): Promise<PersistedSelectionDiagnosticsFile> {
  try {
    const raw = await readFile(storageFilePath, "utf-8");
    return raw.trim() ? JSON.parse(raw) as PersistedSelectionDiagnosticsFile : createEmptyStore();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return createEmptyStore();
    }

    throw error;
  }
}

async function saveFileStore(store: PersistedSelectionDiagnosticsFile): Promise<void> {
  await mkdir(path.dirname(storageFilePath), { recursive: true });
  await writeFile(storageFilePath, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
}

async function loadStore(): Promise<PersistedSelectionDiagnosticsFile> {
  return shouldUseBlobStorage() ? loadBlobStore() : loadFileStore();
}

async function saveStore(store: PersistedSelectionDiagnosticsFile): Promise<void> {
  if (shouldUseBlobStorage()) {
    await saveBlobStore(store);
    return;
  }

  await saveFileStore(store);
}

export async function recordBriefingSelectionDiagnostics(
  record: Omit<BriefingSelectionDiagnosticRecord, "updatedAt">,
): Promise<void> {
  latestSelectionDiagnostics = {
    ...record,
    updatedAt: new Date().toISOString(),
  };

  await saveStore({
    latestSelectionDiagnostics,
  });
}

export async function getLatestBriefingSelectionDiagnostics(): Promise<BriefingSelectionDiagnosticRecord | null> {
  if (latestSelectionDiagnostics !== undefined) {
    return latestSelectionDiagnostics ? cloneRecord(latestSelectionDiagnostics) : null;
  }

  const store = await loadStore();
  latestSelectionDiagnostics = store.latestSelectionDiagnostics ?? null;
  return latestSelectionDiagnostics ? cloneRecord(latestSelectionDiagnostics) : null;
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
