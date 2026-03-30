export interface OpenAISettings {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface BriefingStorageSettings {
  filePath?: string;
}

export interface ScheduleSettings {
  cron: string;
  enabled: boolean;
}

export interface AdminApiSettings {
  apiKey?: string;
  requireAuth: boolean;
}

export interface EnvironmentSettings {
  isProduction: boolean;
}

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
const DEFAULT_DAILY_BRIEFING_SCHEDULE = "0 0 6 * * *";

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function getRequiredSecret(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getOpenAISettings(): OpenAISettings {
  return {
    apiKey: getRequiredSecret("OPENAI_API_KEY"),
    baseUrl: readEnv("OPENAI_BASE_URL") ?? DEFAULT_OPENAI_BASE_URL,
    model: readEnv("OPENAI_MODEL") ?? DEFAULT_OPENAI_MODEL,
  };
}

export function getBriefingStorageSettings(): BriefingStorageSettings {
  return {
    filePath: readEnv("BRIEFING_STORAGE_FILE"),
  };
}

export function getDailyBriefingScheduleSettings(): ScheduleSettings {
  return {
    cron: readEnv("DAILY_BRIEFING_SCHEDULE") ?? DEFAULT_DAILY_BRIEFING_SCHEDULE,
    enabled: readEnv("ENABLE_SCHEDULED_BRIEFING") === "true",
  };
}

export function getAdminApiSettings(): AdminApiSettings {
  const environment = getEnvironmentSettings();
  return {
    apiKey: readEnv("ADMIN_API_KEY"),
    requireAuth: environment.isProduction || readEnv("REQUIRE_ADMIN_API_AUTH") === "true",
  };
}

export function getEnvironmentSettings(): EnvironmentSettings {
  const nodeEnv = readEnv("NODE_ENV");
  const azureFunctionsEnvironment = readEnv("AZURE_FUNCTIONS_ENVIRONMENT");
  const websiteSiteName = readEnv("WEBSITE_SITE_NAME");

  return {
    isProduction: nodeEnv === "production"
      || azureFunctionsEnvironment === "Production"
      || typeof websiteSiteName === "string",
  };
}
