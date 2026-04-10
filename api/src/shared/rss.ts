import type { ArticleType, Category, Region } from "./contracts.js";

export type FeedKind = ArticleType;
export type FeedFormat = "rss" | "anthropic-newsroom" | "mistral-newsroom" | "cohere-changelog";
export type FeedLayer = "general-news" | "specialist-news" | "official" | "research";

export interface RssFeedConfig {
  id: string;
  name: string;
  url: string;
  format?: FeedFormat;
  layer?: FeedLayer;
  kind: FeedKind;
  category: Category;
  region: Region;
  source: string;
}

export interface NormalizedArticle {
  id: string;
  title: string;
  source: string;
  sourceUrl: string;
  publishedAt: string;
  summary: string;
  content?: string;
  type: ArticleType;
  category: Category;
  region: Region;
  layer: FeedLayer;
  normalizedTitle: string;
  feedId: string;
  ingestedAt: string;
}

export type NormalizedRssArticle = NormalizedArticle;

export interface RssIngestionResult {
  feedsProcessed: number;
  articlesDiscovered: number;
  uniqueArticles: number;
  articles: NormalizedArticle[];
}
