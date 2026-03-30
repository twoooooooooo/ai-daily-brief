import { getEnvironmentSettings, getBriefingStorageSettings } from "../config/runtimeConfig.js";
import { createLogger } from "../utils/logger.js";
import { BlobBriefingStore } from "./blobBriefingStore.js";
import { getBriefingStorageStatus as getInMemoryStorageStatus, inMemoryBriefingStore } from "./inMemoryBriefingStore.js";
import type { BriefingStore } from "./briefingStore.js";

const logger = createLogger("briefing-store-provider");

type StorageProviderName = "blob" | "file";

interface BriefingStoreStatus {
  provider: StorageProviderName;
  details: Record<string, unknown>;
}

function shouldUseBlobStorage(): boolean {
  const storageSettings = getBriefingStorageSettings();
  const environment = getEnvironmentSettings();

  if (storageSettings.provider === "blob") {
    return true;
  }

  if (storageSettings.provider === "file") {
    return false;
  }

  return environment.isProduction && typeof storageSettings.connectionString === "string";
}

function createBriefingStore(): {
  store: BriefingStore;
  status: BriefingStoreStatus;
} {
  const storageSettings = getBriefingStorageSettings();

  if (shouldUseBlobStorage() && storageSettings.connectionString) {
    logger.info("Using Azure Blob Storage for briefing persistence.", {
      containerName: storageSettings.blobContainerName,
      blobName: storageSettings.blobName,
    });
    return {
      store: new BlobBriefingStore(
        storageSettings.connectionString,
        storageSettings.blobContainerName,
        storageSettings.blobName,
      ),
      status: {
        provider: "blob",
        details: {
          containerName: storageSettings.blobContainerName,
          blobName: storageSettings.blobName,
        },
      },
    };
  }

  const fileStatus = getInMemoryStorageStatus();
  logger.info("Using file-backed briefing persistence.", fileStatus);
  return {
    store: inMemoryBriefingStore,
    status: {
      provider: "file",
      details: fileStatus,
    },
  };
}

const configuredStore = createBriefingStore();

export const briefingStore = configuredStore.store;

export function getBriefingStoreStatus(): BriefingStoreStatus {
  if (configuredStore.status.provider === "blob") {
    return configuredStore.status;
  }

  return {
    provider: "file",
    details: getInMemoryStorageStatus(),
  };
}
