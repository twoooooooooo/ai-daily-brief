import type { RssFeedConfig } from "../shared/rss.js";

export const rssFeeds: RssFeedConfig[] = [
  {
    id: "google-ai-blog",
    name: "Google AI Blog",
    source: "Google AI Blog",
    url: "https://blog.google/technology/ai/rss/",
    kind: "news",
    category: "Model",
    region: "US",
  },
  {
    id: "techcrunch-ai",
    name: "TechCrunch AI",
    source: "TechCrunch",
    url: "https://techcrunch.com/category/artificial-intelligence/feed/",
    kind: "news",
    category: "Product",
    region: "US",
  },
  {
    id: "openai-news",
    name: "OpenAI News",
    source: "OpenAI",
    url: "https://openai.com/news/rss.xml",
    kind: "news",
    category: "Model",
    region: "US",
  },
  {
    id: "arxiv-cs-ai",
    name: "arXiv cs.AI",
    source: "arXiv",
    url: "https://export.arxiv.org/rss/cs.AI",
    kind: "research",
    category: "Research",
    region: "Global",
  },
  {
    id: "arxiv-cs-lg",
    name: "arXiv cs.LG",
    source: "arXiv",
    url: "https://export.arxiv.org/rss/cs.LG",
    kind: "research",
    category: "Research",
    region: "Global",
  },
];
