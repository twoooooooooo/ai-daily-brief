import type { NormalizedArticle } from "../shared/rss.js";

const articleStore = new Map<string, NormalizedArticle>();

export function upsertRssArticles(articles: NormalizedArticle[]): void {
  for (const article of articles) {
    articleStore.set(createArticleStoreKey(article), article);
  }
}

export function listStoredRssArticles(): NormalizedArticle[] {
  return [...articleStore.values()].sort((left, right) =>
    (right.publishedAt ?? right.ingestedAt).localeCompare(left.publishedAt ?? left.ingestedAt),
  );
}

export function clearStoredRssArticles(): void {
  articleStore.clear();
}

export function createArticleStoreKey(article: Pick<NormalizedArticle, "normalizedTitle" | "sourceUrl">): string {
  return `${article.normalizedTitle}::${article.sourceUrl}`;
}
