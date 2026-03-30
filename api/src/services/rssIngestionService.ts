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
  source?: string | { "#text"?: string };
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  parseTagValue: false,
});

const logger = createLogger("rss-ingestion");

export class RssIngestionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "RssIngestionError";
  }
}

function normalizeWhitespace(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
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

function resolveItemLink(link: ParsedFeedItem["link"]): string {
  if (!link) return "";
  if (typeof link === "string") return link.trim();

  const links = toArray(link);
  const alternateLink = links.find((item) => item["@_rel"] === "alternate") ?? links[0];
  return (alternateLink?.["@_href"] ?? alternateLink?.["#text"] ?? "").trim();
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

function resolvePublishedAt(item: ParsedFeedItem): string {
  const rawDate = item.pubDate ?? item.published ?? item.updated;
  if (!rawDate) {
    return new Date().toISOString();
  }

  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
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

function buildArticleId(feed: RssFeedConfig, title: string, publishedAt: string): string {
  return `${feed.id}-${slugify(title)}-${publishedAt.slice(0, 10)}`;
}

function extractFeedItems(parsedXml: ParsedRssRoot): ParsedFeedItem[] {
  const rssItems = toArray(parsedXml.rss?.channel?.item);
  const atomItems = toArray(parsedXml.feed?.entry);
  return [...rssItems, ...atomItems];
}

function normalizeFeedItem(feed: RssFeedConfig, item: ParsedFeedItem): NormalizedArticle | null {
  const title = normalizeWhitespace(item.title ?? "");
  const sourceUrl = resolveItemLink(item.link);

  if (!title || !sourceUrl) {
    return null;
  }

  const publishedAt = resolvePublishedAt(item);
  return {
    id: buildArticleId(feed, title, publishedAt),
    title,
    source: resolveItemSource(feed, item),
    sourceUrl,
    publishedAt,
    summary: resolveSummary(item),
    content: resolveContent(item),
    type: feed.kind,
    category: feed.category,
    region: feed.region,
    normalizedTitle: normalizeTitle(title),
    feedId: feed.id,
    ingestedAt: new Date().toISOString(),
  };
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

async function ingestFeed(feed: RssFeedConfig): Promise<NormalizedArticle[]> {
  logger.info("Starting RSS feed ingestion.", { feedId: feed.id, url: feed.url });
  const xml = await fetchFeedXml(feed);

  let parsedXml: ParsedRssRoot;
  try {
    parsedXml = xmlParser.parse(xml) as ParsedRssRoot;
  } catch (error) {
    throw new RssIngestionError(`Failed to parse RSS feed: ${feed.id}`, error);
  }

  const normalizedArticles = extractFeedItems(parsedXml)
    .map((item) => normalizeFeedItem(feed, item))
    .filter((article): article is NormalizedArticle => article !== null);

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
    right.publishedAt.localeCompare(left.publishedAt),
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
