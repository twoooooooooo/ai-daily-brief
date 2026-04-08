export interface OpenAISettings {
  apiKey: string;
  baseUrl: string;
  model: string;
  apiVersion?: string;
  useAzureApiKeyAuth: boolean;
}

export interface BriefingStorageSettings {
  provider: "auto" | "file" | "blob";
  filePath?: string;
  blobContainerName: string;
  blobName: string;
  connectionString?: string;
  fallbackToMemory: boolean;
}

export interface ScheduledBriefingRunSettings {
  edition: "Morning" | "Afternoon";
  cron: string;
}

export interface ScheduleSettings {
  enabled: boolean;
  timezone: string;
  runs: ScheduledBriefingRunSettings[];
}

export interface AdminApiSettings {
  apiKey?: string;
  requireAuth: boolean;
}

export interface AdminProbeSettings {
  enabled: boolean;
}

export interface EnvironmentSettings {
  isProduction: boolean;
}

export interface BriefingEmailSettings {
  enabled: boolean;
  connectionString?: string;
  senderAddress?: string;
  recipients: string[];
  subjectPrefix: string;
}

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
const DEFAULT_DAILY_BRIEFING_SCHEDULE = "0 0 6 * * *";
const DEFAULT_AFTERNOON_BRIEFING_SCHEDULE = "0 0 14 * * *";

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
    apiVersion: readEnv("OPENAI_API_VERSION"),
    useAzureApiKeyAuth: readEnv("OPENAI_USE_AZURE_API_KEY_AUTH") === "true"
      || (readEnv("OPENAI_BASE_URL")?.includes(".openai.azure.com") ?? false),
  };
}

export function getBriefingStorageSettings(): BriefingStorageSettings {
  const configuredFilePath = readEnv("BRIEFING_STORAGE_FILE");
  const homeDirectory = readEnv("HOME");
  const environment = getEnvironmentSettings();
  const provider = readEnv("BRIEFING_STORAGE_PROVIDER");

  return {
    provider: provider === "file" || provider === "blob" ? provider : "auto",
    filePath: configuredFilePath
      ?? (environment.isProduction && homeDirectory
        ? `${homeDirectory}/data/briefings.json`
        : undefined),
    blobContainerName: readEnv("BRIEFING_STORAGE_CONTAINER") ?? "briefings",
    blobName: readEnv("BRIEFING_STORAGE_BLOB_NAME") ?? "briefings.json",
    connectionString: readEnv("BRIEFING_STORAGE_CONNECTION_STRING") ?? readEnv("AzureWebJobsStorage"),
    fallbackToMemory: readEnv("BRIEFING_STORAGE_FALLBACK_TO_MEMORY") !== "false",
  };
}

export function getDailyBriefingScheduleSettings(): ScheduleSettings {
  const morningSchedule = readEnv("MORNING_BRIEFING_SCHEDULE")
    ?? readEnv("DAILY_BRIEFING_SCHEDULE")
    ?? DEFAULT_DAILY_BRIEFING_SCHEDULE;
  const afternoonSchedule = readEnv("AFTERNOON_BRIEFING_SCHEDULE")
    ?? DEFAULT_AFTERNOON_BRIEFING_SCHEDULE;

  return {
    enabled: readEnv("ENABLE_SCHEDULED_BRIEFING") === "true",
    timezone: readEnv("BRIEFING_TIMEZONE") ?? "Asia/Seoul",
    runs: [
      { edition: "Morning", cron: morningSchedule },
      { edition: "Afternoon", cron: afternoonSchedule },
    ],
  };
}

export function getAdminApiSettings(): AdminApiSettings {
  const environment = getEnvironmentSettings();
  return {
    apiKey: readEnv("ADMIN_API_KEY"),
    requireAuth: environment.isProduction || readEnv("REQUIRE_ADMIN_API_AUTH") === "true",
  };
}

export function getAdminProbeSettings(): AdminProbeSettings {
  const environment = getEnvironmentSettings();
  return {
    enabled: !environment.isProduction || readEnv("ENABLE_ADMIN_PROBES") === "true",
  };
}

export function getBriefingEmailSettings(): BriefingEmailSettings {
  const recipients = (readEnv("BRIEFING_EMAIL_RECIPIENTS") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    enabled: readEnv("BRIEFING_EMAIL_ENABLED") === "true",
    connectionString: readEnv("BRIEFING_EMAIL_CONNECTION_STRING"),
    senderAddress: readEnv("BRIEFING_EMAIL_SENDER"),
    recipients,
    subjectPrefix: readEnv("BRIEFING_EMAIL_SUBJECT_PREFIX") ?? "[Global AI Daily Brief]",
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
