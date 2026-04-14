import { BlobServiceClient } from "@azure/storage-blob";
import type { BriefingEdition } from "../shared/contracts.js";
import { getEditionRank } from "../utils/briefingEdition.js";
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

interface PersistedBriefingIndexFile {
  version: 2;
  briefings: BriefingRecord[];
}

function createEmptyLegacyStoreFile(): PersistedBriefingStoreFile {
  return {
    briefings: [],
    issues: [],
    researchHighlights: [],
  };
}

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

function buildIndexes(data: PersistedBriefingStoreFile): {
  briefingById: Map<string, BriefingRecord>;
  issueByBriefingId: Map<string, IssueRecord[]>;
  researchByBriefingId: Map<string, ResearchHighlightRecord[]>;
} {
  const briefingById = new Map<string, BriefingRecord>();
  const issueByBriefingId = new Map<string, IssueRecord[]>();
  const researchByBriefingId = new Map<string, ResearchHighlightRecord[]>();

  for (const briefing of data.briefings) {
    briefingById.set(briefing.id, cloneBriefingRecord(briefing));
  }

  for (const issue of data.issues) {
    const existing = issueByBriefingId.get(issue.briefingId) ?? [];
    existing.push({ ...issue, keywords: [...issue.keywords] });
    issueByBriefingId.set(issue.briefingId, existing);
  }

  for (const highlight of data.researchHighlights) {
    const existing = researchByBriefingId.get(highlight.briefingId) ?? [];
    existing.push({ ...highlight, keywords: [...highlight.keywords] });
    researchByBriefingId.set(highlight.briefingId, existing);
  }

  return {
    briefingById,
    issueByBriefingId,
    researchByBriefingId,
  };
}

function buildBundleFromLegacyData(data: PersistedBriefingStoreFile, id: string): StoredBriefingBundle | null {
  const indexes = buildIndexes(data);
  const briefing = indexes.briefingById.get(id);
  if (!briefing) {
    return null;
  }

  return cloneBundle({
    briefing,
    issues: indexes.issueByBriefingId.get(id) ?? [],
    researchHighlights: indexes.researchByBriefingId.get(id) ?? [],
  });
}

function isLegacyStoreFile(value: unknown): value is PersistedBriefingStoreFile {
  return Boolean(
    value
    && typeof value === "object"
    && Array.isArray((value as PersistedBriefingStoreFile).briefings)
    && Array.isArray((value as PersistedBriefingStoreFile).issues)
    && Array.isArray((value as PersistedBriefingStoreFile).researchHighlights),
  );
}

function isIndexStoreFile(value: unknown): value is PersistedBriefingIndexFile {
  return Boolean(
    value
    && typeof value === "object"
    && (value as PersistedBriefingIndexFile).version === 2
    && Array.isArray((value as PersistedBriefingIndexFile).briefings),
  );
}

function deriveItemsPrefix(blobName: string): string {
  return blobName.replace(/\.json$/i, "") || "briefings";
}

function sortBriefings(left: BriefingRecord, right: BriefingRecord): number {
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

export class BlobBriefingStore implements BriefingStore {
  private readonly itemsPrefix: string;

  constructor(
    private readonly connectionString: string,
    private readonly containerName: string,
    private readonly blobName: string,
  ) {
    this.itemsPrefix = deriveItemsPrefix(blobName);
  }

  private async getContainerClient() {
    const serviceClient = BlobServiceClient.fromConnectionString(this.connectionString);
    const containerClient = serviceClient.getContainerClient(this.containerName);
    await containerClient.createIfNotExists();
    return containerClient;
  }

  private async getIndexBlobClient() {
    const containerClient = await this.getContainerClient();
    return containerClient.getBlockBlobClient(this.blobName);
  }

  private async getBundleBlobClient(id: string) {
    const containerClient = await this.getContainerClient();
    return containerClient.getBlockBlobClient(`${this.itemsPrefix}/${id}.json`);
  }

  private async listBundleBlobNames(): Promise<string[]> {
    const containerClient = await this.getContainerClient();
    const names: string[] = [];
    for await (const blob of containerClient.listBlobsFlat({ prefix: `${this.itemsPrefix}/` })) {
      names.push(blob.name);
    }
    return names;
  }

  private async loadRawIndexPayload(): Promise<unknown | null> {
    const blobClient = await this.getIndexBlobClient();
    const exists = await blobClient.exists();
    if (!exists) {
      return null;
    }

    const download = await blobClient.download();
    const raw = await streamToString(download.readableStreamBody);
    return raw.trim() ? JSON.parse(raw) : null;
  }

  private async loadIndexFile(): Promise<PersistedBriefingIndexFile | null> {
    const payload = await this.loadRawIndexPayload();
    return isIndexStoreFile(payload)
      ? {
          version: 2,
          briefings: payload.briefings.map(cloneBriefingRecord),
        }
      : null;
  }

  private async loadLegacyStoreFile(): Promise<PersistedBriefingStoreFile | null> {
    const payload = await this.loadRawIndexPayload();
    return isLegacyStoreFile(payload) ? payload : null;
  }

  private async saveIndexFile(index: PersistedBriefingIndexFile): Promise<void> {
    const blobClient = await this.getIndexBlobClient();
    const body = `${JSON.stringify({
      version: 2,
      briefings: index.briefings.map(cloneBriefingRecord),
    }, null, 2)}\n`;
    await blobClient.upload(body, Buffer.byteLength(body), {
      blobHTTPHeaders: {
        blobContentType: "application/json; charset=utf-8",
      },
    });
  }

  private async loadBundleById(id: string): Promise<StoredBriefingBundle | null> {
    const bundleClient = await this.getBundleBlobClient(id);
    const exists = await bundleClient.exists();
    if (!exists) {
      return null;
    }

    const download = await bundleClient.download();
    const raw = await streamToString(download.readableStreamBody);
    if (!raw.trim()) {
      return null;
    }

    return cloneBundle(JSON.parse(raw) as StoredBriefingBundle);
  }

  private async saveBundle(bundle: StoredBriefingBundle): Promise<void> {
    const bundleClient = await this.getBundleBlobClient(bundle.briefing.id);
    const body = `${JSON.stringify(cloneBundle(bundle), null, 2)}\n`;
    await bundleClient.upload(body, Buffer.byteLength(body), {
      blobHTTPHeaders: {
        blobContentType: "application/json; charset=utf-8",
      },
    });
  }

  private async migrateLegacyStoreIfNeeded(): Promise<void> {
    const existingIndex = await this.loadIndexFile();
    if (existingIndex) {
      return;
    }

    const legacyStore = await this.loadLegacyStoreFile();
    if (!legacyStore || legacyStore.briefings.length === 0) {
      return;
    }

    const migratedBriefings = [...legacyStore.briefings].map(cloneBriefingRecord).sort(sortBriefings);
    for (const briefing of migratedBriefings) {
      const bundle = buildBundleFromLegacyData(legacyStore, briefing.id);
      if (bundle) {
        await this.saveBundle(bundle);
      }
    }

    await this.saveIndexFile({
      version: 2,
      briefings: migratedBriefings,
    });
  }

  async saveBriefing(bundle: StoredBriefingBundle): Promise<void> {
    await this.migrateLegacyStoreIfNeeded();

    const existingIndex = await this.loadIndexFile();
    const nextBriefings = (existingIndex?.briefings ?? [])
      .filter((briefing) => briefing.id !== bundle.briefing.id);
    nextBriefings.push(cloneBriefingRecord(bundle.briefing));
    nextBriefings.sort(sortBriefings);

    await this.saveBundle(bundle);
    await this.saveIndexFile({
      version: 2,
      briefings: nextBriefings,
    });
  }

  async getBriefingById(id: string): Promise<StoredBriefingBundle | null> {
    const index = await this.loadIndexFile();
    if (index) {
      return this.loadBundleById(id);
    }

    const legacyStore = await this.loadLegacyStoreFile();
    return legacyStore ? buildBundleFromLegacyData(legacyStore, id) : null;
  }

  async getBriefingByDate(date: string): Promise<StoredBriefingBundle | null> {
    const index = await this.loadIndexFile();
    if (index) {
      const briefing = [...index.briefings]
        .filter((item) => item.date === date)
        .sort(sortBriefings)[0];
      return briefing ? this.loadBundleById(briefing.id) : null;
    }

    const legacyStore = await this.loadLegacyStoreFile();
    if (!legacyStore) {
      return null;
    }

    const briefing = [...legacyStore.briefings]
      .filter((item) => item.date === date)
      .sort(sortBriefings)[0];
    return briefing ? buildBundleFromLegacyData(legacyStore, briefing.id) : null;
  }

  async getBriefingByDateAndEdition(date: string, edition: BriefingEdition): Promise<StoredBriefingBundle | null> {
    const index = await this.loadIndexFile();
    if (index) {
      const briefing = index.briefings.find((item) => item.date === date && item.edition === edition);
      return briefing ? this.loadBundleById(briefing.id) : null;
    }

    const legacyStore = await this.loadLegacyStoreFile();
    if (!legacyStore) {
      return null;
    }

    const briefing = legacyStore.briefings.find((item) => item.date === date && item.edition === edition);
    return briefing ? buildBundleFromLegacyData(legacyStore, briefing.id) : null;
  }

  async getTodayBriefing(today: string): Promise<StoredBriefingBundle | null> {
    return this.getBriefingByDate(today);
  }

  async listRecentBriefings(limit?: number): Promise<StoredBriefingBundle[]> {
    const index = await this.loadIndexFile();
    if (index) {
      const briefings = typeof limit === "number"
        ? index.briefings.slice(0, limit)
        : index.briefings;

      const bundles = await Promise.all(briefings.map((briefing) => this.loadBundleById(briefing.id)));
      return bundles.filter((bundle): bundle is StoredBriefingBundle => bundle !== null);
    }

    const legacyStore = await this.loadLegacyStoreFile();
    if (!legacyStore) {
      return [];
    }

    const sortedBriefings = [...legacyStore.briefings].sort(sortBriefings);
    const briefings = typeof limit === "number" ? sortedBriefings.slice(0, limit) : sortedBriefings;
    return briefings
      .map((briefing) => buildBundleFromLegacyData(legacyStore, briefing.id))
      .filter((bundle): bundle is StoredBriefingBundle => bundle !== null);
  }
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
