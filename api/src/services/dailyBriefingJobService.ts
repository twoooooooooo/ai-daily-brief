import type { Briefing, BriefingEdition } from "../shared/contracts.js";
import { createCorrelationId, createLogger, type LogContext } from "../utils/logger.js";
import { runDailyBriefingPipeline } from "./dailyBriefingPipeline.js";

export type DailyBriefingJobStatus = "queued" | "running" | "completed" | "failed";

export interface DailyBriefingJobRecord {
  id: string;
  status: DailyBriefingJobStatus;
  createdAt: string;
  updatedAt: string;
  date?: string;
  edition?: BriefingEdition;
  overwrite: boolean;
  briefingId?: string;
  error?: string;
}

interface StartDailyBriefingJobInput {
  date?: string;
  edition?: BriefingEdition;
  overwrite?: boolean;
  logContext?: LogContext;
}

const logger = createLogger("daily-briefing-job");
const jobs = new Map<string, DailyBriefingJobRecord>();

function updateJob(jobId: string, patch: Partial<DailyBriefingJobRecord>): DailyBriefingJobRecord | null {
  const existing = jobs.get(jobId);
  if (!existing) {
    return null;
  }

  const next: DailyBriefingJobRecord = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  jobs.set(jobId, next);
  return next;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = "cause" in error ? (error as Error & { cause?: unknown }).cause : undefined;
    const causeMessage = cause instanceof Error ? cause.message : undefined;
    return causeMessage && causeMessage !== error.message
      ? `${error.message}: ${causeMessage}`
      : error.message;
  }

  return "Unknown job failure.";
}

export function startDailyBriefingJob(input: StartDailyBriefingJobInput = {}): DailyBriefingJobRecord {
  const createdAt = new Date().toISOString();
  const jobId = createCorrelationId("briefing-job");
  const jobRecord: DailyBriefingJobRecord = {
    id: jobId,
    status: "queued",
    createdAt,
    updatedAt: createdAt,
    date: input.date,
    edition: input.edition,
    overwrite: input.overwrite === true,
  };

  jobs.set(jobId, jobRecord);

  void (async () => {
    const jobLogContext: LogContext = {
      ...input.logContext,
      correlationId: jobId,
      operationName: "runDailyBriefingJob",
      component: "job",
    };

    updateJob(jobId, { status: "running" });
    logger.child(jobLogContext).info("Started background daily briefing job.", {
      date: input.date,
      edition: input.edition,
      overwrite: input.overwrite === true,
    });

    try {
      const briefing: Briefing = await runDailyBriefingPipeline({
        date: input.date,
        edition: input.edition,
        overwrite: input.overwrite,
        logContext: jobLogContext,
      });

      updateJob(jobId, {
        status: "completed",
        briefingId: briefing.id,
      });

      logger.child(jobLogContext).info("Completed background daily briefing job.", {
        briefingId: briefing.id,
        date: briefing.date,
        edition: briefing.edition,
      });
    } catch (error) {
      const message = toErrorMessage(error);
      updateJob(jobId, {
        status: "failed",
        error: message,
      });

      logger.child(jobLogContext).exception("Background daily briefing job failed.", error, {
        date: input.date,
      });
    }
  })();

  return jobRecord;
}

export function getDailyBriefingJob(jobId: string): DailyBriefingJobRecord | null {
  return jobs.get(jobId) ?? null;
}

export function getLatestDailyBriefingJob(): DailyBriefingJobRecord | null {
  const sorted = [...jobs.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return sorted[0] ?? null;
}
