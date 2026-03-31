import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getBriefingStorageSettings } from "../config/runtimeConfig.js";
import type { BriefingEdition } from "../shared/contracts.js";
import { getEditionRank } from "../utils/briefingEdition.js";
import { createLogger } from "../utils/logger.js";
import type {
  BriefingRecord,
  BriefingStore,
  IssueRecord,
  ResearchHighlightRecord,
  StoredBriefingBundle,
} from "./briefingStore.js";

interface PersistedBriefingStoreFile {
  briefings: BriefingRecord[];
  issues: IssueRecord[];
  researchHighlights: ResearchHighlightRecord[];
}

const briefingRecords = new Map<string, BriefingRecord>();
const issueRecordsByBriefingId = new Map<string, IssueRecord[]>();
const researchHighlightRecordsByBriefingId = new Map<string, ResearchHighlightRecord[]>();
const logger = createLogger("briefing-store");

const storageSettings = getBriefingStorageSettings();
const DEFAULT_STORAGE_FILE = path.join(process.cwd(), ".data", "briefings.json");
const storageFilePath = storageSettings.filePath || DEFAULT_STORAGE_FILE;
const allowMemoryFallback = storageSettings.fallbackToMemory;
let loadPromise: Promise<void> | null = null;
let persistenceUnavailableReason: string | null = null;

function cloneBriefingRecord(record: BriefingRecord): BriefingRecord {
  return {
    ...record,
    dailySummary: {
      ...record.dailySummary,
      topKeywords: [...record.dailySummary.topKeywords],
      topKeywordsEn: [...record.dailySummary.topKeywordsEn],
    },
    trendingTopics: [...record.trendingTopics],
    trendingTopicsEn: [...record.trendingTopicsEn],
  };
}

function cloneIssueRecords<T extends IssueRecord | ResearchHighlightRecord>(records: T[]): T[] {
  return records.map((record) => ({
    ...record,
    keywords: [...record.keywords],
  }));
}

function cloneBundle(bundle: StoredBriefingBundle): StoredBriefingBundle {
  return {
    briefing: cloneBriefingRecord(bundle.briefing),
    issues: cloneIssueRecords(bundle.issues),
    researchHighlights: cloneIssueRecords(bundle.researchHighlights),
  };
}

function buildBundleFromId(id: string): StoredBriefingBundle | null {
  const briefing = briefingRecords.get(id);
  if (!briefing) {
    return null;
  }

  return cloneBundle({
    briefing,
    issues: issueRecordsByBriefingId.get(id) ?? [],
    researchHighlights: researchHighlightRecordsByBriefingId.get(id) ?? [],
  });
}

function compareBriefingRecords(left: BriefingRecord, right: BriefingRecord): number {
  const dateComparison = right.date.localeCompare(left.date);
  if (dateComparison !== 0) {
    return dateComparison;
  }

  const editionComparison = getEditionRank(right.edition) - getEditionRank(left.edition);
  if (editionComparison !== 0) {
    return editionComparison;
  }

  return right.updatedAt.localeCompare(left.updatedAt);
}

function findLatestBriefingIdForDate(date: string): string | null {
  const matchingRecords = [...briefingRecords.values()]
    .filter((record) => record.date === date)
    .sort(compareBriefingRecords);

  return matchingRecords[0]?.id ?? null;
}

function resetStore(): void {
  briefingRecords.clear();
  issueRecordsByBriefingId.clear();
  researchHighlightRecordsByBriefingId.clear();
}

function toPersistedStoreFile(): PersistedBriefingStoreFile {
  return {
    briefings: [...briefingRecords.values()].map(cloneBriefingRecord),
    issues: [...issueRecordsByBriefingId.values()].flatMap((records) => cloneIssueRecords(records)),
    researchHighlights: [...researchHighlightRecordsByBriefingId.values()].flatMap((records) => cloneIssueRecords(records)),
  };
}

function hydrateStore(data: PersistedBriefingStoreFile): void {
  resetStore();

  for (const briefing of data.briefings) {
    briefingRecords.set(briefing.id, cloneBriefingRecord(briefing));
  }

  for (const issue of data.issues) {
    const existingIssues = issueRecordsByBriefingId.get(issue.briefingId) ?? [];
    existingIssues.push({ ...issue, keywords: [...issue.keywords] });
    issueRecordsByBriefingId.set(issue.briefingId, existingIssues);
  }

  for (const researchHighlight of data.researchHighlights) {
    const existingHighlights = researchHighlightRecordsByBriefingId.get(researchHighlight.briefingId) ?? [];
    existingHighlights.push({ ...researchHighlight, keywords: [...researchHighlight.keywords] });
    researchHighlightRecordsByBriefingId.set(researchHighlight.briefingId, existingHighlights);
  }
}

async function ensureLoaded(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const raw = await readFile(storageFilePath, "utf-8");
        const parsed = JSON.parse(raw) as PersistedBriefingStoreFile;
        hydrateStore(parsed);
      } catch (error) {
        const isMissingFile = error instanceof Error && "code" in error && error.code === "ENOENT";
        if (isMissingFile) {
          resetStore();
          return;
        }

        if (allowMemoryFallback) {
          persistenceUnavailableReason = error instanceof Error ? error.message : String(error);
          logger.warn("Persistent briefing storage could not be loaded; using in-memory fallback.", {
            storageFilePath,
            reason: persistenceUnavailableReason,
          });
          resetStore();
          return;
        }

        throw error;
      }
    })();
  }

  await loadPromise;
}

async function persistStore(): Promise<void> {
  const directoryPath = path.dirname(storageFilePath);
  try {
    await mkdir(directoryPath, { recursive: true });
    await writeFile(storageFilePath, `${JSON.stringify(toPersistedStoreFile(), null, 2)}\n`, "utf-8");
    persistenceUnavailableReason = null;
  } catch (error) {
    if (!allowMemoryFallback) {
      throw error;
    }

    persistenceUnavailableReason = error instanceof Error ? error.message : String(error);
    logger.warn("Persistent briefing storage could not be written; keeping in-memory fallback active.", {
      storageFilePath,
      reason: persistenceUnavailableReason,
    });
  }
}

export class InMemoryBriefingStore implements BriefingStore {
  async saveBriefing(bundle: StoredBriefingBundle): Promise<void> {
    await ensureLoaded();
    briefingRecords.set(bundle.briefing.id, cloneBriefingRecord(bundle.briefing));
    issueRecordsByBriefingId.set(bundle.briefing.id, cloneIssueRecords(bundle.issues));
    researchHighlightRecordsByBriefingId.set(
      bundle.briefing.id,
      cloneIssueRecords(bundle.researchHighlights),
    );
    await persistStore();
  }

  async getBriefingById(id: string): Promise<StoredBriefingBundle | null> {
    await ensureLoaded();
    return buildBundleFromId(id);
  }

  async getBriefingByDate(date: string): Promise<StoredBriefingBundle | null> {
    await ensureLoaded();
    const briefingId = findLatestBriefingIdForDate(date);
    return briefingId ? buildBundleFromId(briefingId) : null;
  }

  async getBriefingByDateAndEdition(date: string, edition: BriefingEdition): Promise<StoredBriefingBundle | null> {
    await ensureLoaded();
    const record = [...briefingRecords.values()].find((item) => item.date === date && item.edition === edition);
    return record ? buildBundleFromId(record.id) : null;
  }

  async getTodayBriefing(today: string): Promise<StoredBriefingBundle | null> {
    return this.getBriefingByDate(today);
  }

  async listRecentBriefings(limit?: number): Promise<StoredBriefingBundle[]> {
    await ensureLoaded();
    const sortedRecords = [...briefingRecords.values()]
      .sort(compareBriefingRecords);

    const limitedRecords = typeof limit === "number"
      ? sortedRecords.slice(0, limit)
      : sortedRecords;

    return limitedRecords
      .map((record) => buildBundleFromId(record.id))
      .filter((bundle): bundle is StoredBriefingBundle => bundle !== null);
  }
}

export const inMemoryBriefingStore = new InMemoryBriefingStore();

export function getBriefingStorageStatus(): {
  storageFilePath: string;
  usingMemoryFallback: boolean;
  persistenceUnavailableReason: string | null;
} {
  return {
    storageFilePath,
    usingMemoryFallback: persistenceUnavailableReason !== null,
    persistenceUnavailableReason,
  };
}
