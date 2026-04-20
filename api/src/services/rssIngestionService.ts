import { XMLParser } from "fast-xml-parser";
import { rssFeeds } from "../config/rssFeeds.js";
import type { NormalizedArticle, RssFeedConfig, RssIngestionResult } from "../shared/rss.js";
import { createLogger, type LogContext } from "../utils/logger.js";
import { withRetry } from "../utils/retry.js";
import { createArticleStoreKey, listStoredRssArticles, upsertRssArticles } from "./rssArticleStore.js";

interface ParsedRssRoot {
  rss?: {
    channel?: {
      item?: ParsedFeedItem | ParsedFeedItem[];
    };
  };
  feed?: {
    entry?: ParsedFeedItem | ParsedFeedItem[];
  };
}

interface ParsedFeedLink {
  "@_href"?: string;
  "@_rel"?: string;
  "#text"?: string;
}

interface ParsedFeedItem {
  title?: string;
  link?: string | ParsedFeedLink | ParsedFeedLink[];
  pubDate?: string;
  published?: string;
  updated?: string;
  description?: string;
  summary?: string;
  content?: string;
  "content:encoded"?: string;
  category?: string | string[] | { "#text"?: string } | Array<{ "#text"?: string }>;
  source?: string | { "#text"?: string };
}

interface LgAiResearchApiListResponse {
  data?: {
    list?: Array<{
      seq?: number;
      ttl?: string;
      cont?: string;
      description?: string;
      expsYmd?: string;
    }>;
  };
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  parseTagValue: false,
});

const logger = createLogger("rss-ingestion");
const anthropicBaseUrl = "https://www.anthropic.com";

export class RssIngestionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "RssIngestionError";
  }
}

function normalizeWhitespace(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function stripMarkup(value: string): string {
  return value.replace(/<[^>]+>/g, " ").trim();
}

function normalizeTitle(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function slugify(value: string): string {
  const normalized = normalizeTitle(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "article";
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function resolveItemLink(feed: RssFeedConfig, link: ParsedFeedItem["link"]): string {
  if (!link) return "";
  if (typeof link === "string") {
    return resolveAbsoluteUrl(feed, link.trim());
  }

  const links = toArray(link);
  const alternateLink = links.find((item) => item["@_rel"] === "alternate") ?? links[0];
  return resolveAbsoluteUrl(feed, (alternateLink?.["@_href"] ?? alternateLink?.["#text"] ?? "").trim());
}

function resolveItemSource(feed: RssFeedConfig, item: ParsedFeedItem): string {
  if (typeof item.source === "string" && item.source.trim()) {
    return item.source.trim();
  }

  if (typeof item.source === "object" && item.source?.["#text"]?.trim()) {
    return item.source["#text"].trim();
  }

  return feed.source;
}

function resolvePublishedAt(item: ParsedFeedItem): {
  value?: string;
  known: boolean;
} {
  const rawDate = item.pubDate ?? item.published ?? item.updated;
  if (!rawDate) {
    return { value: undefined, known: false };
  }

  const parsed = parsePublishedAtValue(rawDate);
  if (Number.isNaN(parsed.getTime())) {
    return { value: undefined, known: false };
  }

  return {
    value: parsed.toISOString(),
    known: true,
  };
}

function resolveSummary(item: ParsedFeedItem): string {
  const rawSummary = item.description ?? item.summary ?? item.content ?? "";
  return normalizeWhitespace(rawSummary);
}

function resolveContent(item: ParsedFeedItem): string | undefined {
  const rawContent = item["content:encoded"] ?? item.content ?? item.summary ?? item.description;
  const normalized = normalizeWhitespace(rawContent ?? "");
  return normalized || undefined;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function buildArticleId(feed: RssFeedConfig, title: string, publishedAt?: string): string {
  return `${feed.id}-${slugify(title)}-${publishedAt?.slice(0, 10) ?? "undated"}`;
}

function resolveAbsoluteUrl(feed: RssFeedConfig, value: string): string {
  if (!value) {
    return "";
  }

  try {
    return new URL(value, feed.linkBaseUrl ?? feed.url).toString();
  } catch {
    return value;
  }
}

function parseKoreanPeriodDate(value: string): Date | null {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(오전|오후)\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return null;
  }

  const [, year, month, day, period, hourText, minute, second = "00"] = match;
  const rawHour = Number(hourText);
  let hour = rawHour % 12;
  if (period === "오후") {
    hour += 12;
  }

  return new Date(`${year}-${month}-${day}T${String(hour).padStart(2, "0")}:${minute}:${second}+09:00`);
}

function parseCompactKoreanDate(value: string): Date | null {
  const match = value.trim().match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  return new Date(`${year}-${month}-${day}T00:00:00+09:00`);
}

function parsePublishedAtValue(value: string): Date {
  const koreanPeriodDate = parseKoreanPeriodDate(value);
  if (koreanPeriodDate) {
    return koreanPeriodDate;
  }

  const compactKoreanDate = parseCompactKoreanDate(value);
  if (compactKoreanDate) {
    return compactKoreanDate;
  }

  return new Date(value);
}

function getArticleSortTimestamp(article: NormalizedArticle): string {
  return article.publishedAt ?? article.ingestedAt;
}

function extractFeedItems(parsedXml: ParsedRssRoot): ParsedFeedItem[] {
  const rssItems = toArray(parsedXml.rss?.channel?.item);
  const atomItems = toArray(parsedXml.feed?.entry);
  return [...rssItems, ...atomItems];
}

function normalizeFeedItem(feed: RssFeedConfig, item: ParsedFeedItem): NormalizedArticle | null {
  const title = normalizeWhitespace(item.title ?? "");
  const sourceUrl = resolveItemLink(feed, item.link);

  if (!title || !sourceUrl) {
    return null;
  }

  const publishedAt = resolvePublishedAt(item);
  return {
    id: buildArticleId(feed, title, publishedAt.value),
    title,
    source: resolveItemSource(feed, item),
    sourceUrl,
    publishedAt: publishedAt.value,
    publishedAtKnown: publishedAt.known,
    summary: resolveSummary(item),
    content: resolveContent(item),
    type: feed.kind,
    category: feed.category,
    region: feed.region,
    layer: feed.layer ?? (feed.kind === "research" ? "research" : "general-news"),
    normalizedTitle: normalizeTitle(title),
    feedId: feed.id,
    ingestedAt: new Date().toISOString(),
  };
}

function matchesKeywordFilter(feed: RssFeedConfig, article: NormalizedArticle): boolean {
  if (!feed.keywordFilters || feed.keywordFilters.length === 0) {
    return true;
  }

  const normalizedText = normalizeTitle(`${article.title} ${article.summary} ${article.content ?? ""} ${article.source}`);
  const textTokens = new Set(normalizedText.split(" ").filter(Boolean));

  return feed.keywordFilters.some((keyword) => {
    const normalizedKeyword = normalizeTitle(keyword);
    if (!normalizedKeyword) {
      return false;
    }

    if (normalizedKeyword.includes(" ")) {
      return normalizedText.includes(normalizedKeyword);
    }

    if (normalizedKeyword.length <= 2) {
      return textTokens.has(normalizedKeyword);
    }

    return normalizedText.includes(normalizedKeyword) || textTokens.has(normalizedKeyword);
  });
}

async function fetchFeedXml(feed: RssFeedConfig): Promise<string> {
  const response = await withRetry(async () => {
    try {
      return await fetch(feed.url, {
        headers: {
          Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
        },
      });
    } catch (error) {
      throw new RssIngestionError(`Failed to fetch RSS feed: ${feed.id}`, error);
    }
  }, {
    retries: 2,
    shouldRetry: (error) => error instanceof RssIngestionError,
  });

  if (!response.ok) {
    throw new RssIngestionError(`Failed to fetch RSS feed: ${feed.id} (${response.status})`);
  }

  return response.text();
}

function parseAnthropicNewsroom(feed: RssFeedConfig, html: string): NormalizedArticle[] {
  const itemPattern = /<a href="(?<path>\/(?:news\/[a-z0-9-]+|[a-z0-9-]+))"[^>]*>(?:(?!<a\b)[\s\S])*?<time[^>]*>(?<date>[^<]+)<\/time>(?:(?!<a\b)[\s\S])*?<h[1-6][^>]*>(?<title>[^<]+)<\/h[1-6]>(?:(?!<a\b)[\s\S])*?<p[^>]*>(?<summary>[\s\S]*?)<\/p>/g;
  const articles = new Map<string, NormalizedArticle>();

  for (const match of html.matchAll(itemPattern)) {
    const path = match.groups?.path?.trim() ?? "";
    const rawTitle = decodeHtmlEntities(match.groups?.title ?? "");
    const rawSummary = decodeHtmlEntities(match.groups?.summary ?? "");
    const rawDate = decodeHtmlEntities(match.groups?.date ?? "");

    if (!path || !rawTitle || !rawSummary || !rawDate) {
      continue;
    }

    if (!path.startsWith("/news/") && path !== "/81k-interviews") {
      continue;
    }

    const parsedDate = new Date(rawDate);
    const publishedAt = Number.isNaN(parsedDate.getTime())
      ? undefined
      : parsedDate.toISOString();
    const title = normalizeWhitespace(rawTitle);
    const summary = normalizeWhitespace(rawSummary);
    const sourceUrl = `${anthropicBaseUrl}${path}`;

    const article: NormalizedArticle = {
      id: buildArticleId(feed, title, publishedAt),
      title,
      source: feed.source,
      sourceUrl,
      publishedAt,
      publishedAtKnown: Boolean(publishedAt),
      summary,
      content: summary,
      type: feed.kind,
      category: feed.category,
      region: feed.region,
      layer: feed.layer ?? (feed.kind === "research" ? "research" : "general-news"),
      normalizedTitle: normalizeTitle(title),
      feedId: feed.id,
      ingestedAt: new Date().toISOString(),
    };

    articles.set(createArticleStoreKey(article), article);
  }

  return [...articles.values()].sort((left, right) => getArticleSortTimestamp(right).localeCompare(getArticleSortTimestamp(left)));
}

function parseMistralNewsroom(feed: RssFeedConfig, html: string): NormalizedArticle[] {
  const itemPattern = /<a class="group" href="(?<path>\/news\/[a-z0-9-]+)"><article[\s\S]*?<h1[^>]*>(?<title>[^<]+)<\/h1>[\s\S]*?<p[^>]*>(?<summary>[\s\S]*?)<\/p>[\s\S]*?text-sm flex items-center h-full px-3 text-mistral-black-tint">(?<date>[^<]+)<\/div>/g;
  const articles = new Map<string, NormalizedArticle>();

  for (const match of html.matchAll(itemPattern)) {
    const path = match.groups?.path?.trim() ?? "";
    const rawTitle = decodeHtmlEntities(match.groups?.title ?? "");
    const rawSummary = decodeHtmlEntities(match.groups?.summary ?? "");
    const rawDate = decodeHtmlEntities(match.groups?.date ?? "");

    if (!path || !rawTitle || !rawSummary || !rawDate) {
      continue;
    }

    const parsedDate = new Date(rawDate);
    const publishedAt = Number.isNaN(parsedDate.getTime())
      ? undefined
      : parsedDate.toISOString();
    const title = normalizeWhitespace(rawTitle);
    const summary = normalizeWhitespace(rawSummary);
    const sourceUrl = `https://mistral.ai${path}`;

    const article: NormalizedArticle = {
      id: buildArticleId(feed, title, publishedAt),
      title,
      source: feed.source,
      sourceUrl,
      publishedAt,
      publishedAtKnown: Boolean(publishedAt),
      summary,
      content: summary,
      type: feed.kind,
      category: feed.category,
      region: feed.region,
      layer: feed.layer ?? (feed.kind === "research" ? "research" : "general-news"),
      normalizedTitle: normalizeTitle(title),
      feedId: feed.id,
      ingestedAt: new Date().toISOString(),
    };

    articles.set(createArticleStoreKey(article), article);
  }

  return [...articles.values()].sort((left, right) => getArticleSortTimestamp(right).localeCompare(getArticleSortTimestamp(left)));
}

function parseCohereChangelog(feed: RssFeedConfig, html: string): NormalizedArticle[] {
  const frontmatterPattern = /"frontmatter":\{"title":"(?<title>[^"]+)","slug":"(?<slug>[^"]+)","type":"(?<type>[^"]*)","createdAt":"(?<createdAt>[^"]+)","hidden":(?<hidden>true|false),"description":"(?<description>[^"]*)"/g;
  const articles = new Map<string, NormalizedArticle>();

  for (const match of html.matchAll(frontmatterPattern)) {
    const rawTitle = decodeHtmlEntities(match.groups?.title ?? "");
    const rawSlug = decodeHtmlEntities(match.groups?.slug ?? "");
    const rawDescription = decodeHtmlEntities(match.groups?.description ?? "");
    const rawCreatedAt = decodeHtmlEntities(match.groups?.createdAt ?? "");
    const hidden = match.groups?.hidden === "true";

    if (hidden || !rawTitle || !rawSlug || !rawCreatedAt) {
      continue;
    }

    const parsedDate = new Date(rawCreatedAt);
    const publishedAt = Number.isNaN(parsedDate.getTime())
      ? undefined
      : parsedDate.toISOString();
    const title = normalizeWhitespace(rawTitle);
    const summary = normalizeWhitespace(rawDescription || `${title} was published in Cohere's official changelog.`);
    const sourceUrl = `https://docs.cohere.com/${rawSlug.replace(/^\/+/, "")}`;

    const article: NormalizedArticle = {
      id: buildArticleId(feed, title, publishedAt),
      title,
      source: feed.source,
      sourceUrl,
      publishedAt,
      publishedAtKnown: Boolean(publishedAt),
      summary,
      content: summary,
      type: feed.kind,
      category: feed.category,
      region: feed.region,
      layer: feed.layer ?? (feed.kind === "research" ? "research" : "general-news"),
      normalizedTitle: normalizeTitle(title),
      feedId: feed.id,
      ingestedAt: new Date().toISOString(),
    };

    articles.set(createArticleStoreKey(article), article);
  }

  return [...articles.values()].sort((left, right) => getArticleSortTimestamp(right).localeCompare(getArticleSortTimestamp(left)));
}

function parseLgAiResearchApi(feed: RssFeedConfig, payloadText: string): NormalizedArticle[] {
  let payload: LgAiResearchApiListResponse;

  try {
    payload = JSON.parse(payloadText) as LgAiResearchApiListResponse;
  } catch (error) {
    throw new RssIngestionError(`Failed to parse LG AI Research API payload: ${feed.id}`, error);
  }

  const entries = payload.data?.list ?? [];
  const articles = new Map<string, NormalizedArticle>();

  for (const entry of entries) {
    const title = normalizeWhitespace(entry.ttl ?? "");
    if (!title || typeof entry.seq !== "number") {
      continue;
    }

    const publishedAt = entry.expsYmd ? parsePublishedAtValue(entry.expsYmd).toISOString() : undefined;
    const summarySource = entry.description?.trim() || entry.cont || "";
    const summary = normalizeWhitespace(stripMarkup(summarySource)).slice(0, 420);
    const content = stripMarkup(entry.cont ?? "");
    const sourceUrl = `https://www.lgresearch.ai/news/view?seq=${entry.seq}`;

    const article: NormalizedArticle = {
      id: buildArticleId(feed, title, publishedAt),
      title,
      source: feed.source,
      sourceUrl,
      publishedAt,
      publishedAtKnown: Boolean(publishedAt),
      summary,
      content: content || undefined,
      type: feed.kind,
      category: feed.category,
      region: feed.region,
      layer: feed.layer ?? (feed.kind === "research" ? "research" : "general-news"),
      normalizedTitle: normalizeTitle(title),
      feedId: feed.id,
      ingestedAt: new Date().toISOString(),
    };

    articles.set(createArticleStoreKey(article), article);
  }

  return [...articles.values()].sort((left, right) => getArticleSortTimestamp(right).localeCompare(getArticleSortTimestamp(left)));
}

async function ingestFeed(feed: RssFeedConfig): Promise<NormalizedArticle[]> {
  logger.info("Starting RSS feed ingestion.", { feedId: feed.id, url: feed.url });

  if (feed.format === "lg-ai-research-api") {
    const normalizedArticles = parseLgAiResearchApi(feed, await fetchFeedXml(feed));
    logger.info("Completed LG AI Research API ingestion.", {
      feedId: feed.id,
      discoveredArticles: normalizedArticles.length,
    });
    return normalizedArticles;
  }

  const body = await fetchFeedXml(feed);

  if (feed.format === "anthropic-newsroom") {
    const normalizedArticles = parseAnthropicNewsroom(feed, body);
    logger.info("Completed Anthropic newsroom ingestion.", {
      feedId: feed.id,
      discoveredArticles: normalizedArticles.length,
    });
    return normalizedArticles;
  }

  if (feed.format === "mistral-newsroom") {
    const normalizedArticles = parseMistralNewsroom(feed, body);
    logger.info("Completed Mistral newsroom ingestion.", {
      feedId: feed.id,
      discoveredArticles: normalizedArticles.length,
    });
    return normalizedArticles;
  }

  if (feed.format === "cohere-changelog") {
    const normalizedArticles = parseCohereChangelog(feed, body);
    logger.info("Completed Cohere changelog ingestion.", {
      feedId: feed.id,
      discoveredArticles: normalizedArticles.length,
    });
    return normalizedArticles;
  }

  let parsedXml: ParsedRssRoot;
  try {
    parsedXml = xmlParser.parse(body) as ParsedRssRoot;
  } catch (error) {
    throw new RssIngestionError(`Failed to parse RSS feed: ${feed.id}`, error);
  }

  const normalizedArticles = extractFeedItems(parsedXml)
    .map((item) => normalizeFeedItem(feed, item))
    .filter((article): article is NormalizedArticle => article !== null)
    .filter((article) => matchesKeywordFilter(feed, article));

  logger.info("Completed RSS feed ingestion.", {
    feedId: feed.id,
    discoveredArticles: normalizedArticles.length,
  });

  return normalizedArticles;
}

function dedupeArticles(articles: NormalizedArticle[]): NormalizedArticle[] {
  const deduped = new Map<string, NormalizedArticle>();

  for (const article of articles) {
    deduped.set(createArticleStoreKey(article), article);
  }

  return [...deduped.values()].sort((left, right) =>
    getArticleSortTimestamp(right).localeCompare(getArticleSortTimestamp(left)),
  );
}

interface IngestionLogOptions extends LogContext {}

export async function ingestConfiguredRssFeeds(logOptions: IngestionLogOptions = {}): Promise<RssIngestionResult> {
  const scopedLogger = logger.child(logOptions);
  scopedLogger.info("Starting configured RSS ingestion.", { feedCount: rssFeeds.length });
  const ingestionResults = await Promise.allSettled(rssFeeds.map((feed) => ingestFeed(feed)));
  const successfulIngestions = ingestionResults
    .filter((result): result is PromiseFulfilledResult<NormalizedArticle[]> => result.status === "fulfilled");
  const failedIngestions = ingestionResults
    .filter((result): result is PromiseRejectedResult => result.status === "rejected");

  for (const failedResult of failedIngestions) {
    const error = failedResult.reason;
    scopedLogger.exception("RSS feed ingestion failed.", error, {
      feedIndex: failedIngestions.indexOf(failedResult),
    });
  }

  if (successfulIngestions.length === 0) {
    scopedLogger.error("All configured RSS feeds failed.");
    throw new RssIngestionError("All configured RSS feeds failed.");
  }

  const discoveredArticles = successfulIngestions.flatMap((result) => result.value);
  const uniqueArticles = dedupeArticles(discoveredArticles);

  upsertRssArticles(uniqueArticles);

  scopedLogger.info("Completed configured RSS ingestion.", {
    feedsProcessed: rssFeeds.length,
    feedsSucceeded: successfulIngestions.length,
    feedsFailed: failedIngestions.length,
    articlesDiscovered: discoveredArticles.length,
    uniqueArticles: uniqueArticles.length,
  });

  return {
    feedsProcessed: rssFeeds.length,
    articlesDiscovered: discoveredArticles.length,
    uniqueArticles: uniqueArticles.length,
    articles: listStoredRssArticles(),
  };
}
