import type { ArticleType, Category, Region } from "./contracts.js";

export type FeedKind = ArticleType;

export interface RssFeedConfig {
  id: string;
  name: string;
  url: string;
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
