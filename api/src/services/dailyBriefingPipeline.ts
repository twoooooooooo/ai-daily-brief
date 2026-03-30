import type { Briefing } from "../shared/contracts.js";
import { createCorrelationId, createLogger, type LogContext } from "../utils/logger.js";
import { saveBriefingWithOptions } from "./briefingRepository.js";
import { generateDailyBriefing } from "./briefingGenerationService.js";
import { ingestConfiguredRssFeeds } from "./rssIngestionService.js";

interface RunDailyBriefingPipelineInput {
  date?: string;
  overwrite?: boolean;
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
  const targetDate = input.date ?? new Date().toISOString().slice(0, 10);
  const correlationId = input.logContext?.correlationId ?? createCorrelationId("briefing");
  const scopedLogger = logger.child({
    component: "pipeline",
    operationName: "runDailyBriefingPipeline",
    ...input.logContext,
    correlationId,
  });

  scopedLogger.info("Starting daily briefing pipeline.", {
    date: targetDate,
    overwrite: input.overwrite === true,
  });

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

  let briefing: Briefing;
  try {
    briefing = await generateDailyBriefing({
      articles: ingestionResult.articles,
      date: input.date,
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
