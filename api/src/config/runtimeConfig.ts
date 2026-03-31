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

export interface ScheduleSettings {
  cron: string;
  enabled: boolean;
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

export function getAdminProbeSettings(): AdminProbeSettings {
  const environment = getEnvironmentSettings();
  return {
    enabled: !environment.isProduction || readEnv("ENABLE_ADMIN_PROBES") === "true",
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
