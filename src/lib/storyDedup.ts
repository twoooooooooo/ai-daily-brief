import type { Issue, Importance } from "@/types/briefing";
import { isDomesticSourceName } from "@/lib/domesticSources";

const STORY_DUPLICATE_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "into", "that", "this", "their", "about", "what", "your",
  "have", "will", "help", "using", "used", "news", "latest", "update", "updates", "new",
  "launch", "launched", "release", "released", "introducing", "announces", "announced", "adds",
  "added", "openai", "google", "anthropic", "claude", "mistral", "cohere", "microsoft", "meta",
  "nvidia", "aws", "hugging", "face", "techcrunch", "wired", "verge", "review", "mit", "ai",
  "gpt", "chatgpt", "gemini", "llm", "llms", "more", "next", "only", "why", "how", "use", "uses",
  "like", "into", "through", "after", "before", "over", "under", "must", "never",
]);

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9가-힣]+/g, " ").replace(/\s+/g, " ").trim();
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

function getPublishedAtTimestamp(issue: Issue): number | null {
  const value = new Date(issue.sourcePublishedAt ?? issue.date).getTime();
  return Number.isNaN(value) ? null : value;
}

function getImportanceWeight(importance: Importance): number {
  switch (importance) {
    case "High":
      return 2;
    case "Medium":
      return 1;
    default:
      return 0;
  }
}

function getDisplayPriority(issue: Issue): number {
  const publishedAt = getPublishedAtTimestamp(issue);
  const recencyWeight = publishedAt ? Math.max(0, 1 - ((Date.now() - publishedAt) / 36e5 / 72)) : 0;
  return (isDomesticSourceName(issue.source) ? 3 : 0) + getImportanceWeight(issue.importance) + recencyWeight;
}

export function areLikelySameDisplayStory(left: Issue, right: Issue): boolean {
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

  const leftStoryTokens = getStoryTokens(`${left.title} ${left.summary}`);
  const rightStoryTokens = getStoryTokens(`${right.title} ${right.summary}`);
  const sharedStoryTokenCount = getSharedTokenCount(leftStoryTokens, rightStoryTokens);

  const leftPublishedAt = getPublishedAtTimestamp(left);
  const rightPublishedAt = getPublishedAtTimestamp(right);
  const publishedGapHours = leftPublishedAt !== null && rightPublishedAt !== null
    ? Math.abs(leftPublishedAt - rightPublishedAt) / 36e5
    : null;

  if (sharedTitleTokenCount >= 2 && (publishedGapHours === null || publishedGapHours <= 72)) {
    return true;
  }

  if (sharedTitleTokenCount >= 1 && sharedStoryTokenCount >= 2 && (publishedGapHours === null || publishedGapHours <= 48)) {
    return true;
  }

  if (sharedStoryTokenCount >= 3 && (publishedGapHours === null || publishedGapHours <= 24)) {
    return true;
  }

  return false;
}

export function dedupeNewsForDisplay(issues: Issue[]): Issue[] {
  const selected: Issue[] = [];

  for (const issue of issues) {
    const duplicateIndex = selected.findIndex((candidate) => areLikelySameDisplayStory(issue, candidate));
    if (duplicateIndex === -1) {
      selected.push(issue);
      continue;
    }

    const existing = selected[duplicateIndex];
    if (getDisplayPriority(issue) > getDisplayPriority(existing)) {
      selected[duplicateIndex] = issue;
    }
  }

  return selected.sort((left, right) => getDisplayPriority(right) - getDisplayPriority(left));
}
