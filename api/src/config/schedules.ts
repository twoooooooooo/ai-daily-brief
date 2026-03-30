import { getDailyBriefingScheduleSettings } from "./runtimeConfig.js";

export interface DailyBriefingScheduleConfig {
  schedule: string;
  enabled: boolean;
}

export function getDailyBriefingScheduleConfig(): DailyBriefingScheduleConfig {
  const settings = getDailyBriefingScheduleSettings();
  return {
    schedule: settings.cron,
    enabled: settings.enabled,
  };
}
