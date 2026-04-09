import type { BriefingEdition } from "../shared/contracts.js";

export type BriefingEmailJobStatus = "running" | "completed" | "failed" | "skipped";

export interface BriefingEmailJobRecord {
  id: string;
  status: BriefingEmailJobStatus;
  updatedAt: string;
  date?: string;
  edition?: BriefingEdition;
  briefingId?: string;
  recipientCount?: number;
  reason?: string;
  error?: string;
}

let latestBriefingEmailJob: BriefingEmailJobRecord | null = null;

function nextTimestamp(): string {
  return new Date().toISOString();
}

export function recordBriefingEmailJobStarted(input: {
  id: string;
  date?: string;
  edition?: BriefingEdition;
  briefingId?: string;
}): BriefingEmailJobRecord {
  latestBriefingEmailJob = {
    id: input.id,
    status: "running",
    updatedAt: nextTimestamp(),
    date: input.date,
    edition: input.edition,
    briefingId: input.briefingId,
  };

  return latestBriefingEmailJob;
}

export function recordBriefingEmailJobCompleted(input: {
  id: string;
  date?: string;
  edition?: BriefingEdition;
  briefingId?: string;
  recipientCount?: number;
}): BriefingEmailJobRecord {
  latestBriefingEmailJob = {
    id: input.id,
    status: "completed",
    updatedAt: nextTimestamp(),
    date: input.date,
    edition: input.edition,
    briefingId: input.briefingId,
    recipientCount: input.recipientCount,
  };

  return latestBriefingEmailJob;
}

export function recordBriefingEmailJobSkipped(input: {
  id: string;
  date?: string;
  edition?: BriefingEdition;
  briefingId?: string;
  reason?: string;
}): BriefingEmailJobRecord {
  latestBriefingEmailJob = {
    id: input.id,
    status: "skipped",
    updatedAt: nextTimestamp(),
    date: input.date,
    edition: input.edition,
    briefingId: input.briefingId,
    reason: input.reason,
  };

  return latestBriefingEmailJob;
}

export function recordBriefingEmailJobFailed(input: {
  id: string;
  date?: string;
  edition?: BriefingEdition;
  briefingId?: string;
  error?: string;
}): BriefingEmailJobRecord {
  latestBriefingEmailJob = {
    id: input.id,
    status: "failed",
    updatedAt: nextTimestamp(),
    date: input.date,
    edition: input.edition,
    briefingId: input.briefingId,
    error: input.error,
  };

  return latestBriefingEmailJob;
}

export function getLatestBriefingEmailJob(): BriefingEmailJobRecord | null {
  return latestBriefingEmailJob;
}
