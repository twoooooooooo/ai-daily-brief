import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { badRequestResponse, internalErrorResponse, jsonResponse, unauthorizedResponse } from "../http/responses.js";
import { getAdminApiSettings } from "../config/runtimeConfig.js";
import { BriefingGenerationError, generateDailyBriefing, probeOpenAIConnection } from "../services/briefingGenerationService.js";
import { DailyBriefingPipelineError, runDailyBriefingPipeline } from "../services/dailyBriefingPipeline.js";
import { saveBriefingWithOptions } from "../services/briefingRepository.js";
import { ingestConfiguredRssFeeds } from "../services/rssIngestionService.js";
import type { NormalizedArticle } from "../shared/rss.js";
import { createCorrelationId, createLogger } from "../utils/logger.js";

const logger = createLogger("admin-api");

function extractErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const cause = "cause" in error ? (error as Error & { cause?: unknown }).cause : undefined;
  const causeMessage = extractErrorMessage(cause);
  if (causeMessage && causeMessage !== error.message) {
    return `${error.message}: ${causeMessage}`;
  }

  return error.message;
}

function getProvidedAdminApiKey(request: HttpRequest, payload?: unknown): string | undefined {
  const headerApiKey = request.headers.get("x-admin-key")?.trim();
  if (headerApiKey) {
    return headerApiKey;
  }

  const queryApiKey = request.query.get("adminKey")?.trim();
  if (queryApiKey) {
    return queryApiKey;
  }

  if (isRecord(payload)) {
    const bodyApiKey = typeof payload.adminApiKey === "string" ? payload.adminApiKey.trim() : undefined;
    if (bodyApiKey) {
      return bodyApiKey;
    }
  }

  return undefined;
}

function isAuthorizedAdminRequest(request: HttpRequest, payload?: unknown): boolean {
  const adminApiSettings = getAdminApiSettings();
  const configuredApiKey = adminApiSettings.apiKey;
  if (!configuredApiKey) {
    return !adminApiSettings.requireAuth;
  }

  const providedApiKey = getProvidedAdminApiKey(request, payload);
  return providedApiKey === configuredApiKey;
}

async function handleAdminRequest(
  context: InvocationContext,
  operationName: string,
  operation: (logContext: { correlationId: string; invocationId: string; operationName: string }) => Promise<HttpResponseInit>,
): Promise<HttpResponseInit> {
  const correlationId = createCorrelationId(operationName);
  const logContext = {
    correlationId,
    invocationId: context.invocationId,
    operationName,
  };
  const scopedLogger = logger.child({
    component: "http",
    ...logContext,
  });

  scopedLogger.info("Admin API request started.");
  try {
    const response = await operation(logContext);
    scopedLogger.info("Admin API request completed.");
    return response;
  } catch (error) {
    scopedLogger.exception("Admin API request failed.", error);
    context.error("Admin API request failed", error);

    if (error instanceof BriefingGenerationError) {
      return internalErrorResponse(extractErrorMessage(error) ?? error.message);
    }

    if (error instanceof DailyBriefingPipelineError) {
      return internalErrorResponse(extractErrorMessage(error) ?? error.message);
    }

    return internalErrorResponse("Failed to execute admin operation.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseNormalizedArticles(value: unknown): NormalizedArticle[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  return value as NormalizedArticle[];
}

function parseOptionalBoolean(value: unknown): boolean {
  return value === true;
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return value;
}

export async function ingestRssHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  return handleAdminRequest(context, "ingestRss", async (logContext) => {
    if (!isAuthorizedAdminRequest(request)) {
      logger.child(logContext).warn("Rejected unauthorized admin request.");
      return unauthorizedResponse("Unauthorized admin operation.");
    }

    const result = await ingestConfiguredRssFeeds({
      ...logContext,
    });
    return jsonResponse(result);
  });
}

export async function generateBriefingHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  return handleAdminRequest(context, "generateBriefing", async (logContext) => {
    let payload: unknown;

    try {
      payload = await request.json();
    } catch {
      return badRequestResponse("Request body must be valid JSON.");
    }

    if (!isRecord(payload)) {
      return badRequestResponse("Request body must be a JSON object.");
    }

    if (!isAuthorizedAdminRequest(request, payload)) {
      logger.child(logContext).warn("Rejected unauthorized admin request.");
      return unauthorizedResponse("Unauthorized admin operation.");
    }

    const articles = parseNormalizedArticles(payload.articles);
    if (!articles || articles.length === 0) {
      return badRequestResponse("Request body must include a non-empty articles array.");
    }

    const date = typeof payload.date === "string" ? payload.date : undefined;
    const shouldSave = parseOptionalBoolean(payload.save);
    const overwrite = parseOptionalBoolean(payload.overwrite);
    const generatedBriefing = await generateDailyBriefing({
      articles,
      date,
      logContext,
    });
    const briefing = shouldSave
      ? await saveBriefingWithOptions(generatedBriefing, {
        overwrite,
        logContext,
      })
      : generatedBriefing;
    return jsonResponse(briefing);
  });
}

export async function runDailyBriefingHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  return handleAdminRequest(context, "runDailyBriefing", async (logContext) => {
    let payload: unknown = {};

    try {
      const rawBody = await request.text();
      payload = rawBody.trim() ? JSON.parse(rawBody) : {};
    } catch {
      return badRequestResponse("Request body must be valid JSON.");
    }

    if (!isRecord(payload)) {
      return badRequestResponse("Request body must be a JSON object.");
    }

    if (!isAuthorizedAdminRequest(request, payload)) {
      logger.child(logContext).warn("Rejected unauthorized admin request.");
      return unauthorizedResponse("Unauthorized admin operation.");
    }

    const date = typeof payload.date === "string" ? payload.date : undefined;
    const overwrite = parseOptionalBoolean(payload.overwrite);
    const compact = parseOptionalBoolean(payload.compact);
    const briefing = await runDailyBriefingPipeline({
      date,
      overwrite,
      logContext,
    });
    if (compact) {
      return jsonResponse({
        briefingId: briefing.id,
        date: briefing.date,
        lastUpdatedAt: briefing.lastUpdatedAt,
        issueCount: briefing.issues.length,
        researchHighlightCount: briefing.researchHighlights.length,
        trendingTopicCount: briefing.trendingTopics.length,
      });
    }

    return jsonResponse(briefing);
  });
}

export async function probeOpenAIHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  return handleAdminRequest(context, "probeOpenAI", async (logContext) => {
    let payload: unknown = {};

    try {
      const rawBody = await request.text();
      payload = rawBody.trim() ? JSON.parse(rawBody) : {};
    } catch {
      return badRequestResponse("Request body must be valid JSON.");
    }

    if (!isRecord(payload)) {
      return badRequestResponse("Request body must be a JSON object.");
    }

    if (!isAuthorizedAdminRequest(request, payload)) {
      logger.child(logContext).warn("Rejected unauthorized admin request.");
      return unauthorizedResponse("Unauthorized admin operation.");
    }

    const result = await probeOpenAIConnection(logContext);
    return jsonResponse(result);
  });
}

export async function diagnosePipelineHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  return handleAdminRequest(context, "diagnosePipeline", async (logContext) => {
    let payload: unknown = {};

    try {
      const rawBody = await request.text();
      payload = rawBody.trim() ? JSON.parse(rawBody) : {};
    } catch {
      return badRequestResponse("Request body must be valid JSON.");
    }

    if (!isRecord(payload)) {
      return badRequestResponse("Request body must be a JSON object.");
    }

    if (!isAuthorizedAdminRequest(request, payload)) {
      logger.child(logContext).warn("Rejected unauthorized admin request.");
      return unauthorizedResponse("Unauthorized admin operation.");
    }

    const maxArticles = parseOptionalNumber(payload.maxArticles) ?? 5;
    const rssResult = await ingestConfiguredRssFeeds(logContext);
    const sampleArticles = rssResult.articles.slice(0, Math.max(1, Math.min(maxArticles, rssResult.articles.length)));
    const generatedBriefing = await generateDailyBriefing({
      articles: sampleArticles,
      date: typeof payload.date === "string" ? payload.date : undefined,
      logContext,
    });

    return jsonResponse({
      rss: {
        articleCount: rssResult.articles.length,
        feedCount: rssResult.feedsProcessed,
      },
      generation: {
        sampleArticleCount: sampleArticles.length,
        issueCount: generatedBriefing.issues.length,
        researchHighlightCount: generatedBriefing.researchHighlights.length,
        trendingTopicCount: generatedBriefing.trendingTopics.length,
      },
    });
  });
}

export async function probeRssHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  return handleAdminRequest(context, "probeRss", async (logContext) => {
    const adminKey = request.query.get("adminKey");
    const payload = adminKey ? { adminApiKey: adminKey } : {};

    if (!isAuthorizedAdminRequest(request, payload)) {
      logger.child(logContext).warn("Rejected unauthorized admin request.");
      return unauthorizedResponse("Unauthorized admin operation.");
    }

    const rssResult = await ingestConfiguredRssFeeds(logContext);
    return jsonResponse({
      ok: true,
      feedsProcessed: rssResult.feedsProcessed,
      articlesDiscovered: rssResult.articlesDiscovered,
      uniqueArticles: rssResult.uniqueArticles,
      sampleArticles: rssResult.articles.slice(0, 3).map((article) => ({
        id: article.id,
        title: article.title,
        source: article.source,
        publishedAt: article.publishedAt,
      })),
    });
  });
}

export async function probeGenerationHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  return handleAdminRequest(context, "probeGeneration", async (logContext) => {
    const adminKey = request.query.get("adminKey");
    const payload = adminKey ? { adminApiKey: adminKey } : {};

    if (!isAuthorizedAdminRequest(request, payload)) {
      logger.child(logContext).warn("Rejected unauthorized admin request.");
      return unauthorizedResponse("Unauthorized admin operation.");
    }

    const generatedBriefing = await generateDailyBriefing({
      articles: [{
        id: "probe-article-1",
        title: "OpenAI probe article for deployment diagnostics",
        source: "System Probe",
        sourceUrl: "https://example.com/probe-article",
        publishedAt: new Date().toISOString(),
        summary: "This is a synthetic article used only to verify production briefing generation.",
        content: "A synthetic article used to verify that the deployed environment can complete the structured briefing generation path.",
        type: "news",
        category: "Model",
        region: "Global",
        normalizedTitle: "openai probe article for deployment diagnostics",
        feedId: "system-probe",
        ingestedAt: new Date().toISOString(),
      }],
      logContext,
    });

    return jsonResponse({
      ok: true,
      briefingId: generatedBriefing.id,
      issueCount: generatedBriefing.issues.length,
      researchHighlightCount: generatedBriefing.researchHighlights.length,
      trendingTopicCount: generatedBriefing.trendingTopics.length,
    });
  });
}

export async function probePersistenceHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  return handleAdminRequest(context, "probePersistence", async (logContext) => {
    const adminKey = request.query.get("adminKey");
    const payload = adminKey ? { adminApiKey: adminKey } : {};

    if (!isAuthorizedAdminRequest(request, payload)) {
      logger.child(logContext).warn("Rejected unauthorized admin request.");
      return unauthorizedResponse("Unauthorized admin operation.");
    }

    const timestamp = new Date().toISOString();
    const date = timestamp.slice(0, 10);
    const briefing = await saveBriefingWithOptions({
      id: `probe-briefing-${Date.now()}`,
      date,
      dailySummary: {
        trend: "Probe persistence trend",
        trendEn: "Probe persistence trend",
        topKeywords: ["probe"],
        topKeywordsEn: ["probe"],
        totalArticles: 1,
        topCategory: "Model",
        topMention: "probe",
      },
      issues: [{
        id: `probe-issue-${Date.now()}`,
        title: "Probe persistence title",
        titleEn: "Probe persistence title",
        category: "Model",
        importance: "Low",
        summary: "Probe persistence summary",
        summaryEn: "Probe persistence summary",
        whyItMatters: "Probe persistence why",
        whyItMattersEn: "Probe persistence why",
        practicalImpact: "Probe persistence impact",
        practicalImpactEn: "Probe persistence impact",
        keywords: ["probe"],
        source: "System Probe",
        sourceUrl: "https://example.com/probe",
        region: "Global",
        date,
        type: "news",
      }],
      researchHighlights: [],
      trendingTopics: ["probe"],
      trendingTopicsEn: ["probe"],
    }, {
      overwrite: true,
      logContext,
    });

    return jsonResponse({
      ok: true,
      briefingId: briefing.id,
      date: briefing.date,
      issueCount: briefing.issues.length,
    });
  });
}

app.http("ingestRss", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "ops/ingest-rss",
  handler: ingestRssHandler,
});

app.http("generateBriefing", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "ops/generate-briefing",
  handler: generateBriefingHandler,
});

app.http("runDailyBriefing", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "ops/run-daily-briefing",
  handler: runDailyBriefingHandler,
});

app.http("probeOpenAI", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "ops/probe-openai",
  handler: probeOpenAIHandler,
});

app.http("diagnosePipeline", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "ops/diagnose-pipeline",
  handler: diagnosePipelineHandler,
});

app.http("probeRss", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "ops/probe-rss",
  handler: probeRssHandler,
});

app.http("probeGeneration", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "ops/probe-generation",
  handler: probeGenerationHandler,
});

app.http("probePersistence", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "ops/probe-persistence",
  handler: probePersistenceHandler,
});
