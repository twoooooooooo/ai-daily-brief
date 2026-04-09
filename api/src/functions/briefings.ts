import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { getBriefingByDate, getBriefingById, getLatestPersistedBriefing, getTodayBriefing, listRecentBriefings, searchBriefings } from "../services/briefingRepository.js";
import { badRequestResponse, internalErrorResponse, jsonResponse, notFoundResponse } from "../http/responses.js";
import type { BriefingOperationalStatus, BriefingResponse } from "../shared/contracts.js";
import type { ArticleType, BriefingEdition, Category, Importance, Region } from "../shared/contracts.js";
import { getBriefingStoreStatus } from "../repositories/briefingStoreProvider.js";
import { getBriefingEmailSettings, getDailyBriefingScheduleSettings } from "../config/runtimeConfig.js";
import { getLatestDailyBriefingJob } from "../services/dailyBriefingJobService.js";

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
    const emailSettings = getBriefingEmailSettings();
    const status: BriefingOperationalStatus = {
      storage: getBriefingStoreStatus(),
      email: {
        enabled: emailSettings.enabled,
        recipientCount: emailSettings.recipients.length,
        senderConfigured: Boolean(emailSettings.senderAddress),
        runs: emailSettings.runs,
      },
      schedule: getDailyBriefingScheduleSettings(),
      latestBriefing: latestBriefing ? {
        id: latestBriefing.id,
        date: latestBriefing.date,
        edition: latestBriefing.edition,
        updatedAt: latestBriefing.lastUpdatedAt,
        issueCount: latestBriefing.issues.length,
        researchHighlightCount: latestBriefing.researchHighlights.length,
      } : undefined,
      latestJob: latestJob ? {
        id: latestJob.id,
        status: latestJob.status,
        updatedAt: latestJob.updatedAt,
        date: latestJob.date,
        edition: latestJob.edition,
        error: latestJob.error,
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
