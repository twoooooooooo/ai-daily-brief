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
const logger = createLogger("briefing-generation");

interface GenerateBriefingInput {
  articles: NormalizedArticle[];
  date?: string;
  edition?: BriefingEdition;
  priorBriefings?: Briefing[];
  logContext?: LogContext;
}

const MAX_GENERATION_ARTICLES = 16;
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
    })),
    researchHighlights: briefing.researchHighlights.map((issue) => ({
      ...issue,
      titleEn: issue.titleEn || issue.title,
      summaryEn: issue.summaryEn || issue.summary,
      whyItMattersEn: issue.whyItMattersEn || issue.whyItMatters,
      practicalImpactEn: issue.practicalImpactEn || issue.practicalImpact,
    })),
    trendingTopicsEn: briefing.trendingTopicsEn.length > 0
      ? [...briefing.trendingTopicsEn]
      : [...briefing.trendingTopics],
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

  if (source.includes("anthropic")) return 3.45;
  if (source.includes("techcrunch")) return 3.5;
  if (source.includes("wired")) return 3.35;
  if (source.includes("openai")) return 3.4;
  if (source.includes("microsoft")) return 3.3;
  if (source.includes("google")) return 3.2;
  if (source.includes("nvidia")) return 3.15;
  if (source.includes("meta")) return 3.05;
  if (source.includes("aws")) return 3;
  if (source.includes("hugging face")) return 3;
  if (source.includes("arxiv")) return 2.2;
  return 2;
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

function getRecencyPriority(article: NormalizedArticle): number {
  const ageHours = Math.max(0, (Date.now() - new Date(article.publishedAt).getTime()) / 36e5);
  if (ageHours <= 24) return 3;
  if (ageHours <= 72) return 2;
  if (ageHours <= 168) return 1;
  return 0;
}

function getSignalPriority(article: NormalizedArticle): number {
  const text = `${article.title} ${article.summary}`.toLowerCase();
  return PRIORITY_SIGNAL_KEYWORDS.reduce((score, signal) => score + (text.includes(signal) ? 0.28 : 0), 0);
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

interface PriorCoverage {
  hardExcludedIds: Set<string>;
  hardExcludedUrls: Set<string>;
  hardExcludedTitles: Set<string>;
  recentIds: Set<string>;
  recentUrls: Set<string>;
  recentTitles: Set<string>;
  recentKeywords: Set<string>;
  recentTopicClusters: Set<string>;
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

  for (const briefing of priorBriefings) {
    const articles = [...briefing.issues, ...briefing.researchHighlights];
    const isSameDay = briefing.date === date;

    for (const article of articles) {
      const normalizedTitle = normalizeText(article.title);
      recentIds.add(article.id);
      recentUrls.add(article.sourceUrl);
      recentTitles.add(normalizedTitle);
      article.keywords.forEach((keyword) => recentKeywords.add(normalizeText(keyword)));
      recentTopicClusters.add(detectTopicCluster({
        id: article.id,
        title: article.title,
        source: article.source,
        sourceUrl: article.sourceUrl,
        publishedAt: `${article.date}T00:00:00.000Z`,
        summary: article.summary,
        content: article.summary,
        type: article.type,
        category: article.category,
        region: article.region,
        layer: article.type === "research" ? "research" : "general-news",
        normalizedTitle: normalizeText(article.title),
        feedId: article.source,
        ingestedAt: `${article.date}T00:00:00.000Z`,
      }));

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

  return penalty;
}

function scoreArticle(article: NormalizedArticle, articles: NormalizedArticle[], priorCoverage: PriorCoverage): number {
  const overlapPenalty = getOverlapPenalty(article, priorCoverage);
  if (!Number.isFinite(overlapPenalty)) {
    return Number.NEGATIVE_INFINITY;
  }

  return getSourcePriority(article)
    + getLayerPriority(article)
    + getCategoryPriority(article)
    + getRecencyPriority(article)
    + getSignalPriority(article)
    + getMultiSourceValidationPriority(article, articles)
    - overlapPenalty;
}

function selectArticlesForGeneration(articles: NormalizedArticle[], priorBriefings: Briefing[], date: string): NormalizedArticle[] {
  const priorCoverage = buildPriorCoverage(priorBriefings, date);
  const rankedArticles = [...articles]
    .map((article) => ({ article, score: scoreArticle(article, articles, priorCoverage) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.article);

  const selected: NormalizedArticle[] = [];
  const sourceCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  const clusterCounts = new Map<string, number>();
  const layerCounts = new Map<FeedLayer, number>();

  const addArticle = (article: NormalizedArticle) => {
    const sourceCount = sourceCounts.get(article.source) ?? 0;
    const categoryCount = categoryCounts.get(article.category) ?? 0;
    const typeCount = typeCounts.get(article.type) ?? 0;
    const cluster = detectTopicCluster(article);
    const clusterCount = clusterCounts.get(cluster) ?? 0;
    const layerCount = layerCounts.get(article.layer) ?? 0;

    if (sourceCount >= 4) {
      return false;
    }

    if (categoryCount >= 5) {
      return false;
    }

    if (article.type === "research" && typeCount >= 5) {
      return false;
    }

    if (clusterCount >= 2) {
      return false;
    }

    if (article.layer === "general-news" && layerCount >= 4) {
      return false;
    }

    if (article.layer === "official" && layerCount >= 6) {
      return false;
    }

    if (article.layer === "specialist-news" && layerCount >= 4) {
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

  const layerSeedOrder: FeedLayer[] = ["general-news", "specialist-news", "official", "research"];
  for (const layer of layerSeedOrder) {
    if (selected.length >= MAX_GENERATION_ARTICLES) {
      break;
    }

    const candidate = rankedArticles.find((article) =>
      article.layer === layer && !selected.some((selectedArticle) => selectedArticle.id === article.id),
    );

    if (candidate) {
      addArticle(candidate);
    }
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
        selected.push(article);
      }
    }
  }

  return selected.sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
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
  const selectedArticles = selectArticlesForGeneration(input.articles, input.priorBriefings ?? [], date);
  const selectedSources = [...new Set(selectedArticles.map((article) => article.source))];
  const selectedClusters = [...new Set(selectedArticles.map((article) => detectTopicCluster(article)))];
  scopedLogger.info("Generating daily briefing.", {
    date,
    edition,
    articleCount: input.articles.length,
    selectedArticleCount: selectedArticles.length,
    priorBriefingCount: input.priorBriefings?.length ?? 0,
    selectedSources,
    selectedClusters,
  });
  const generatedContent = await requestGeneratedBriefing(selectedArticles, date, input.logContext);
  let briefing = applyBriefingIdentity(
    cloneEnglishFieldsIntoLocalizedShape(parseBriefingResponse(generatedContent, date, edition)),
    date,
    edition,
  );

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
