import { createLogger, type LogContext } from "../utils/logger.js";

export interface GitHubTrendingSignal {
  repo: string;
  description: string;
  language?: string;
  starsToday: number;
  keywords: string[];
}

const logger = createLogger("github-trending-signal");
const GITHUB_TRENDING_URL = "https://github.com/trending?since=daily";
const SIGNAL_KEYWORDS = [
  "ai",
  "llm",
  "agent",
  "agents",
  "mcp",
  "rag",
  "model",
  "models",
  "openai",
  "anthropic",
  "claude",
  "gpt",
  "gemini",
  "llama",
  "mistral",
  "xai",
  "perplexity",
  "cohere",
  "prompt",
  "reasoning",
  "eval",
  "benchmark",
  "vision",
  "audio",
  "speech",
  "inference",
  "training",
  "embedding",
  "embeddings",
  "vector",
  "search",
  "copilot",
  "assistant",
  "localllama",
] as const;

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9가-힣]+/g, " ").replace(/\s+/g, " ").trim();
}

function extractKeywords(repo: string, description: string): string[] {
  const text = normalizeText(`${repo} ${description}`);
  const detected = SIGNAL_KEYWORDS.filter((keyword) => text.includes(keyword));

  if (detected.length > 0) {
    return [...detected];
  }

  const tokens = text.split(" ").filter((token) => token.length >= 4);
  return [...new Set(tokens)].slice(0, 5);
}

function parseTrendingHtml(html: string): GitHubTrendingSignal[] {
  const articlePattern = /<article class="Box-row"[\s\S]*?<\/article>/g;
  const linkPattern = /href="\/(?<repo>[^"/]+\/[^"/]+)"/;
  const descriptionPattern = /<p class="col-9 color-fg-muted my-1 tmp-pr-4">(?<description>[\s\S]*?)<\/p>/;
  const languagePattern = /itemprop="programmingLanguage">(?<language>[^<]+)</;
  const starsTodayPattern = /(?<stars>[\d,]+)\s+stars today/;

  return [...html.matchAll(articlePattern)]
    .map((match) => match[0])
    .flatMap((articleHtml) => {
      const repo = articleHtml.match(linkPattern)?.groups?.repo?.trim();
      if (!repo) {
        return [];
      }

      const description = stripHtml(articleHtml.match(descriptionPattern)?.groups?.description ?? "");
      const language = articleHtml.match(languagePattern)?.groups?.language?.trim();
      const starsRaw = articleHtml.match(starsTodayPattern)?.groups?.stars?.replace(/,/g, "") ?? "0";
      const starsToday = Number.parseInt(starsRaw, 10);
      const keywords = extractKeywords(repo, description);

      if (keywords.length === 0) {
        return [];
      }

      return [{
        repo,
        description,
        language,
        starsToday: Number.isFinite(starsToday) ? starsToday : 0,
        keywords,
      }];
    });
}

export async function fetchGitHubTrendingSignals(logContext: LogContext = {}): Promise<GitHubTrendingSignal[]> {
  const scopedLogger = logger.child(logContext);
  scopedLogger.info("Fetching GitHub trending signals.", { url: GITHUB_TRENDING_URL });

  const response = await fetch(GITHUB_TRENDING_URL, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "Global-AI-Daily-Brief/1.0",
    },
  });

  if (!response.ok) {
    scopedLogger.warn("GitHub trending fetch failed; skipping signal enrichment.", {
      status: response.status,
    });
    return [];
  }

  const html = await response.text();
  const signals = parseTrendingHtml(html);
  scopedLogger.info("Resolved GitHub trending signals.", {
    signalCount: signals.length,
    topRepos: signals.slice(0, 5).map((signal) => signal.repo),
  });
  return signals;
}
