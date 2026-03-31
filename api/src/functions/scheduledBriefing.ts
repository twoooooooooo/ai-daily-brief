import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getDailyBriefingScheduleConfigs } from "../config/schedules.js";
import { runDailyBriefingPipeline } from "../services/dailyBriefingPipeline.js";
import { createCorrelationId, createLogger } from "../utils/logger.js";

const logger = createLogger("scheduled-briefing");
const scheduleConfigs = getDailyBriefingScheduleConfigs();

export async function scheduledDailyBriefingHandler(
  timer: Timer,
  context: InvocationContext,
  edition: "Morning" | "Afternoon",
  schedule: string,
): Promise<void> {
  const correlationId = createCorrelationId(`scheduledDailyBriefing${edition}`);
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
  } catch (error) {
    scopedLogger.exception("Scheduled daily briefing job failed.", error, {
      schedule,
      edition,
    });
    throw error;
  }
}

for (const scheduleConfig of scheduleConfigs) {
  if (scheduleConfig.enabled) {
    app.timer(`scheduled${scheduleConfig.edition}Briefing`, {
      schedule: scheduleConfig.schedule,
      useMonitor: false,
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
