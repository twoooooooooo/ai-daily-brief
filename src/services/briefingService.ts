import type { ArticleFilters, ArticleType, ArchiveFilters, Briefing, BriefingResponse, Category, DailySummary, Importance, Issue, Region } from "@/types";
import { endpoints } from "@/config/api";

// ─── Configuration ──────────────────────────────────────────────────────────

export class BriefingServiceError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "BriefingServiceError";
  }
}

const configuredAdminApiKey = import.meta.env.VITE_ADMIN_API_KEY?.trim();

function createEmptyBriefingResponse(): BriefingResponse {
  return {
    articles: [],
    summary: {
      trend: "아직 저장된 브리핑이 없습니다.",
      trendEn: "No briefing has been generated yet.",
      topKeywords: [],
      topKeywordsEn: [],
      totalArticles: 0,
      topCategory: "Model",
      topMention: "-",
    },
    trendingTopics: [],
    trendingTopicsEn: [],
  };
}

function toBriefingResponse(briefing: Briefing): BriefingResponse {
  return {
    articles: [...briefing.issues, ...briefing.researchHighlights],
    summary: briefing.dailySummary,
    trendingTopics: briefing.trendingTopics,
    trendingTopicsEn: briefing.trendingTopicsEn,
    lastUpdatedAt: briefing.lastUpdatedAt,
  };
}

function normalizeBriefingId(id: string): string {
  return decodeURIComponent(id).trim().replace(/^\/+|\/+$/g, "");
}

// ─── Raw source types ───────────────────────────────────────────────────────

export interface RawNewsItem {
  id?: string; title: string; description?: string; content?: string; url?: string;
  source?: { name: string } | string; publishedAt?: string; category?: string; tags?: string[];
  [key: string]: unknown;
}

export interface RawResearchItem {
  paperId?: string; title: string; abstract?: string; venue?: string; year?: number;
  authors?: Array<{ name: string }>; fieldsOfStudy?: string[]; url?: string; publicationDate?: string;
  [key: string]: unknown;
}

// ─── Normalizers ────────────────────────────────────────────────────────────

export function normalizeNewsItem(raw: RawNewsItem, index: number): Issue {
  const sourceName = typeof raw.source === "object" ? raw.source?.name ?? "Unknown" : raw.source ?? "Unknown";
  return {
    id: raw.id ?? `news-${index}`, title: raw.title, titleEn: raw.title,
    category: mapToCategory(raw.category), importance: "Medium" as Importance,
    summary: raw.description ?? raw.content ?? "", summaryEn: raw.description ?? raw.content ?? "",
    whyItMatters: "", whyItMattersEn: "", practicalImpact: "", practicalImpactEn: "",
    keywords: raw.tags ?? [], source: sourceName, sourceUrl: raw.url ?? "#", region: "Global" as Region,
    date: raw.publishedAt ? new Date(raw.publishedAt).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
    type: "news" as ArticleType,
  };
}

export function normalizeResearchItem(raw: RawResearchItem, index: number): Issue {
  return {
    id: raw.paperId ?? `research-${index}`, title: raw.title, titleEn: raw.title,
    category: "Research" as Category, importance: "Medium" as Importance,
    summary: raw.abstract ?? "", summaryEn: raw.abstract ?? "",
    whyItMatters: "", whyItMattersEn: "", practicalImpact: "", practicalImpactEn: "",
    keywords: raw.fieldsOfStudy ?? [], source: raw.venue ?? "arXiv", sourceUrl: raw.url ?? "#", region: "Global" as Region,
    date: raw.publicationDate ?? (raw.year ? `${raw.year}-01-01` : new Date().toISOString().split("T")[0]),
    type: "research" as ArticleType,
  };
}

function mapToCategory(raw?: string): Category {
  if (!raw) return "Model";
  const map: Record<string, Category> = {
    model: "Model", research: "Research", policy: "Policy", product: "Product",
    investment: "Investment", infrastructure: "Infrastructure", regulation: "Policy",
    funding: "Investment", hardware: "Infrastructure",
  };
  return map[raw.toLowerCase()] ?? "Model";
}

// ─── Source adapters (placeholder) ──────────────────────────────────────────

async function parseJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  try {
    return await response.json() as T;
  } catch (error) {
    throw new BriefingServiceError(fallbackMessage, error);
  }
}

function createStatusError(status: number, fallbackMessage: string): BriefingServiceError {
  return new BriefingServiceError(`${fallbackMessage} (${status})`);
}

async function fetchJson<T>(url: string, fallbackMessage: string): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
  } catch (error) {
    throw new BriefingServiceError(fallbackMessage, error);
  }

  if (!response.ok) {
    throw createStatusError(response.status, fallbackMessage);
  }

  return parseJsonResponse<T>(response, fallbackMessage);
}

async function fetchOptionalJson<T>(url: string, notFoundValue: T, fallbackMessage: string): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
  } catch (error) {
    throw new BriefingServiceError(fallbackMessage, error);
  }

  if (response.status === 404) {
    return notFoundValue;
  }

  if (!response.ok) {
    throw createStatusError(response.status, fallbackMessage);
  }

  return parseJsonResponse<T>(response, fallbackMessage);
}

async function postJson<T>(url: string, body: unknown, fallbackMessage: string, headers: HeadersInit = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new BriefingServiceError(fallbackMessage, error);
  }

  if (!response.ok) {
    try {
      const errorBody = await response.json() as { message?: string };
      const apiMessage = errorBody.message?.trim();
      throw new BriefingServiceError(
        apiMessage ? `${fallbackMessage}: ${apiMessage} (${response.status})` : `${fallbackMessage} (${response.status})`,
      );
    } catch (error) {
      if (error instanceof BriefingServiceError) {
        throw error;
      }

      throw createStatusError(response.status, fallbackMessage);
    }
  }

  return parseJsonResponse<T>(response, fallbackMessage);
}

function buildArchiveSearchParams(filters: ArchiveFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.search.trim()) {
    params.set("q", filters.search.trim());
  }

  if (filters.dateFrom.trim()) {
    params.set("dateFrom", filters.dateFrom.trim());
  }

  if (filters.dateTo.trim()) {
    params.set("dateTo", filters.dateTo.trim());
  }

  const categoryMap: Record<string, Category | undefined> = {
    "전체": undefined,
    "정책": "Policy",
    "제품": "Product",
    "인프라": "Infrastructure",
  };

  const regionMap: Record<string, Region | undefined> = {
    "글로벌": undefined,
    "미국": "US",
    "유럽": "Europe",
    "아시아": "Asia",
  };

  const importanceMap: Record<string, Importance | undefined> = {
    "전체": undefined,
    "높음": "High",
    "보통": "Medium",
    "낮음": "Low",
  };

  const typeMap: Record<string, ArticleType | undefined> = {
    "전체": undefined,
    "뉴스": "news",
    "연구": "research",
  };

  const category = categoryMap[filters.category];
  const region = regionMap[filters.region];
  const importance = importanceMap[filters.importance];
  const type = typeMap[filters.category];

  if (category) {
    params.set("category", category);
  }

  if (region) {
    params.set("region", region);
  }

  if (importance) {
    params.set("importance", importance);
  }

  if (type) {
    params.set("type", type);
  }

  return params;
}

export async function fetchNewsFromAPI(): Promise<Issue[]> {
  const briefing = await fetchBriefing();
  return briefing.articles.filter((issue) => issue.type === "news");
}

export async function fetchNewsFromRSS(): Promise<Issue[]> {
  return fetchNewsFromAPI();
}

export async function fetchResearchPapers(): Promise<Issue[]> {
  const briefing = await fetchBriefing();
  return briefing.articles.filter((issue) => issue.type === "research");
}

export async function generateDailySummary(articles: Issue[]): Promise<DailySummary> {
  if (articles.length === 0) {
    return {
      trend: "데이터를 불러오는 중입니다.",
      trendEn: "Loading briefing data.",
      topKeywords: [],
      topKeywordsEn: [],
      totalArticles: 0,
      topCategory: "Model",
      topMention: "-",
    };
  }
  const categoryCounts: Record<string, number> = {};
  const keywordCounts: Record<string, number> = {};
  for (const a of articles) { categoryCounts[a.category] = (categoryCounts[a.category] ?? 0) + 1; for (const kw of a.keywords) { keywordCounts[kw] = (keywordCounts[kw] ?? 0) + 1; } }
  const topCategory = (Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Model") as Category;
  const topKeywords = Object.entries(keywordCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([kw]) => kw);
  return {
    trend: `오늘 ${articles.length}건의 AI 관련 기사가 분석되었습니다.`,
    trendEn: `${articles.length} AI-related articles were analyzed today.`,
    topKeywords,
    topKeywordsEn: topKeywords,
    totalArticles: articles.length,
    topCategory,
    topMention: topKeywords[0] ?? "-",
  };
}

// ─── Main orchestrator ──────────────────────────────────────────────────────

export async function fetchBriefing(): Promise<BriefingResponse> {
  try {
    return await fetchJson<BriefingResponse>(endpoints.todayBriefing, "브리핑 데이터를 불러오지 못했습니다.");
  } catch (error) {
    if (!(error instanceof BriefingServiceError) || !error.message.includes("(404)")) {
      throw error;
    }

    const recentBriefings = await fetchArchiveBriefings();
    if (recentBriefings.length > 0) {
      return toBriefingResponse(recentBriefings[0]);
    }

    return createEmptyBriefingResponse();
  }
}

// ─── Archive service ────────────────────────────────────────────────────────

export async function fetchArchiveBriefings(): Promise<Briefing[]> {
  return fetchJson<Briefing[]>(endpoints.archiveBriefings, "아카이브 브리핑을 불러오지 못했습니다.");
}

export async function searchArchiveBriefings(filters: ArchiveFilters): Promise<Briefing[]> {
  const params = buildArchiveSearchParams(filters);
  if (params.size === 0) {
    return fetchArchiveBriefings();
  }

  const url = `${endpoints.search}?${params.toString()}`;
  return fetchJson<Briefing[]>(url, "아카이브 브리핑 검색에 실패했습니다.");
}

export async function fetchBriefingById(id: string): Promise<Briefing | null> {
  const normalizedId = normalizeBriefingId(id);
  if (!normalizedId) {
    return null;
  }

  return fetchOptionalJson<Briefing | null>(
    endpoints.briefingById(normalizedId),
    null,
    "브리핑 상세 데이터를 불러오지 못했습니다.",
  );
}

export async function runDailyBriefingGeneration(date?: string, adminApiKey?: string): Promise<Briefing> {
  const effectiveAdminApiKey = adminApiKey?.trim() || configuredAdminApiKey;
  const requestBody: Record<string, string> = {};

  if (date) {
    requestBody.date = date;
  }

  if (effectiveAdminApiKey) {
    requestBody.adminApiKey = effectiveAdminApiKey;
  }

  return postJson<Briefing>(
    endpoints.runDailyBriefing,
    requestBody,
    "일일 브리핑 생성에 실패했습니다.",
    effectiveAdminApiKey ? { "x-admin-key": effectiveAdminApiKey } : {},
  );
}

// ─── Client-side article filtering ──────────────────────────────────────────

export function filterArticles(articles: Issue[], filters: ArticleFilters): Issue[] {
  return articles.filter((a) => {
    const q = filters.search.toLowerCase();
    if (q && !a.title.toLowerCase().includes(q) && !a.keywords.some((k) => k.toLowerCase().includes(q))) return false;
    if (filters.category !== "전체") {
      const catMap: Record<string, string[]> = { "뉴스": ["Model", "Product", "Investment", "Infrastructure", "Policy"], "연구": ["Research"], "정책": ["Policy"], "제품": ["Product"], "인프라": ["Infrastructure"] };
      const allowed = catMap[filters.category];
      if (allowed && !allowed.includes(a.category)) return false;
    }
    const regionMap: Record<string, string> = { "글로벌": "Global", "미국": "US", "유럽": "Europe", "아시아": "Asia" };
    const mapped = regionMap[filters.region];
    if (mapped && mapped !== "Global" && a.region !== mapped) return false;
    if (filters.importance !== "전체") {
      const impMap: Record<string, string> = { "높음": "High", "보통": "Medium", "낮음": "Low" };
      if (a.importance !== impMap[filters.importance]) return false;
    }
    return true;
  });
}
