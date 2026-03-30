import { BlobServiceClient } from "@azure/storage-blob";
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

function createEmptyStoreFile(): PersistedBriefingStoreFile {
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

function buildBundle(data: PersistedBriefingStoreFile, id: string): StoredBriefingBundle | null {
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

export class BlobBriefingStore implements BriefingStore {
  constructor(
    private readonly connectionString: string,
    private readonly containerName: string,
    private readonly blobName: string,
  ) {}

  private async getBlobClient() {
    const serviceClient = BlobServiceClient.fromConnectionString(this.connectionString);
    const containerClient = serviceClient.getContainerClient(this.containerName);
    await containerClient.createIfNotExists();
    return containerClient.getBlockBlobClient(this.blobName);
  }

  private async loadStoreFile(): Promise<PersistedBriefingStoreFile> {
    const blobClient = await this.getBlobClient();
    const exists = await blobClient.exists();

    if (!exists) {
      return createEmptyStoreFile();
    }

    const download = await blobClient.download();
    const raw = await streamToString(download.readableStreamBody);
    return raw.trim() ? JSON.parse(raw) as PersistedBriefingStoreFile : createEmptyStoreFile();
  }

  private async saveStoreFile(data: PersistedBriefingStoreFile): Promise<void> {
    const blobClient = await this.getBlobClient();
    const body = `${JSON.stringify(data, null, 2)}\n`;
    await blobClient.upload(body, Buffer.byteLength(body), {
      blobHTTPHeaders: {
        blobContentType: "application/json; charset=utf-8",
      },
    });
  }

  async saveBriefing(bundle: StoredBriefingBundle): Promise<void> {
    const data = await this.loadStoreFile();
    const nextBriefings = data.briefings.filter((briefing) => briefing.id !== bundle.briefing.id);
    const nextIssues = data.issues.filter((issue) => issue.briefingId !== bundle.briefing.id);
    const nextResearchHighlights = data.researchHighlights.filter((item) => item.briefingId !== bundle.briefing.id);

    nextBriefings.push(cloneBriefingRecord(bundle.briefing));
    nextIssues.push(...cloneIssueRecords(bundle.issues));
    nextResearchHighlights.push(...cloneIssueRecords(bundle.researchHighlights));

    await this.saveStoreFile({
      briefings: nextBriefings,
      issues: nextIssues,
      researchHighlights: nextResearchHighlights,
    });
  }

  async getBriefingById(id: string): Promise<StoredBriefingBundle | null> {
    return buildBundle(await this.loadStoreFile(), id);
  }

  async getBriefingByDate(date: string): Promise<StoredBriefingBundle | null> {
    const data = await this.loadStoreFile();
    const briefing = data.briefings.find((item) => item.date === date);
    return briefing ? buildBundle(data, briefing.id) : null;
  }

  async getTodayBriefing(today: string): Promise<StoredBriefingBundle | null> {
    return this.getBriefingByDate(today);
  }

  async listRecentBriefings(limit?: number): Promise<StoredBriefingBundle[]> {
    const data = await this.loadStoreFile();
    const sortedBriefings = [...data.briefings].sort((left, right) => right.date.localeCompare(left.date));
    const briefings = typeof limit === "number" ? sortedBriefings.slice(0, limit) : sortedBriefings;

    return briefings
      .map((briefing) => buildBundle(data, briefing.id))
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
