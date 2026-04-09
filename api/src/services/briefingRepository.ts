import { briefingStore, getBriefingStoreStatus } from "../repositories/briefingStoreProvider.js";
import { createLogger, type LogContext } from "../utils/logger.js";
import { buildBriefingId, compareBriefingsByRecency, resolveBriefingDate } from "../utils/briefingEdition.js";
import type {
  BriefingRecord,
  IssueRecord,
  ResearchHighlightRecord,
  StoredBriefingBundle,
} from "../repositories/briefingStore.js";
import type { ArticleType, Briefing, BriefingEdition, BriefingResponse, Category, Importance, Issue, Region } from "../shared/contracts.js";

export interface SearchBriefingsFilters {
  query?: string;
  edition?: BriefingEdition;
  category?: Category;
  importance?: Importance;
  region?: Region;
  type?: ArticleType;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

interface SaveBriefingOptions {
  overwrite?: boolean;
  logContext?: LogContext;
}

const logger = createLogger("briefing-repository");

function isProbeBriefing(briefing: Briefing): boolean {
  if (briefing.id.startsWith("probe-")) {
    return true;
  }

  return [...briefing.issues, ...briefing.researchHighlights].some((article) =>
    article.source === "System Probe" || article.id.startsWith("probe-"),
  );
}

function cloneIssues<T extends Issue>(issues: T[]): T[] {
  return issues.map((issue) => ({
    ...issue,
    keywords: [...issue.keywords],
  }));
}

function cloneBriefing(briefing: Briefing): Briefing {
  return {
    ...briefing,
    dailySummary: {
      ...briefing.dailySummary,
      topKeywords: [...briefing.dailySummary.topKeywords],
      topKeywordsEn: [...briefing.dailySummary.topKeywordsEn],
    },
    issues: cloneIssues(briefing.issues),
    researchHighlights: cloneIssues(briefing.researchHighlights),
    trendingTopics: [...briefing.trendingTopics],
    trendingTopicsEn: [...briefing.trendingTopicsEn],
    lastUpdatedAt: briefing.lastUpdatedAt,
  };
}

function toBriefingResponse(briefing: Briefing): BriefingResponse {
  return {
    articles: [...cloneIssues(briefing.issues), ...cloneIssues(briefing.researchHighlights)],
    edition: briefing.edition,
    summary: {
      ...briefing.dailySummary,
      topKeywords: [...briefing.dailySummary.topKeywords],
      topKeywordsEn: [...briefing.dailySummary.topKeywordsEn],
    },
    trendingTopics: [...briefing.trendingTopics],
    trendingTopicsEn: [...briefing.trendingTopicsEn],
    lastUpdatedAt: briefing.lastUpdatedAt,
  };
}

function normalizeBriefingId(id: string): string {
  return decodeURIComponent(id).trim().replace(/^\/+|\/+$/g, "");
}

function normalizeDate(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return date.trim();
  }

  return parsed.toISOString().slice(0, 10);
}

function normalizeOptionalDate(date?: string): string | undefined {
  return date?.trim() ? normalizeDate(date) : undefined;
}

function matchesQuery(briefing: Briefing, query: string): boolean {
  const normalizedQuery = query.toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  const allArticles = [...briefing.issues, ...briefing.researchHighlights];

  return briefing.dailySummary.trend.toLowerCase().includes(normalizedQuery)
    || allArticles.some((article) => article.title.toLowerCase().includes(normalizedQuery))
    || allArticles.some((article) => article.keywords.some((keyword) => keyword.toLowerCase().includes(normalizedQuery)))
    || allArticles.some((article) => article.source.toLowerCase().includes(normalizedQuery));
}

function filterArticlesForSearch(briefing: Briefing, filters: SearchBriefingsFilters): Issue[] {
  return [...briefing.issues, ...briefing.researchHighlights].filter((article) => {
    if (filters.category && article.category !== filters.category) {
      return false;
    }

    if (filters.importance && article.importance !== filters.importance) {
      return false;
    }

    if (filters.region && article.region !== filters.region) {
      return false;
    }

    if (filters.type && article.type !== filters.type) {
      return false;
    }

    return true;
  });
}

function matchesDateRange(briefing: Briefing, filters: SearchBriefingsFilters): boolean {
  const dateFrom = normalizeOptionalDate(filters.dateFrom);
  const dateTo = normalizeOptionalDate(filters.dateTo);

  if (dateFrom && briefing.date < dateFrom) {
    return false;
  }

  if (dateTo && briefing.date > dateTo) {
    return false;
  }

  return true;
}

function toStoredBundle(briefing: Briefing): StoredBriefingBundle {
  const timestamp = new Date().toISOString();

  const briefingRecord: BriefingRecord = {
    id: briefing.id,
    date: briefing.date,
    edition: briefing.edition,
    dailySummary: {
      ...briefing.dailySummary,
      trendEn: briefing.dailySummary.trendEn,
      topKeywords: [...briefing.dailySummary.topKeywords],
      topKeywordsEn: [...briefing.dailySummary.topKeywordsEn],
    },
    trendingTopics: [...briefing.trendingTopics],
    trendingTopicsEn: [...briefing.trendingTopicsEn],
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const issues: IssueRecord[] = briefing.issues.map((issue) => ({
    ...issue,
    keywords: [...issue.keywords],
    briefingId: briefing.id,
  }));

  const researchHighlights: ResearchHighlightRecord[] = briefing.researchHighlights.map((issue) => ({
    ...issue,
    keywords: [...issue.keywords],
    briefingId: briefing.id,
  }));

  return {
    briefing: briefingRecord,
    issues,
    researchHighlights,
  };
}

function fromStoredBundle(bundle: StoredBriefingBundle): Briefing {
  return {
    id: bundle.briefing.id,
    date: bundle.briefing.date,
    edition: bundle.briefing.edition,
    lastUpdatedAt: bundle.briefing.updatedAt,
    dailySummary: {
      ...bundle.briefing.dailySummary,
      trendEn: typeof bundle.briefing.dailySummary.trendEn === "string" && bundle.briefing.dailySummary.trendEn.trim()
        ? bundle.briefing.dailySummary.trendEn
        : bundle.briefing.dailySummary.trend,
      topKeywords: [...bundle.briefing.dailySummary.topKeywords],
      topKeywordsEn: Array.isArray(bundle.briefing.dailySummary.topKeywordsEn)
        ? [...bundle.briefing.dailySummary.topKeywordsEn]
        : [...bundle.briefing.dailySummary.topKeywords],
    },
    issues: cloneIssues(bundle.issues),
    researchHighlights: cloneIssues(bundle.researchHighlights),
    trendingTopics: [...bundle.briefing.trendingTopics],
    trendingTopicsEn: Array.isArray(bundle.briefing.trendingTopicsEn)
      ? [...bundle.briefing.trendingTopicsEn]
      : [...bundle.briefing.trendingTopics],
  };
}

export async function saveBriefing(briefing: Briefing): Promise<Briefing> {
  return saveBriefingWithOptions(briefing);
}

export async function saveBriefingWithOptions(
  briefing: Briefing,
  options: SaveBriefingOptions = {},
): Promise<Briefing> {
  const existingBriefing = await getBriefingById(buildBriefingId(briefing.date, briefing.edition));

  if (existingBriefing && !options.overwrite) {
    logger.child(options.logContext ?? {}).warn("Skipped duplicate briefing save for date.", {
      date: briefing.date,
      edition: briefing.edition,
      existingBriefingId: existingBriefing.id,
      attemptedBriefingId: briefing.id,
    });
    return cloneBriefing(existingBriefing);
  }

  logger.child(options.logContext ?? {}).info("Persisting briefing.", {
    date: briefing.date,
    briefingId: briefing.id,
    overwrite: options.overwrite === true,
    storage: getBriefingStoreStatus(),
  });
  await briefingStore.saveBriefing(toStoredBundle(briefing));
  return cloneBriefing(briefing);
}

export async function getTodayBriefing(): Promise<BriefingResponse | null> {
  const today = resolveBriefingDate();
  const stored = await briefingStore.getTodayBriefing(today);

  if (stored) {
    const todayBriefing = fromStoredBundle(stored);
    if (!isProbeBriefing(todayBriefing)) {
      return toBriefingResponse(todayBriefing);
    }
  }

  const mostRecent = await listRecentBriefings(1);
  return mostRecent[0] ? toBriefingResponse(mostRecent[0]) : null;
}

export async function listBriefings(): Promise<Briefing[]> {
  return listRecentBriefings(50);
}

export async function listRecentBriefings(limit = 30): Promise<Briefing[]> {
  const bundles = await briefingStore.listRecentBriefings(limit);
  return bundles
    .map(fromStoredBundle)
    .filter((briefing) => !isProbeBriefing(briefing))
    .sort(compareBriefingsByRecency);
}

export async function searchBriefings(filters: SearchBriefingsFilters = {}): Promise<Briefing[]> {
  const bundles = await briefingStore.listRecentBriefings(filters.limit);
  const briefings = bundles
    .map(fromStoredBundle)
    .filter((briefing) => !isProbeBriefing(briefing))
    .sort(compareBriefingsByRecency);

  return briefings.filter((briefing) => {
    if (!matchesDateRange(briefing, filters)) {
      return false;
    }

    if (filters.edition && briefing.edition !== filters.edition) {
      return false;
    }

    if (!matchesQuery(briefing, filters.query ?? "")) {
      return false;
    }

    if (!filters.category && !filters.importance && !filters.region && !filters.type) {
      return true;
    }

    return filterArticlesForSearch(briefing, filters).length > 0;
  });
}

export async function getBriefingById(id: string): Promise<Briefing | null> {
  const normalizedId = normalizeBriefingId(id);
  const stored = await briefingStore.getBriefingById(normalizedId);
  if (!stored) {
    return null;
  }

  const briefing = fromStoredBundle(stored);
  return isProbeBriefing(briefing) ? null : briefing;
}

export async function getBriefingByDate(date: string): Promise<Briefing | null> {
  const normalizedDate = normalizeDate(date);
  const stored = await briefingStore.getBriefingByDate(normalizedDate);
  if (!stored) {
    return null;
  }

  const briefing = fromStoredBundle(stored);
  return isProbeBriefing(briefing) ? null : briefing;
}

export async function getBriefingByDateAndEdition(date: string, edition: BriefingEdition): Promise<Briefing | null> {
  const normalizedDate = normalizeDate(date);
  const stored = await briefingStore.getBriefingByDateAndEdition(normalizedDate, edition);
  if (!stored) {
    return null;
  }

  const briefing = fromStoredBundle(stored);
  return isProbeBriefing(briefing) ? null : briefing;
}

export async function getLatestBriefingForEdition(edition: BriefingEdition, limit = 30): Promise<Briefing | null> {
  const briefings = await listRecentBriefings(limit);
  return briefings.find((briefing) => briefing.edition === edition) ?? null;
}

export async function getLatestPersistedBriefing(): Promise<Briefing | null> {
  const [latest] = await listRecentBriefings(1);
  return latest ?? null;
}
