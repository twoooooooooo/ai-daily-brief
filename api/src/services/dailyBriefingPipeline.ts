import type { Briefing, BriefingEdition } from "../shared/contracts.js";
import { createCorrelationId, createLogger, type LogContext } from "../utils/logger.js";
import { resolveBriefingDate, resolveBriefingEdition } from "../utils/briefingEdition.js";
import { listRecentBriefings, saveBriefingWithOptions } from "./briefingRepository.js";
import { generateDailyBriefing } from "./briefingGenerationService.js";
import { listStoredRssArticles } from "./rssArticleStore.js";
import { ingestConfiguredRssFeeds } from "./rssIngestionService.js";

interface RunDailyBriefingPipelineInput {
  date?: string;
  edition?: BriefingEdition;
  overwrite?: boolean;
  skipIngestion?: boolean;
  logContext?: LogContext;
}

export class DailyBriefingPipelineError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "DailyBriefingPipelineError";
  }
}

const logger = createLogger("daily-briefing-pipeline");

export async function runDailyBriefingPipeline(
  input: RunDailyBriefingPipelineInput = {},
): Promise<Briefing> {
  const targetDate = input.date ?? resolveBriefingDate();
  const targetEdition = input.edition ?? resolveBriefingEdition();
  const correlationId = input.logContext?.correlationId ?? createCorrelationId("briefing");
  const scopedLogger = logger.child({
    component: "pipeline",
    operationName: "runDailyBriefingPipeline",
    ...input.logContext,
    correlationId,
  });

  scopedLogger.info("Starting daily briefing pipeline.", {
    date: targetDate,
    edition: targetEdition,
    overwrite: input.overwrite === true,
    skipIngestion: input.skipIngestion === true,
  });

  const cachedArticles = listStoredRssArticles();
  let articles = cachedArticles;

  if (input.skipIngestion) {
    if (cachedArticles.length === 0) {
      scopedLogger.error("Daily briefing pipeline was asked to skip ingestion, but no cached RSS articles were available.", {
        date: targetDate,
      });
      throw new DailyBriefingPipelineError("No cached RSS articles are available for generation.");
    }

    scopedLogger.info("Skipping RSS ingestion and using cached RSS articles for daily briefing pipeline.", {
      date: targetDate,
      cachedArticleCount: cachedArticles.length,
    });
  } else if (cachedArticles.length > 0) {
    scopedLogger.info("Using cached RSS articles for daily briefing pipeline.", {
      date: targetDate,
      cachedArticleCount: cachedArticles.length,
    });
  } else {
    let ingestionResult;
    try {
      ingestionResult = await ingestConfiguredRssFeeds({
        ...input.logContext,
        component: "rss-ingestion",
        operationName: "ingestConfiguredRssFeeds",
        correlationId,
      });
    } catch (error) {
      scopedLogger.exception("Daily briefing pipeline failed during RSS ingestion.", error, {
        stage: "rss-ingestion",
        date: targetDate,
      });
      throw new DailyBriefingPipelineError("Daily briefing pipeline failed during RSS ingestion.", error);
    }

    articles = ingestionResult.articles;
  }

  let briefing: Briefing;
  try {
    const recentBriefings = await listRecentBriefings(6);
    const priorBriefings = recentBriefings.filter((item) =>
      item.date < targetDate || (item.date === targetDate && item.edition !== targetEdition));

    briefing = await generateDailyBriefing({
      articles,
      date: input.date,
      edition: targetEdition,
      priorBriefings,
      logContext: {
        ...input.logContext,
        component: "briefing-generation",
        operationName: "generateDailyBriefing",
        correlationId,
      },
    });
  } catch (error) {
    scopedLogger.exception("Daily briefing pipeline failed during AI generation.", error, {
      stage: "ai-generation",
      date: targetDate,
    });
    throw new DailyBriefingPipelineError("Daily briefing pipeline failed during AI generation.", error);
  }

  try {
    const savedBriefing = await saveBriefingWithOptions(briefing, {
      overwrite: input.overwrite,
      logContext: {
        ...input.logContext,
        component: "briefing-persistence",
        operationName: "saveBriefingWithOptions",
        correlationId,
      },
    });
    scopedLogger.info("Completed daily briefing pipeline.", {
      date: savedBriefing.date,
      edition: savedBriefing.edition,
      briefingId: savedBriefing.id,
      articleCount: savedBriefing.issues.length + savedBriefing.researchHighlights.length,
    });
    return savedBriefing;
  } catch (error) {
    scopedLogger.exception("Daily briefing pipeline failed during persistence.", error, {
      stage: "persistence",
      date: targetDate,
    });
    throw new DailyBriefingPipelineError("Daily briefing pipeline failed during persistence.", error);
  }
}
