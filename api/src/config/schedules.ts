import { getDailyBriefingScheduleSettings } from "./runtimeConfig.js";
import type { BriefingEdition } from "../shared/contracts.js";

export interface DailyBriefingScheduleConfig {
  edition: BriefingEdition;
  schedule: string;
  enabled: boolean;
  timezone: string;
}

export function getDailyBriefingScheduleConfigs(): DailyBriefingScheduleConfig[] {
  const settings = getDailyBriefingScheduleSettings();
  return settings.runs.map((run) => ({
    edition: run.edition,
    schedule: run.cron,
    enabled: settings.enabled,
    timezone: settings.timezone,
  }));
}
