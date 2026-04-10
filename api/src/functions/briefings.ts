import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { getBriefingByDate, getBriefingById, getLatestPersistedBriefing, getTodayBriefing, listRecentBriefings, searchBriefings } from "../services/briefingRepository.js";
import { badRequestResponse, internalErrorResponse, jsonResponse, notFoundResponse } from "../http/responses.js";
import type { BriefingOperationalStatus, BriefingResponse } from "../shared/contracts.js";
import type { ArticleType, BriefingEdition, Category, Importance, Region } from "../shared/contracts.js";
import { getBriefingStoreStatus } from "../repositories/briefingStoreProvider.js";
import { getSubscriberStats } from "../repositories/subscriberStore.js";
import { getBriefingEmailSettings, getDailyBriefingScheduleSettings } from "../config/runtimeConfig.js";
import { getLatestDailyBriefingJob } from "../services/dailyBriefingJobService.js";
import { getLatestBriefingEmailJob } from "../services/briefingEmailJobService.js";
import type { Briefing, Issue } from "../shared/contracts.js";

async function handleRequest(
  context: InvocationContext,
  operation: () => Promise<HttpResponseInit>,
): Promise<HttpResponseInit> {
  try {
    return await operation();
  } catch (error) {
    context.error("Briefing API request failed", error);
    return internalErrorResponse("Failed to load briefing data.");
  }
}

function getRouteParam(request: HttpRequest, name: string): string {
  const paramValue = request.params[name];
  if (paramValue) {
    return decodeURIComponent(paramValue).trim().replace(/^\/+|\/+$/g, "");
  }

  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  const fallbackValue = pathname.split("/").pop() ?? "";
  return decodeURIComponent(fallbackValue).trim();
}

function getEnumQueryValue<T extends string>(request: HttpRequest, name: string, allowedValues: T[]): T | undefined {
  const value = request.query.get(name)?.trim();
  if (!value) {
    return undefined;
  }

  return allowedValues.includes(value as T) ? value as T : undefined;
}

function createEmptyBriefingResponse(): BriefingResponse {
  return {
    articles: [],
    summary: {
      trend: "No persisted briefing is available yet.",
      trendEn: "No persisted briefing is available yet.",
      topKeywords: [],
      topKeywordsEn: [],
      totalArticles: 0,
      topCategory: "Model",
      topMention: "-",
    },
    trendingTopics: [],
    trendingTopicsEn: [],
  };
}

function summarizeCounts<T extends string>(values: T[]): Array<{ key: T; count: number }> {
  const counts = new Map<T, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([key, count]) => ({ key, count }));
}

function buildLatestBriefingTelemetry(briefing: Briefing) {
  const articles: Issue[] = [...briefing.issues, ...briefing.researchHighlights];
  const publishedDates = articles
    .map((article) => new Date(`${article.date}T00:00:00.000Z`))
    .filter((value) => !Number.isNaN(value.getTime()));
  const articleAges = publishedDates.map((value) => Math.max(0, (Date.now() - value.getTime()) / 36e5));
  const averageAgeHours = articleAges.length > 0
    ? Math.round((articleAges.reduce((sum, value) => sum + value, 0) / articleAges.length) * 10) / 10
    : undefined;
  const newest = publishedDates.length > 0
    ? new Date(Math.max(...publishedDates.map((value) => value.getTime()))).toISOString()
    : undefined;
  const oldest = publishedDates.length > 0
    ? new Date(Math.min(...publishedDates.map((value) => value.getTime()))).toISOString()
    : undefined;

  return {
    freshness: {
      newestArticlePublishedAt: newest,
      oldestArticlePublishedAt: oldest,
      averageAgeHours,
      staleArticleCount: articleAges.filter((age) => age > 48).length,
      articlesWithin24Hours: articleAges.filter((age) => age <= 24).length,
    },
    coverage: {
      sourceCounts: summarizeCounts(articles.map((article) => article.source))
        .slice(0, 8)
        .map((entry) => ({ source: entry.key, count: entry.count })),
      categoryCounts: summarizeCounts(articles.map((article) => article.category))
        .map((entry) => ({ category: entry.key, count: entry.count })),
      typeCounts: summarizeCounts(articles.map((article) => article.type))
        .map((entry) => ({ type: entry.key, count: entry.count })),
    },
  };
}

export async function getTodayBriefingHandler(
  _request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  return handleRequest(context, async () => {
    const briefing = await getTodayBriefing();
    return jsonResponse(briefing ?? createEmptyBriefingResponse());
  });
}

export async function listBriefingsHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  return handleRequest(context, async () => {
    const limitValue = request.query.get("limit");
    const parsedLimit = limitValue ? Number.parseInt(limitValue, 10) : 30;
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 30;
    return jsonResponse(await listRecentBriefings(limit));
  });
}

export async function getBriefingByIdHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  return handleRequest(context, async () => {
    const id = getRouteParam(request, "id");
    const briefing = await getBriefingById(id);
    return briefing
      ? jsonResponse(briefing)
      : notFoundResponse(`Briefing not found: ${id}`);
  });
}

export async function getBriefingByDateHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  return handleRequest(context, async () => {
    const date = getRouteParam(request, "date");
    if (!date) {
      return badRequestResponse("A briefing date is required.");
    }

    const briefing = await getBriefingByDate(date);
    return briefing
      ? jsonResponse(briefing)
      : notFoundResponse(`Briefing not found for date: ${date}`);
  });
}

export async function searchBriefingsHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  return handleRequest(context, async () => {
    const limitValue = request.query.get("limit");
    const parsedLimit = limitValue ? Number.parseInt(limitValue, 10) : 50;
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50;

    const results = await searchBriefings({
      query: request.query.get("q")?.trim() ?? "",
      edition: getEnumQueryValue<BriefingEdition>(request, "edition", ["Morning", "Afternoon"]),
      category: getEnumQueryValue<Category>(request, "category", ["Model", "Research", "Policy", "Product", "Investment", "Infrastructure"]),
      importance: getEnumQueryValue<Importance>(request, "importance", ["High", "Medium", "Low"]),
      region: getEnumQueryValue<Region>(request, "region", ["Global", "US", "Europe", "Asia"]),
      type: getEnumQueryValue<ArticleType>(request, "type", ["news", "research"]),
      dateFrom: request.query.get("dateFrom")?.trim() ?? undefined,
      dateTo: request.query.get("dateTo")?.trim() ?? undefined,
      limit,
    });

    return jsonResponse(results);
  });
}

export async function getOperationalStatusHandler(
  _request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  return handleRequest(context, async () => {
    const latestBriefing = await getLatestPersistedBriefing();
    const latestJob = getLatestDailyBriefingJob();
    const latestEmailJob = getLatestBriefingEmailJob();
    const emailSettings = getBriefingEmailSettings();
    const subscriberStats = await getSubscriberStats();
    const status: BriefingOperationalStatus = {
      storage: getBriefingStoreStatus(),
      email: {
        enabled: emailSettings.enabled,
        recipientCount: emailSettings.recipients.length,
        senderConfigured: Boolean(emailSettings.senderAddress),
        senderNameConfigured: Boolean(emailSettings.senderName),
        runs: emailSettings.runs,
      },
      subscribers: subscriberStats,
      schedule: getDailyBriefingScheduleSettings(),
      latestBriefing: latestBriefing ? {
        id: latestBriefing.id,
        date: latestBriefing.date,
        edition: latestBriefing.edition,
        updatedAt: latestBriefing.lastUpdatedAt,
        issueCount: latestBriefing.issues.length,
        researchHighlightCount: latestBriefing.researchHighlights.length,
        ...buildLatestBriefingTelemetry(latestBriefing),
      } : undefined,
      latestJob: latestJob ? {
        id: latestJob.id,
        status: latestJob.status,
        updatedAt: latestJob.updatedAt,
        date: latestJob.date,
        edition: latestJob.edition,
        error: latestJob.error,
      } : undefined,
      latestEmailJob: latestEmailJob ? {
        id: latestEmailJob.id,
        status: latestEmailJob.status,
        updatedAt: latestEmailJob.updatedAt,
        date: latestEmailJob.date,
        edition: latestEmailJob.edition,
        briefingId: latestEmailJob.briefingId,
        recipientCount: latestEmailJob.recipientCount,
        reason: latestEmailJob.reason,
        error: latestEmailJob.error,
      } : undefined,
    };

    return jsonResponse(status);
  });
}

app.http("getTodayBriefing", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "briefings/today",
  handler: getTodayBriefingHandler,
});

app.http("listBriefings", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "briefings",
  handler: listBriefingsHandler,
});

app.http("getBriefingById", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "briefings/{id:regex(^(?!today$).+)}",
  handler: getBriefingByIdHandler,
});

app.http("getBriefingByDate", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "briefings/date/{date}",
  handler: getBriefingByDateHandler,
});

app.http("searchBriefings", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "search",
  handler: searchBriefingsHandler,
});

app.http("getOperationalStatus", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "status",
  handler: getOperationalStatusHandler,
});
