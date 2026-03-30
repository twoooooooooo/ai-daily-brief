import type { NormalizedArticle } from "../../shared/rss.js";

interface DailyBriefingUserPromptParams {
  articles: NormalizedArticle[];
  date: string;
}

const MAX_SUMMARY_LENGTH = 400;
const MAX_CONTENT_LENGTH = 800;

function truncate(value: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function serializeArticles(articles: NormalizedArticle[]): string {
  return JSON.stringify(
    articles.map((article) => ({
      id: article.id,
      title: article.title,
      source: article.source,
      sourceUrl: article.sourceUrl,
      publishedAt: article.publishedAt,
      summary: truncate(article.summary, MAX_SUMMARY_LENGTH),
      content: article.content ? truncate(article.content, MAX_CONTENT_LENGTH) : "",
      type: article.type,
      category: article.category,
      region: article.region,
    })),
    null,
    2,
  );
}

export function buildDailyBriefingUserPrompt({ articles, date }: DailyBriefingUserPromptParams): string {
  return `
Generate a structured daily AI briefing for ${date} using the normalized articles below.
Use Korean for the primary displayed fields, and use English only for the *En fields.

Normalized articles:
${serializeArticles(articles)}

Return JSON only.
`.trim();
}
