import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getBriefingEmailScheduleConfigs, getDailyBriefingScheduleConfigs } from "../config/schedules.js";
import {
  recordDailyBriefingJobCompleted,
  recordDailyBriefingJobFailed,
  recordDailyBriefingJobStarted,
} from "../services/dailyBriefingJobService.js";
import { getLatestBriefingForEdition, getBriefingByDateAndEdition } from "../services/briefingRepository.js";
import {
  findRecentBriefingEmailJobForBriefing,
  recordBriefingEmailJobCompleted,
  recordBriefingEmailJobFailed,
  recordBriefingEmailJobProgress,
  recordBriefingEmailJobSkipped,
  recordBriefingEmailJobStarted,
} from "../services/briefingEmailJobService.js";
import { sendBriefingEmail } from "../services/briefingEmailService.js";
import { runDailyBriefingPipeline } from "../services/dailyBriefingPipeline.js";
import { createCorrelationId, createLogger } from "../utils/logger.js";
import { resolveBriefingDate } from "../utils/briefingEdition.js";

const logger = createLogger("scheduled-briefing");
const scheduleConfigs = getDailyBriefingScheduleConfigs();
const emailScheduleConfigs = getBriefingEmailScheduleConfigs();

export async function scheduledDailyBriefingHandler(
  timer: Timer,
  context: InvocationContext,
  edition: "Morning" | "Afternoon",
  schedule: string,
): Promise<void> {
  const correlationId = createCorrelationId(`scheduledDailyBriefing${edition}`);
  const jobId = createCorrelationId(`scheduledDailyBriefingJob${edition}`);
  const scopedLogger = logger.child({
    component: "timer",
    operationName: "scheduledDailyBriefing",
    correlationId,
    invocationId: context.invocationId,
  });

  scopedLogger.info("Scheduled daily briefing job started.", {
    isPastDue: timer.isPastDue,
    lastRun: timer.scheduleStatus?.last,
    nextRun: timer.scheduleStatus?.next,
    schedule,
    edition,
    invocationId: context.invocationId,
  });

  recordDailyBriefingJobStarted({
    id: jobId,
    edition,
    overwrite: false,
    trigger: "scheduled",
  });

  try {
    const briefing = await runDailyBriefingPipeline({
      edition,
      logContext: {
        correlationId,
        invocationId: context.invocationId,
        operationName: "scheduledDailyBriefing",
      },
    });

    scopedLogger.info("Scheduled daily briefing job completed.", {
      briefingId: briefing.id,
      date: briefing.date,
      edition: briefing.edition,
      articleCount: briefing.issues.length + briefing.researchHighlights.length,
      invocationId: context.invocationId,
    });
    recordDailyBriefingJobCompleted({
      id: jobId,
      date: briefing.date,
      edition: briefing.edition,
      overwrite: false,
      briefingId: briefing.id,
      trigger: "scheduled",
    });
  } catch (error) {
    recordDailyBriefingJobFailed({
      id: jobId,
      edition,
      overwrite: false,
      trigger: "scheduled",
      error: error instanceof Error ? error.message : "Unknown scheduled briefing failure.",
    });
    scopedLogger.exception("Scheduled daily briefing job failed.", error, {
      schedule,
      edition,
    });
    throw error;
  }
}

export async function scheduledBriefingEmailHandler(
  timer: Timer,
  context: InvocationContext,
  edition: "Morning" | "Afternoon",
  schedule: string,
): Promise<void> {
  const correlationId = createCorrelationId(`scheduledBriefingEmail${edition}`);
  const scopedLogger = logger.child({
    component: "timer",
    operationName: "scheduledBriefingEmail",
    correlationId,
    invocationId: context.invocationId,
  });

  scopedLogger.info("Scheduled briefing email job started.", {
    isPastDue: timer.isPastDue,
    lastRun: timer.scheduleStatus?.last,
    nextRun: timer.scheduleStatus?.next,
    schedule,
    edition,
    invocationId: context.invocationId,
  });

  const targetDate = resolveBriefingDate();
  const sameDayBriefing = await getBriefingByDateAndEdition(targetDate, edition);
  const briefing = sameDayBriefing ?? await getLatestBriefingForEdition(edition);
  const emailJobId = createCorrelationId(`briefing-email-${edition.toLowerCase()}`);

  if (!briefing) {
    recordBriefingEmailJobSkipped({
      id: emailJobId,
      date: targetDate,
      edition,
      reason: "no-persisted-briefing",
    });
    scopedLogger.warn("Scheduled briefing email job skipped because no persisted briefing was available.", {
      edition,
      date: targetDate,
    });
    return;
  }

  const existingJob = await findRecentBriefingEmailJobForBriefing(briefing.id);
  if (existingJob) {
    recordBriefingEmailJobSkipped({
      id: emailJobId,
      date: briefing.date,
      edition: briefing.edition,
      briefingId: briefing.id,
      totalRecipientCount: existingJob.totalRecipientCount,
      attemptedRecipientCount: existingJob.attemptedRecipientCount,
      recipientCount: existingJob.recipientCount,
      failedRecipientCount: existingJob.failedRecipientCount,
      reason: existingJob.status === "running" ? "duplicate-running-job" : "duplicate-completed-job",
    });
    scopedLogger.warn("Scheduled briefing email job skipped because a recent job already exists for the briefing.", {
      edition,
      briefingId: briefing.id,
      existingJobId: existingJob.id,
      existingJobStatus: existingJob.status,
    });
    return;
  }

  try {
    recordBriefingEmailJobStarted({
      id: emailJobId,
      date: briefing.date,
      edition: briefing.edition,
      briefingId: briefing.id,
    });

    const result = await sendBriefingEmail(briefing, {
      correlationId,
      invocationId: context.invocationId,
      operationName: "scheduledBriefingEmail",
      component: "briefing-email",
    }, {
      onProgress: (progress) => {
        recordBriefingEmailJobProgress({
          id: emailJobId,
          date: briefing.date,
          edition: briefing.edition,
          briefingId: briefing.id,
          totalRecipientCount: progress.totalRecipientCount,
          attemptedRecipientCount: progress.attemptedRecipientCount,
          recipientCount: progress.deliveredRecipientCount,
          failedRecipientCount: progress.failedRecipientCount,
        });
      },
    });

    if (result.skipped) {
      recordBriefingEmailJobSkipped({
        id: emailJobId,
        date: briefing.date,
        edition: briefing.edition,
        briefingId: briefing.id,
        reason: result.reason,
      });
    } else {
      recordBriefingEmailJobCompleted({
        id: emailJobId,
        date: briefing.date,
        edition: briefing.edition,
        briefingId: briefing.id,
        attemptedRecipientCount: (result.recipientCount ?? 0) + (result.failedRecipientCount ?? 0),
        recipientCount: result.recipientCount,
        failedRecipientCount: result.failedRecipientCount,
      });
    }

    scopedLogger.info("Scheduled briefing email job completed.", {
      briefingId: briefing.id,
      date: briefing.date,
      edition: briefing.edition,
      invocationId: context.invocationId,
    });
  } catch (error) {
    recordBriefingEmailJobFailed({
      id: emailJobId,
      date: briefing.date,
      edition: briefing.edition,
      briefingId: briefing.id,
      failedRecipientCount: undefined,
      error: error instanceof Error ? error.message : "Unknown scheduled email failure.",
    });
    scopedLogger.exception("Scheduled briefing email job failed.", error, {
      edition,
      schedule,
      briefingId: briefing.id,
    });
    throw error;
  }
}

for (const scheduleConfig of scheduleConfigs) {
  if (scheduleConfig.enabled) {
    app.timer(`scheduled${scheduleConfig.edition}Briefing`, {
      schedule: scheduleConfig.schedule,
      useMonitor: true,
      runOnStartup: false,
      retry: {
        strategy: "fixedDelay",
        maxRetryCount: 2,
        delayInterval: 60_000,
      },
      handler: (timer, context) => scheduledDailyBriefingHandler(
        timer,
        context,
        scheduleConfig.edition,
        scheduleConfig.schedule,
      ),
    });
  } else {
    logger.info("Scheduled daily briefing timer is disabled.", {
      edition: scheduleConfig.edition,
      schedule: scheduleConfig.schedule,
    });
  }
}

for (const scheduleConfig of emailScheduleConfigs) {
  if (scheduleConfig.enabled) {
    app.timer(`scheduled${scheduleConfig.edition}BriefingEmail`, {
      schedule: scheduleConfig.schedule,
      useMonitor: true,
      runOnStartup: false,
      retry: {
        strategy: "fixedDelay",
        maxRetryCount: 2,
        delayInterval: 60_000,
      },
      handler: (timer, context) => scheduledBriefingEmailHandler(
        timer,
        context,
        scheduleConfig.edition,
        scheduleConfig.schedule,
      ),
    });
  } else {
    logger.info("Scheduled briefing email timer is disabled.", {
      edition: scheduleConfig.edition,
      schedule: scheduleConfig.schedule,
    });
  }
}
