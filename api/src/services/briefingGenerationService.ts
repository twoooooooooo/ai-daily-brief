import type { Briefing, BriefingEdition } from "../shared/contracts.js";
import type { FeedLayer, NormalizedArticle } from "../shared/rss.js";
import {
  DAILY_BRIEFING_FIELD_LOCALIZATION_SYSTEM_PROMPT,
  DAILY_BRIEFING_LOCALIZATION_SYSTEM_PROMPT,
  DAILY_BRIEFING_SYSTEM_PROMPT,
  buildDailyBriefingFieldLocalizationUserPrompt,
  buildDailyBriefingLocalizationUserPrompt,
  buildDailyBriefingUserPrompt,
} from "../prompts/dailyBriefing/index.js";
import { getOpenAISettings } from "../config/runtimeConfig.js";
import { buildBriefingId, resolveBriefingDate, resolveBriefingEdition } from "../utils/briefingEdition.js";
import { GeneratedBriefingValidationError, parseGeneratedBriefingPayload } from "../validation/generatedBriefingSchema.js";
import { createLogger, type LogContext } from "../utils/logger.js";
import { withRetry } from "../utils/retry.js";
import { fetchGitHubTrendingSignals, type GitHubTrendingSignal } from "./githubTrendingSignalService.js";
import { recordBriefingSelectionDiagnostics } from "./briefingSelectionDiagnosticsService.js";
import { isDomesticSourceName } from "../config/domesticSources.js";
const logger = createLogger("briefing-generation");

interface GenerateBriefingInput {
  articles: NormalizedArticle[];
  date?: string;
  edition?: BriefingEdition;
  priorBriefings?: Briefing[];
  logContext?: LogContext;
}

const MAX_GENERATION_ARTICLES = 16;
const MIN_GENERATION_TOTAL_SCORE = 0.5;
const MAX_NEWS_AGE_HOURS = 48;
const MAX_RESEARCH_AGE_HOURS = 168;
const PRIORITY_SIGNAL_KEYWORDS = [
  "launch", "released", "release", "announced", "announcement", "introducing", "funding", "raises",
  "acquire", "acquisition", "partnership", "policy", "regulation", "senate", "court", "ipo",
  "investment", "shutdown", "expands", "available", "rollout", "global", "enterprise", "subscription",
  "benchmark", "reasoning", "agent", "agents", "agentic", "developer", "api", "security",
  "chip", "gpu", "semiconductor", "inference", "training", "data center", "compute", "workload",
  "search", "assistant", "coding", "open source", "governance",
] as const;
const TOPIC_CLUSTER_KEYWORDS: Record<string, string[]> = {
  openai: ["openai", "gpt", "chatgpt", "sora"],
  google: ["google", "gemini", "deepmind", "search live"],
  anthropic: ["anthropic", "claude"],
  meta: ["meta", "llama"],
  microsoft: ["microsoft", "copilot", "azure ai"],
  infrastructure: ["data center", "gpu", "chip", "semiconductor", "memory", "power"],
  policy: ["policy", "regulation", "court", "senate", "law", "government"],
  funding: ["funding", "raises", "investment", "ipo", "acquisition"],
  voice: ["voice", "audio", "speech", "translation"],
};
const STORY_DUPLICATE_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "into", "that", "this", "their", "about", "what", "your",
  "have", "will", "help", "using", "used", "news", "latest", "update", "updates", "new",
  "launch", "launched", "release", "released", "introducing", "announces", "announced", "adds",
  "added", "openai", "google", "anthropic", "claude", "mistral", "cohere", "microsoft", "meta",
  "nvidia", "aws", "hugging", "face", "techcrunch", "wired", "verge", "review", "mit", "ai",
  "gpt", "chatgpt", "gemini", "llm", "llms", "more", "next", "only", "why", "how", "use", "uses",
  "like", "into", "through", "after", "before", "over", "under", "must", "never",
]);
const SELECTION_SLOT_DEFINITIONS = [
  {
    id: "domestic-trend",
    matches: (article: NormalizedArticle) => article.type === "news" && isDomesticSourceName(article.source),
  },
  {
    id: "market-infrastructure",
    matches: (article: NormalizedArticle) => article.category === "Investment" || article.category === "Infrastructure",
  },
  {
    id: "policy-regulation",
    matches: (article: NormalizedArticle) => article.category === "Policy",
  },
  {
    id: "product-model",
    matches: (article: NormalizedArticle) => article.category === "Product" || article.category === "Model",
  },
  {
    id: "research-open",
    matches: (article: NormalizedArticle) => article.type === "research" || article.category === "Research",
  },
] as const;

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

interface LocalizedBriefingFieldItem {
  id: string;
  title: string;
  summary: string;
  whyItMatters: string;
  practicalImpact: string;
}

interface LocalizedBriefingFieldsPayload {
  dailySummary?: {
    trend?: string;
    topKeywords?: string[];
  };
  trendingTopics?: string[];
  issues?: LocalizedBriefingFieldItem[];
  researchHighlights?: LocalizedBriefingFieldItem[];
}

function cloneEnglishFieldsIntoLocalizedShape(briefing: Briefing): Briefing {
  return {
    ...briefing,
    dailySummary: {
      ...briefing.dailySummary,
      trendEn: briefing.dailySummary.trendEn || briefing.dailySummary.trend,
      topKeywordsEn: briefing.dailySummary.topKeywordsEn.length > 0
        ? [...briefing.dailySummary.topKeywordsEn]
        : [...briefing.dailySummary.topKeywords],
    },
    issues: briefing.issues.map((issue) => ({
      ...issue,
      titleEn: issue.titleEn || issue.title,
      summaryEn: issue.summaryEn || issue.summary,
      whyItMattersEn: issue.whyItMattersEn || issue.whyItMatters,
      practicalImpactEn: issue.practicalImpactEn || issue.practicalImpact,
      sourcePublishedAt: issue.sourcePublishedAt,
    })),
    researchHighlights: briefing.researchHighlights.map((issue) => ({
      ...issue,
      titleEn: issue.titleEn || issue.title,
      summaryEn: issue.summaryEn || issue.summary,
      whyItMattersEn: issue.whyItMattersEn || issue.whyItMatters,
      practicalImpactEn: issue.practicalImpactEn || issue.practicalImpact,
      sourcePublishedAt: issue.sourcePublishedAt,
    })),
    trendingTopicsEn: briefing.trendingTopicsEn.length > 0
      ? [...briefing.trendingTopicsEn]
      : [...briefing.trendingTopics],
  };
}

function enrichBriefingWithSourcePublishedAt(briefing: Briefing, selectedArticles: NormalizedArticle[]): Briefing {
  const articleById = new Map(selectedArticles.map((article) => [article.id, article]));
  const articleByUrl = new Map(selectedArticles.map((article) => [article.sourceUrl, article]));

  const enrichIssue = <T extends Briefing["issues"][number]>(issue: T): T => {
    const matchedArticle = articleById.get(issue.id) ?? articleByUrl.get(issue.sourceUrl);
    return {
      ...issue,
      sourcePublishedAt: matchedArticle?.publishedAt ?? issue.sourcePublishedAt,
    };
  };

  return {
    ...briefing,
    issues: briefing.issues.map((issue) => enrichIssue(issue)),
    researchHighlights: briefing.researchHighlights.map((issue) => enrichIssue(issue)),
  };
}

export class BriefingGenerationError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "BriefingGenerationError";
  }
}

function parseBriefingResponse(content: string, fallbackDate: string, fallbackEdition: BriefingEdition): Briefing {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new BriefingGenerationError("Failed to parse OpenAI briefing JSON.", error);
  }

  try {
    return parseGeneratedBriefingPayload(parsed, fallbackDate, fallbackEdition);
  } catch (error) {
    if (error instanceof GeneratedBriefingValidationError) {
      throw new BriefingGenerationError(error.message, error);
    }

    throw error;
  }
}

function resolveRequestDate(date?: string): string {
  if (!date) {
    return resolveBriefingDate();
  }

  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    throw new BriefingGenerationError("Invalid briefing date.");
  }

  return parsed.toISOString().slice(0, 10);
}

function applyBriefingIdentity(briefing: Briefing, date: string, edition: BriefingEdition): Briefing {
  return {
    ...briefing,
    id: buildBriefingId(date, edition),
    date,
    edition,
  };
}

function getOpenAIApiKey(): string {
  try {
    return getOpenAISettings().apiKey;
  } catch (error) {
    throw new BriefingGenerationError("Missing OPENAI_API_KEY.", error);
  }
}

function getOpenAIBaseUrl(): string {
  return getOpenAISettings().baseUrl;
}

function getOpenAIModel(): string {
  return getOpenAISettings().model;
}

function getOpenAIApiVersion(): string | undefined {
  return getOpenAISettings().apiVersion;
}

function shouldUseAzureApiKeyAuth(): boolean {
  return getOpenAISettings().useAzureApiKeyAuth;
}

function buildOpenAIRequestUrl(): string {
  const baseUrl = getOpenAIBaseUrl().replace(/\/+$/, "");
  const apiVersion = getOpenAIApiVersion();
  const usesAzureV1Endpoint = /\/openai\/v1$/i.test(baseUrl);

  if (!apiVersion || usesAzureV1Endpoint) {
    return `${baseUrl}/chat/completions`;
  }

  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}/chat/completions${separator}api-version=${encodeURIComponent(apiVersion)}`;
}

function buildOpenAIHeaders(): Record<string, string> {
  if (shouldUseAzureApiKeyAuth()) {
    return {
      "Content-Type": "application/json",
      "api-key": getOpenAIApiKey(),
    };
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getOpenAIApiKey()}`,
  };
}

function getSourcePriority(article: NormalizedArticle): number {
  const source = article.source.toLowerCase();

  if (source.includes("lg ai research")) return 3.42;
  if (source.includes("전자신문")) return 3.33;
  if (source.includes("zdnet korea")) return 3.24;
  if (source.includes("ai타임스")) return 3.26;
  if (source.includes("skt 뉴스룸")) return 3.18;
  if (source.includes("삼성sds")) return 3.16;
  if (source.includes("naver d2")) return 3.2;
  if (source.includes("anthropic")) return 3.45;
  if (source.includes("techcrunch")) return 3.5;
  if (source.includes("wired")) return 3.35;
  if (source.includes("mit technology review")) return 3.4;
  if (source.includes("the verge")) return 3.3;
  if (source.includes("ai news")) return 3.25;
  if (source.includes("openai")) return 3.4;
  if (source.includes("mistral")) return 3.35;
  if (source.includes("cohere")) return 3.25;
  if (source.includes("microsoft")) return 3.3;
  if (source.includes("google")) return 3.2;
  if (source.includes("nvidia")) return 3.15;
  if (source.includes("meta")) return 3.05;
  if (source.includes("aws")) return 3;
  if (source.includes("hugging face")) return 3;
  if (source.includes("arxiv")) return 2.2;
  return 2;
}

function getSourceReason(article: NormalizedArticle): string | null {
  const source = article.source.toLowerCase();

  if (
    source.includes("전자신문")
    || source.includes("zdnet korea")
    || source.includes("ai타임스")
    || source.includes("skt 뉴스룸")
    || source.includes("삼성sds")
    || source.includes("naver d2")
    || source.includes("lg ai research")
  ) {
    return "국내 주요 AI/IT 동향 소스";
  }
  if (source.includes("anthropic") || source.includes("openai") || source.includes("mistral") || source.includes("cohere")) {
    return "공식 AI 기업 발표 소스";
  }
  if (source.includes("mit technology review") || source.includes("wired") || source.includes("techcrunch") || source.includes("the verge")) {
    return "영향력 있는 글로벌 미디어 소스";
  }
  if (source.includes("ai news") || source.includes("hugging face")) {
    return "전문 AI 매체/플랫폼 소스";
  }
  if (source.includes("arxiv")) {
    return "연구/논문 소스";
  }

  return null;
}

function getLayerPriority(article: NormalizedArticle): number {
  switch (article.layer) {
    case "official":
      return 1.3;
    case "specialist-news":
      return 1.15;
    case "general-news":
      return 1;
    case "research":
      return 0.9;
    default:
      return 0.8;
  }
}

function getCategoryPriority(article: NormalizedArticle): number {
  switch (article.category) {
    case "Policy":
      return 3.3;
    case "Investment":
      return 3.1;
    case "Infrastructure":
      return 3;
    case "Product":
      return 2.8;
    case "Model":
      return 2.7;
    case "Research":
      return 2.4;
    default:
      return 2;
  }
}

function getCategoryReason(article: NormalizedArticle): string | null {
  switch (article.category) {
    case "Policy":
      return "정책/규제 영향도가 큰 주제";
    case "Investment":
      return "투자/시장 파급력이 큰 주제";
    case "Infrastructure":
      return "칩·데이터센터·인프라 관련 핵심 주제";
    case "Product":
      return "제품/서비스 출시 관련 주제";
    case "Model":
      return "모델/플랫폼 변화 관련 주제";
    case "Research":
      return "연구 레이어 보강용 주제";
    default:
      return null;
  }
}

function getArticleAgeHours(article: NormalizedArticle): number | null {
  if (!article.publishedAt || !article.publishedAtKnown) {
    return null;
  }

  const parsed = new Date(article.publishedAt);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return Math.max(0, (Date.now() - parsed.getTime()) / 36e5);
}

function getRecencyPriority(article: NormalizedArticle): number {
  const ageHours = getArticleAgeHours(article);
  if (ageHours === null) {
    return article.type === "research" ? -2.6 : -5.5;
  }

  if (article.type === "research") {
    if (ageHours <= 24) return 2.6;
    if (ageHours <= 72) return 1.7;
    if (ageHours <= MAX_RESEARCH_AGE_HOURS) return 0.8;
    return -1.2;
  }

  if (ageHours <= 12) return 4;
  if (ageHours <= 24) return 3;
  if (ageHours <= 36) return 1.5;
  if (ageHours <= MAX_NEWS_AGE_HOURS) return 0.2;
  if (ageHours <= 72) return -2.5;
  return -5;
}

function getRecencyReason(article: NormalizedArticle): string | null {
  const ageHours = getArticleAgeHours(article);
  if (ageHours === null) {
    return "기사 발행일이 확인되지 않음";
  }

  if (article.type === "research") {
    if (ageHours <= 72) return "최근 며칠 내 나온 연구";
    if (ageHours <= MAX_RESEARCH_AGE_HOURS) return "최근 일주일 내 연구";
    return null;
  }

  if (ageHours <= 12) return "아주 최신 뉴스";
  if (ageHours <= 24) return "최근 24시간 내 뉴스";
  if (ageHours <= 48) return "최근 48시간 내 뉴스";
  return null;
}

function getGitHubTrendingSignalPriority(article: NormalizedArticle, signals: GitHubTrendingSignal[]): number {
  if (signals.length === 0) {
    return 0;
  }

  const text = normalizeText(`${article.title} ${article.summary} ${article.source}`);
  let score = 0;

  for (const signal of signals) {
    const repoTokens = normalizeText(signal.repo).split(" ").filter((token) => token.length >= 3);
    const matchedKeywordCount = signal.keywords.filter((keyword) => text.includes(normalizeText(keyword))).length;
    const matchedRepoTokenCount = repoTokens.filter((token) => text.includes(token)).length;

    if (matchedKeywordCount === 0 && matchedRepoTokenCount === 0) {
      continue;
    }

    const popularityBoost = Math.min(1.2, signal.starsToday / 5000);
    score += matchedKeywordCount * 0.16 + matchedRepoTokenCount * 0.22 + popularityBoost;
  }

  return Math.min(score, 2.2);
}

function getSignalPriority(article: NormalizedArticle): number {
  const text = `${article.title} ${article.summary}`.toLowerCase();
  return PRIORITY_SIGNAL_KEYWORDS.reduce((score, signal) => score + (text.includes(signal) ? 0.28 : 0), 0);
}

function getSignalReasons(article: NormalizedArticle): string[] {
  const text = `${article.title} ${article.summary}`.toLowerCase();
  return PRIORITY_SIGNAL_KEYWORDS
    .filter((signal) => text.includes(signal))
    .slice(0, 4)
    .map((signal) => `핵심 신호 포함: ${signal}`);
}

function getMultiSourceValidationPriority(article: NormalizedArticle, articles: NormalizedArticle[]): number {
  const normalizedTitle = normalizeText(article.title);
  const titleTokens = normalizedTitle.split(" ").filter((token) => token.length >= 4);

  if (titleTokens.length === 0) {
    return 0;
  }

  const corroboratingSources = new Set(
    articles
      .filter((candidate) => candidate.id !== article.id && candidate.source !== article.source)
      .filter((candidate) => {
        const candidateText = normalizeText(`${candidate.title} ${candidate.summary}`);
        return titleTokens.some((token) => candidateText.includes(token));
      })
      .map((candidate) => candidate.source),
  );

  if (corroboratingSources.size >= 2) return 0.9;
  if (corroboratingSources.size === 1) return 0.45;
  return 0;
}

function getMultiSourceValidationReason(article: NormalizedArticle, articles: NormalizedArticle[]): string | null {
  const normalizedTitle = normalizeText(article.title);
  const titleTokens = normalizedTitle.split(" ").filter((token) => token.length >= 4);

  if (titleTokens.length === 0) {
    return null;
  }

  const corroboratingSources = new Set(
    articles
      .filter((candidate) => candidate.id !== article.id && candidate.source !== article.source)
      .filter((candidate) => {
        const candidateText = normalizeText(`${candidate.title} ${candidate.summary}`);
        return titleTokens.some((token) => candidateText.includes(token));
      })
      .map((candidate) => candidate.source),
  );

  if (corroboratingSources.size >= 2) return "여러 소스가 비슷한 이슈를 다룸";
  if (corroboratingSources.size === 1) return "다른 소스에서도 같은 흐름이 확인됨";
  return null;
}

function detectTopicCluster(article: NormalizedArticle): string {
  const text = normalizeText(`${article.title} ${article.summary} ${article.source}`);
  for (const [cluster, keywords] of Object.entries(TOPIC_CLUSTER_KEYWORDS)) {
    if (keywords.some((keyword) => text.includes(normalizeText(keyword)))) {
      return cluster;
    }
  }

  return `${article.category.toLowerCase()}-${article.type}`;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9가-힣]+/g, " ").replace(/\s+/g, " ").trim();
}

function stripMarkup(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getStoryText(article: Pick<NormalizedArticle, "title" | "summary" | "content">): string {
  const cleanedContent = article.content ? stripMarkup(article.content).slice(0, 1600) : "";
  return `${article.title} ${article.summary} ${cleanedContent}`.trim();
}

function getStoryTokens(value: string): string[] {
  return [...new Set(
    normalizeText(value)
      .split(" ")
      .filter((token) => token.length >= 3)
      .filter((token) => !STORY_DUPLICATE_STOPWORDS.has(token)),
  )];
}

function getSharedTokenCount(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const rightSet = new Set(right);
  return left.filter((token) => rightSet.has(token)).length;
}

function getPublishedAtTimestamp(article: NormalizedArticle): number | null {
  if (!article.publishedAtKnown || !article.publishedAt) {
    return null;
  }

  const value = new Date(article.publishedAt).getTime();
  return Number.isNaN(value) ? null : value;
}

function areLikelySameStory(left: NormalizedArticle, right: NormalizedArticle): boolean {
  if (left.id === right.id || left.sourceUrl === right.sourceUrl) {
    return true;
  }

  const normalizedLeftTitle = normalizeText(left.title);
  const normalizedRightTitle = normalizeText(right.title);
  if (normalizedLeftTitle === normalizedRightTitle) {
    return true;
  }

  const leftTitleTokens = getStoryTokens(left.title);
  const rightTitleTokens = getStoryTokens(right.title);
  const sharedTitleTokenCount = getSharedTokenCount(leftTitleTokens, rightTitleTokens);

  const leftContentTokens = getStoryTokens(getStoryText(left));
  const rightContentTokens = getStoryTokens(getStoryText(right));
  const sharedContentTokenCount = getSharedTokenCount(leftContentTokens, rightContentTokens);

  const leftPublishedAt = getPublishedAtTimestamp(left);
  const rightPublishedAt = getPublishedAtTimestamp(right);
  const publishedGapHours = leftPublishedAt !== null && rightPublishedAt !== null
    ? Math.abs(leftPublishedAt - rightPublishedAt) / 36e5
    : null;
  const sameCluster = detectTopicCluster(left) === detectTopicCluster(right);

  if (sharedTitleTokenCount >= 2 && (publishedGapHours === null || publishedGapHours <= 72)) {
    return true;
  }

  if (sameCluster && sharedTitleTokenCount >= 1 && publishedGapHours !== null && publishedGapHours <= 2) {
    return true;
  }

  if (sameCluster && sharedContentTokenCount >= 2 && (publishedGapHours === null || publishedGapHours <= 48)) {
    return true;
  }

  if (sameCluster && sharedTitleTokenCount >= 1 && sharedContentTokenCount >= 1 && publishedGapHours !== null && publishedGapHours <= 24) {
    return true;
  }

  return false;
}

interface PriorCoverage {
  hardExcludedIds: Set<string>;
  hardExcludedUrls: Set<string>;
  hardExcludedTitles: Set<string>;
  recentIds: Set<string>;
  recentUrls: Set<string>;
  recentTitles: Set<string>;
  recentKeywords: Set<string>;
  recentTopicClusters: Set<string>;
  recentArticles: NormalizedArticle[];
}

interface ArticleScoreBreakdown {
  article: NormalizedArticle;
  impactScore: number;
  freshnessScore: number;
  totalScore: number;
  cluster: string;
  reasons: string[];
}

interface IssuePriorityBreakdown {
  score: number;
  normalizedImportance: Briefing["issues"][number]["importance"];
}

function toComparableArticleFromIssue(issue: Briefing["issues"][number]): NormalizedArticle {
  return {
    id: issue.id,
    title: issue.title,
    source: issue.source,
    sourceUrl: issue.sourceUrl,
    publishedAt: issue.sourcePublishedAt ?? `${issue.date}T00:00:00.000Z`,
    publishedAtKnown: Boolean(issue.sourcePublishedAt),
    summary: issue.summary,
    content: issue.summary,
    type: issue.type,
    category: issue.category,
    region: issue.region,
    layer: issue.type === "research" ? "research" : "general-news",
    normalizedTitle: normalizeText(issue.title),
    feedId: issue.source,
    ingestedAt: `${issue.date}T00:00:00.000Z`,
  };
}

function buildPriorCoverage(priorBriefings: Briefing[], date: string): PriorCoverage {
  const hardExcludedIds = new Set<string>();
  const hardExcludedUrls = new Set<string>();
  const hardExcludedTitles = new Set<string>();
  const recentIds = new Set<string>();
  const recentUrls = new Set<string>();
  const recentTitles = new Set<string>();
  const recentKeywords = new Set<string>();
  const recentTopicClusters = new Set<string>();
  const recentArticles: NormalizedArticle[] = [];

  for (const briefing of priorBriefings) {
    const articles = [...briefing.issues, ...briefing.researchHighlights];
    const isSameDay = briefing.date === date;

    for (const article of articles) {
      const normalizedTitle = normalizeText(article.title);
      const comparableArticle = toComparableArticleFromIssue(article);
      recentArticles.push(comparableArticle);
      recentIds.add(article.id);
      recentUrls.add(article.sourceUrl);
      recentTitles.add(normalizedTitle);
      article.keywords.forEach((keyword) => recentKeywords.add(normalizeText(keyword)));
      recentTopicClusters.add(detectTopicCluster(comparableArticle));

      if (isSameDay) {
        hardExcludedIds.add(article.id);
        hardExcludedUrls.add(article.sourceUrl);
        hardExcludedTitles.add(normalizedTitle);
      }
    }
  }

  return {
    hardExcludedIds,
    hardExcludedUrls,
    hardExcludedTitles,
    recentIds,
    recentUrls,
    recentTitles,
    recentKeywords,
    recentTopicClusters,
    recentArticles,
  };
}

function getOverlapPenalty(article: NormalizedArticle, priorCoverage: PriorCoverage): number {
  const normalizedTitle = normalizeText(article.title);

  if (
    priorCoverage.hardExcludedIds.has(article.id)
    || priorCoverage.hardExcludedUrls.has(article.sourceUrl)
    || priorCoverage.hardExcludedTitles.has(normalizedTitle)
  ) {
    return Number.NEGATIVE_INFINITY;
  }

  let penalty = 0;

  if (priorCoverage.recentIds.has(article.id)) {
    penalty += 6;
  }

  if (priorCoverage.recentUrls.has(article.sourceUrl)) {
    penalty += 5;
  }

  if (priorCoverage.recentTitles.has(normalizedTitle)) {
    penalty += 5;
  }

  for (const keyword of normalizeText(`${article.title} ${article.summary}`).split(" ")) {
    if (keyword.length >= 3 && priorCoverage.recentKeywords.has(keyword)) {
      penalty += 0.2;
    }
  }

  if (priorCoverage.recentTopicClusters.has(detectTopicCluster(article))) {
    penalty += 1.5;
  }

  if (priorCoverage.recentArticles.some((recentArticle) => areLikelySameStory(article, recentArticle))) {
    penalty += 6;
  }

  return penalty;
}

function isFreshEnoughForGeneration(article: NormalizedArticle): boolean {
  const ageHours = getArticleAgeHours(article);
  if (ageHours === null) {
    return false;
  }

  if (article.type === "research") {
    return ageHours <= MAX_RESEARCH_AGE_HOURS;
  }

  return ageHours <= MAX_NEWS_AGE_HOURS;
}

function scoreArticleBreakdown(
  article: NormalizedArticle,
  articles: NormalizedArticle[],
  priorCoverage: PriorCoverage,
  trendingSignals: GitHubTrendingSignal[],
): ArticleScoreBreakdown | null {
  const overlapPenalty = getOverlapPenalty(article, priorCoverage);
  if (!Number.isFinite(overlapPenalty)) {
    return null;
  }

  const impactScore = getSourcePriority(article)
    + getLayerPriority(article)
    + getCategoryPriority(article)
    + getSignalPriority(article)
    + getMultiSourceValidationPriority(article, articles)
    + getGitHubTrendingSignalPriority(article, trendingSignals);
  const freshnessScore = getRecencyPriority(article);
  const totalScore = impactScore + freshnessScore - overlapPenalty;
  const reasons = [
    getRecencyReason(article),
    getSourceReason(article),
    getCategoryReason(article),
    getMultiSourceValidationReason(article, articles),
    ...getSignalReasons(article),
  ].filter((reason): reason is string => Boolean(reason));

  return {
    article,
    impactScore,
    freshnessScore,
    totalScore,
    cluster: detectTopicCluster(article),
    reasons: [...new Set(reasons)].slice(0, 5),
  };
}

function seedClusterRepresentatives(scoredArticles: ArticleScoreBreakdown[]): ArticleScoreBreakdown[] {
  const representatives = new Map<string, ArticleScoreBreakdown>();

  for (const scored of scoredArticles) {
    const existing = representatives.get(scored.cluster);
    if (!existing || scored.totalScore > existing.totalScore) {
      representatives.set(scored.cluster, scored);
    }
  }

  return [...representatives.values()].sort((left, right) => {
    if (right.totalScore !== left.totalScore) {
      return right.totalScore - left.totalScore;
    }

    if (right.freshnessScore !== left.freshnessScore) {
      return right.freshnessScore - left.freshnessScore;
    }

    return right.impactScore - left.impactScore;
  });
}

function getImportanceSeedScore(importance: Briefing["issues"][number]["importance"]): number {
  switch (importance) {
    case "High":
      return 2.5;
    case "Medium":
      return 1.2;
    default:
      return 0;
  }
}

function getCategoryUrgencyScore(category: Briefing["issues"][number]["category"]): number {
  switch (category) {
    case "Product":
      return 1.6;
    case "Model":
      return 1.45;
    case "Investment":
      return 1.25;
    case "Infrastructure":
      return 1.1;
    case "Policy":
      return 0.75;
    case "Research":
      return 0.35;
    default:
      return 0;
  }
}

function getIssueRecencyUrgencyScore(issue: Pick<Briefing["issues"][number], "sourcePublishedAt" | "type">): number {
  if (!issue.sourcePublishedAt) {
    return issue.type === "research" ? 0.2 : 0;
  }

  const publishedAt = new Date(issue.sourcePublishedAt);
  if (Number.isNaN(publishedAt.getTime())) {
    return issue.type === "research" ? 0.2 : 0;
  }

  const ageHours = Math.max(0, (Date.now() - publishedAt.getTime()) / 36e5);
  if (issue.type === "research") {
    if (ageHours <= 24) return 1.2;
    if (ageHours <= 72) return 0.8;
    return 0.2;
  }

  if (ageHours <= 6) return 2.2;
  if (ageHours <= 12) return 1.8;
  if (ageHours <= 24) return 1.1;
  if (ageHours <= 48) return 0.3;
  return -0.6;
}

function normalizeIssueImportance(
  issue: Pick<Briefing["issues"][number], "importance" | "category" | "sourcePublishedAt" | "type">,
  scoreBreakdown?: ArticleScoreBreakdown,
): IssuePriorityBreakdown {
  const score = (scoreBreakdown?.totalScore ?? 0)
    + getImportanceSeedScore(issue.importance)
    + getCategoryUrgencyScore(issue.category)
    + getIssueRecencyUrgencyScore(issue);

  if (score >= 15.5) {
    return {
      score,
      normalizedImportance: "High",
    };
  }

  if (score >= 12.5) {
    return {
      score,
      normalizedImportance: "Medium",
    };
  }

  return {
    score,
    normalizedImportance: "Low",
  };
}

function buildScoreLookup(entries: ArticleScoreBreakdown[]): Map<string, ArticleScoreBreakdown> {
  const lookup = new Map<string, ArticleScoreBreakdown>();

  for (const entry of entries) {
    lookup.set(entry.article.id, entry);
    lookup.set(entry.article.sourceUrl, entry);
  }

  return lookup;
}

function prioritizeBriefingIssues<T extends Briefing["issues"][number]>(
  issues: T[],
  scoreLookup: Map<string, ArticleScoreBreakdown>,
): T[] {
  return issues
    .map((issue) => {
      const scoreBreakdown = scoreLookup.get(issue.id) ?? scoreLookup.get(issue.sourceUrl);
      const priority = normalizeIssueImportance(issue, scoreBreakdown);
      return {
        ...issue,
        importance: priority.normalizedImportance,
        __priorityScore: priority.score,
      };
    })
    .sort((left, right) => {
      if (right.__priorityScore !== left.__priorityScore) {
        return right.__priorityScore - left.__priorityScore;
      }

      const rightPublishedAt = right.sourcePublishedAt ?? right.date;
      const leftPublishedAt = left.sourcePublishedAt ?? left.date;
      return rightPublishedAt.localeCompare(leftPublishedAt);
    })
    .map(({ __priorityScore: _priorityScore, ...issue }) => issue as T);
}

function prioritizeBriefingForDisplay(
  briefing: Briefing,
  scoreEntries: ArticleScoreBreakdown[],
): Briefing {
  const scoreLookup = buildScoreLookup(scoreEntries);

  return {
    ...briefing,
    issues: prioritizeBriefingIssues(briefing.issues, scoreLookup),
    researchHighlights: prioritizeBriefingIssues(briefing.researchHighlights, scoreLookup),
  };
}

function selectArticlesForGeneration(
  articles: NormalizedArticle[],
  priorBriefings: Briefing[],
  date: string,
  trendingSignals: GitHubTrendingSignal[],
): NormalizedArticle[] {
  const priorCoverage = buildPriorCoverage(priorBriefings, date);
  const freshArticles = articles.filter(isFreshEnoughForGeneration);
  const candidateArticles = freshArticles.length > 0 ? freshArticles : articles;
  const scoredArticles = [...candidateArticles]
    .map((article) => scoreArticleBreakdown(article, articles, priorCoverage, trendingSignals))
    .filter((entry): entry is ArticleScoreBreakdown => entry !== null)
    .sort((left, right) => {
      if (right.totalScore !== left.totalScore) {
        return right.totalScore - left.totalScore;
      }

      if (right.freshnessScore !== left.freshnessScore) {
        return right.freshnessScore - left.freshnessScore;
      }

      return right.impactScore - left.impactScore;
    });
  const viableScoredArticles = scoredArticles.filter((entry) => entry.totalScore >= MIN_GENERATION_TOTAL_SCORE);
  const scoredSelectionPool = viableScoredArticles.length > 0 ? viableScoredArticles : scoredArticles;
  const rankedArticles = scoredSelectionPool.map((entry) => entry.article);
  const clusterRepresentatives = seedClusterRepresentatives(scoredSelectionPool);

  const selected: NormalizedArticle[] = [];
  const sourceCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  const clusterCounts = new Map<string, number>();
  const layerCounts = new Map<FeedLayer, number>();

  const addArticle = (article: NormalizedArticle, options: { relaxDistribution?: boolean } = {}) => {
    if (selected.some((selectedArticle) => areLikelySameStory(article, selectedArticle))) {
      return false;
    }

    const sourceCount = sourceCounts.get(article.source) ?? 0;
    const categoryCount = categoryCounts.get(article.category) ?? 0;
    const typeCount = typeCounts.get(article.type) ?? 0;
    const cluster = detectTopicCluster(article);
    const clusterCount = clusterCounts.get(cluster) ?? 0;
    const layerCount = layerCounts.get(article.layer) ?? 0;

    if (!options.relaxDistribution && sourceCount >= 4) {
      return false;
    }

    if (!options.relaxDistribution && categoryCount >= 5) {
      return false;
    }

    if (!options.relaxDistribution && article.type === "research" && typeCount >= 4) {
      return false;
    }

    if (clusterCount >= 2) {
      return false;
    }

    if (!options.relaxDistribution && article.layer === "general-news" && layerCount >= 4) {
      return false;
    }

    if (!options.relaxDistribution && article.layer === "official" && layerCount >= 6) {
      return false;
    }

    if (!options.relaxDistribution && article.layer === "specialist-news" && layerCount >= 4) {
      return false;
    }

    selected.push(article);
    sourceCounts.set(article.source, sourceCount + 1);
    categoryCounts.set(article.category, categoryCount + 1);
    typeCounts.set(article.type, typeCount + 1);
    clusterCounts.set(cluster, clusterCount + 1);
    layerCounts.set(article.layer, layerCount + 1);
    return true;
  };

  for (const slot of SELECTION_SLOT_DEFINITIONS) {
    if (selected.length >= MAX_GENERATION_ARTICLES) {
      break;
    }

    const candidate = clusterRepresentatives.find((entry) =>
      slot.matches(entry.article) && !selected.some((selectedArticle) => selectedArticle.id === entry.article.id),
    );

    if (candidate) {
      addArticle(candidate.article);
    }
  }

  const layerSeedOrder: FeedLayer[] = ["general-news", "specialist-news", "official", "research"];
  for (const layer of layerSeedOrder) {
    if (selected.length >= MAX_GENERATION_ARTICLES) {
      break;
    }

    const candidate = clusterRepresentatives.find((entry) =>
      entry.article.layer === layer && !selected.some((selectedArticle) => selectedArticle.id === entry.article.id),
    );

    if (candidate) {
      addArticle(candidate.article);
    }
  }

  for (const representative of clusterRepresentatives) {
    if (selected.length >= MAX_GENERATION_ARTICLES) {
      break;
    }
    if (selected.some((selectedArticle) => selectedArticle.id === representative.article.id)) {
      continue;
    }
    addArticle(representative.article);
  }

  for (const article of rankedArticles) {
    if (selected.length >= MAX_GENERATION_ARTICLES) {
      break;
    }
    if (selected.some((selectedArticle) => selectedArticle.id === article.id)) {
      continue;
    }
    addArticle(article);
  }

  if (selected.length < Math.min(MAX_GENERATION_ARTICLES, rankedArticles.length)) {
    for (const article of rankedArticles) {
      if (selected.length >= MAX_GENERATION_ARTICLES) {
        break;
      }

      if (!selected.some((selectedArticle) => selectedArticle.id === article.id)) {
        addArticle(article, { relaxDistribution: true });
      }
    }
  }

  return selected.sort((left, right) =>
    (right.publishedAt ?? right.ingestedAt).localeCompare(left.publishedAt ?? left.ingestedAt),
  );
}

function buildOpenAIRequestBody(articles: NormalizedArticle[], date: string) {
  return buildChatCompletionRequestBody(
    DAILY_BRIEFING_SYSTEM_PROMPT,
    buildDailyBriefingUserPrompt({ articles, date }),
  );
}

function buildChatCompletionRequestBody(systemPrompt: string, userPrompt: string) {
  return {
    model: getOpenAIModel(),
    temperature: 0.3,
    response_format: {
      type: "json_object",
    },
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userPrompt,
      },
    ],
  };
}

export async function probeOpenAIConnection(logContext: LogContext = {}): Promise<{
  ok: true;
  model: string;
  baseUrl: string;
  usesAzureApiKeyAuth: boolean;
}> {
  await requestOpenAIJson(
    "You are a health check endpoint. Return a tiny JSON object.",
    'Return exactly this JSON: {"ok":true}',
    {
      mode: "probe",
    },
    logContext,
  );

  return {
    ok: true,
    model: getOpenAIModel(),
    baseUrl: getOpenAIBaseUrl(),
    usesAzureApiKeyAuth: shouldUseAzureApiKeyAuth(),
  };
}

async function requestOpenAIJson(
  systemPrompt: string,
  userPrompt: string,
  metadata: Record<string, unknown>,
  logContext: LogContext = {},
): Promise<string> {
  const scopedLogger = logger.child(logContext);
  scopedLogger.info("Starting OpenAI JSON request.", {
    model: getOpenAIModel(),
    ...metadata,
  });
  const response = await withRetry(async () => {
    try {
      return await fetch(buildOpenAIRequestUrl(), {
        method: "POST",
        headers: buildOpenAIHeaders(),
        body: JSON.stringify(buildChatCompletionRequestBody(systemPrompt, userPrompt)),
      });
    } catch (error) {
      throw new BriefingGenerationError("Failed to call OpenAI.", error);
    }
  }, {
    retries: 2,
    shouldRetry: (error) => error instanceof BriefingGenerationError,
  });

  let payload: OpenAIChatCompletionResponse;
  try {
    payload = await response.json() as OpenAIChatCompletionResponse;
  } catch (error) {
    throw new BriefingGenerationError("Failed to parse OpenAI API response.", error);
  }

  if (!response.ok) {
    const apiMessage = payload.error?.message?.trim();
    throw new BriefingGenerationError(apiMessage || `OpenAI API request failed (${response.status}).`);
  }

  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new BriefingGenerationError("OpenAI returned an empty briefing.");
  }

  scopedLogger.info("Completed OpenAI JSON request.", {
    contentLength: content.length,
    ...metadata,
  });

  return content;
}

async function requestGeneratedBriefing(articles: NormalizedArticle[], date: string, logContext: LogContext = {}): Promise<string> {
  return requestOpenAIJson(
    DAILY_BRIEFING_SYSTEM_PROMPT,
    buildDailyBriefingUserPrompt({ articles, date }),
    {
      mode: "generate",
      date,
      articleCount: articles.length,
    },
    logContext,
  );
}

function hasHangul(value: string): boolean {
  return /[가-힣]/.test(value);
}

function needsKoreanLocalization(briefing: Briefing): boolean {
  if (!hasHangul(briefing.dailySummary.trend)) {
    return true;
  }

  if (briefing.trendingTopics.some((topic) => !hasHangul(topic))) {
    return true;
  }

  const visibleArticles = [...briefing.issues, ...briefing.researchHighlights];
  return visibleArticles.some((article) =>
    !hasHangul(article.title)
    || !hasHangul(article.summary)
    || !hasHangul(article.whyItMatters)
    || !hasHangul(article.practicalImpact),
  );
}

async function localizeBriefingForKoreanAudience(briefing: Briefing, logContext: LogContext = {}): Promise<Briefing> {
  const localizedContent = await requestOpenAIJson(
    DAILY_BRIEFING_LOCALIZATION_SYSTEM_PROMPT,
    buildDailyBriefingLocalizationUserPrompt(briefing),
    {
      mode: "localize",
      date: briefing.date,
      articleCount: briefing.issues.length + briefing.researchHighlights.length,
    },
    logContext,
  );

  return parseBriefingResponse(localizedContent, briefing.date, briefing.edition);
}

function parseLocalizedFieldItems(value: unknown): LocalizedBriefingFieldItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const record = item as Record<string, unknown>;
    if (
      typeof record.id !== "string"
      || typeof record.title !== "string"
      || typeof record.summary !== "string"
      || typeof record.whyItMatters !== "string"
      || typeof record.practicalImpact !== "string"
    ) {
      return [];
    }

    return [{
      id: record.id,
      title: record.title.trim(),
      summary: record.summary.trim(),
      whyItMatters: record.whyItMatters.trim(),
      practicalImpact: record.practicalImpact.trim(),
    }];
  });
}

function mergeLocalizedFields(briefing: Briefing, payload: LocalizedBriefingFieldsPayload): Briefing {
  const issueMap = new Map(parseLocalizedFieldItems(payload.issues).map((item) => [item.id, item]));
  const researchMap = new Map(parseLocalizedFieldItems(payload.researchHighlights).map((item) => [item.id, item]));

  return {
    ...briefing,
    dailySummary: {
      ...briefing.dailySummary,
      trend: typeof payload.dailySummary?.trend === "string" && payload.dailySummary.trend.trim()
        ? payload.dailySummary.trend.trim()
        : briefing.dailySummary.trend,
      topKeywords: Array.isArray(payload.dailySummary?.topKeywords)
        ? payload.dailySummary!.topKeywords!.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
        : briefing.dailySummary.topKeywords,
    },
    trendingTopics: Array.isArray(payload.trendingTopics)
      ? payload.trendingTopics.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
      : briefing.trendingTopics,
    issues: briefing.issues.map((issue) => {
      const localized = issueMap.get(issue.id);
      return localized ? {
        ...issue,
        title: localized.title || issue.title,
        summary: localized.summary || issue.summary,
        whyItMatters: localized.whyItMatters || issue.whyItMatters,
        practicalImpact: localized.practicalImpact || issue.practicalImpact,
      } : issue;
    }),
    researchHighlights: briefing.researchHighlights.map((issue) => {
      const localized = researchMap.get(issue.id);
      return localized ? {
        ...issue,
        title: localized.title || issue.title,
        summary: localized.summary || issue.summary,
        whyItMatters: localized.whyItMatters || issue.whyItMatters,
        practicalImpact: localized.practicalImpact || issue.practicalImpact,
      } : issue;
    }),
  };
}

async function localizeDisplayedFieldsForKoreanAudience(briefing: Briefing, logContext: LogContext = {}): Promise<Briefing> {
  const localizedContent = await requestOpenAIJson(
    DAILY_BRIEFING_FIELD_LOCALIZATION_SYSTEM_PROMPT,
    buildDailyBriefingFieldLocalizationUserPrompt(briefing),
    {
      mode: "localize-fields",
      date: briefing.date,
      articleCount: briefing.issues.length + briefing.researchHighlights.length,
    },
    logContext,
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(localizedContent);
  } catch (error) {
    throw new BriefingGenerationError("Failed to parse localized briefing field JSON.", error);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new BriefingGenerationError("Localized briefing field payload was invalid.");
  }

  return mergeLocalizedFields(briefing, parsed as LocalizedBriefingFieldsPayload);
}

export async function generateDailyBriefing(input: GenerateBriefingInput): Promise<Briefing> {
  const scopedLogger = logger.child(input.logContext ?? {});
  if (!Array.isArray(input.articles) || input.articles.length === 0) {
    throw new BriefingGenerationError("At least one normalized article is required.");
  }

  const date = resolveRequestDate(input.date);
  const edition = input.edition ?? resolveBriefingEdition();
  const startedAt = Date.now();
  const freshNewsArticles = input.articles.filter((article) => article.type !== "research" && isFreshEnoughForGeneration(article));
  const freshResearchArticles = input.articles.filter((article) => article.type === "research" && isFreshEnoughForGeneration(article));
  const candidateArticles = [...freshNewsArticles, ...freshResearchArticles].length > 0
    ? [...freshNewsArticles, ...freshResearchArticles]
    : input.articles;
  const trendingSignals = await fetchGitHubTrendingSignals(input.logContext).catch((error) => {
    scopedLogger.exception("Failed to fetch GitHub trending signals; continuing without community signal enrichment.", error, {
      date,
      edition,
    });
    return [];
  });
  const selectedArticles = selectArticlesForGeneration(input.articles, input.priorBriefings ?? [], date, trendingSignals);
  const selectedSources = [...new Set(selectedArticles.map((article) => article.source))];
  const selectedClusters = [...new Set(selectedArticles.map((article) => detectTopicCluster(article)))];
  const matchedTrendingRepos = trendingSignals
    .filter((signal) =>
      selectedArticles.some((article) => getGitHubTrendingSignalPriority(article, [signal]) > 0),
    )
    .slice(0, 8)
    .map((signal) => signal.repo);
  scopedLogger.info("Generating daily briefing.", {
    date,
    edition,
    articleCount: input.articles.length,
    freshNewsArticleCount: freshNewsArticles.length,
    freshResearchArticleCount: freshResearchArticles.length,
    selectedArticleCount: selectedArticles.length,
    priorBriefingCount: input.priorBriefings?.length ?? 0,
    selectedSources,
    selectedClusters,
    trendingSignalCount: trendingSignals.length,
    matchedTrendingRepos,
  });
  const diagnosticArticles = [...candidateArticles]
    .map((article) => scoreArticleBreakdown(article, input.articles, buildPriorCoverage(input.priorBriefings ?? [], date), trendingSignals))
    .filter((entry): entry is ArticleScoreBreakdown => entry !== null);
  const selectedScoreEntries = diagnosticArticles
    .filter((entry) => selectedArticles.some((article) => article.id === entry.article.id));
  try {
    await recordBriefingSelectionDiagnostics({
      date,
      edition,
      selectedArticleCount: selectedArticles.length,
      entries: selectedScoreEntries
        .sort((left, right) => right.totalScore - left.totalScore)
        .map((entry) => ({
          id: entry.article.id,
          title: entry.article.title,
          source: entry.article.source,
          publishedAt: entry.article.publishedAt,
          publishedAtKnown: entry.article.publishedAtKnown,
          cluster: entry.cluster,
          impactScore: Math.round(entry.impactScore * 100) / 100,
          freshnessScore: Math.round(entry.freshnessScore * 100) / 100,
          totalScore: Math.round(entry.totalScore * 100) / 100,
          reasons: entry.reasons,
        })),
    });
  } catch (error) {
    scopedLogger.exception("Failed to persist briefing selection diagnostics; continuing generation.", error, {
      date,
      edition,
      stage: "selection-diagnostics",
    });
  }
  const generatedContent = await requestGeneratedBriefing(selectedArticles, date, input.logContext);
  let briefing = applyBriefingIdentity(
    cloneEnglishFieldsIntoLocalizedShape(parseBriefingResponse(generatedContent, date, edition)),
    date,
    edition,
  );
  briefing = enrichBriefingWithSourcePublishedAt(briefing, selectedArticles);
  briefing = prioritizeBriefingForDisplay(briefing, selectedScoreEntries);

  if (needsKoreanLocalization(briefing)) {
    scopedLogger.info("Applying Korean display-field localization pass to generated briefing.", {
      date,
    });
    try {
      briefing = await localizeDisplayedFieldsForKoreanAudience(briefing, input.logContext);
    } catch (error) {
      scopedLogger.exception("Korean localization fallback failed; saving bilingual English-first briefing instead.", error, {
        date,
        stage: "localize-fields",
      });
    }
  }

  if (needsKoreanLocalization(briefing)) {
    scopedLogger.warn("Generated briefing still contains non-Korean primary display fields after localization; saving bilingual result anyway.", {
      date,
    });
  }

  if (briefing.dailySummary.totalArticles !== briefing.issues.length + briefing.researchHighlights.length) {
    briefing.dailySummary.totalArticles = briefing.issues.length + briefing.researchHighlights.length;
  }

  scopedLogger.info("Daily briefing generated successfully.", {
    date,
    issues: briefing.issues.length,
    researchHighlights: briefing.researchHighlights.length,
    trendingTopics: briefing.trendingTopics.length,
    durationMs: Date.now() - startedAt,
  });

  return briefing;
}
