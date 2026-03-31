import type { Briefing, BriefingEdition } from "../shared/contracts.js";

const DEFAULT_TIMEZONE = "Asia/Seoul";

function getDateParts(value: Date, timeZone = DEFAULT_TIMEZONE): {
  year: string;
  month: string;
  day: string;
  hour: number;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(value);
  const getPart = (type: string) => parts.find((part) => part.type === type)?.value ?? "";

  return {
    year: getPart("year"),
    month: getPart("month"),
    day: getPart("day"),
    hour: Number.parseInt(getPart("hour"), 10) || 0,
  };
}

export function getBriefingTimezone(): string {
  return process.env.BRIEFING_TIMEZONE?.trim() || DEFAULT_TIMEZONE;
}

export function resolveBriefingEdition(inputDate = new Date(), timeZone = getBriefingTimezone()): BriefingEdition {
  const { hour } = getDateParts(inputDate, timeZone);
  return hour < 12 ? "Morning" : "Afternoon";
}

export function resolveBriefingDate(inputDate = new Date(), timeZone = getBriefingTimezone()): string {
  const parts = getDateParts(inputDate, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function buildBriefingId(date: string, edition: BriefingEdition): string {
  return `briefing-${date}-${edition.toLowerCase()}`;
}

export function getEditionRank(edition: BriefingEdition): number {
  return edition === "Afternoon" ? 2 : 1;
}

export function compareBriefingsByRecency(
  left: Pick<Briefing, "date" | "edition" | "lastUpdatedAt">,
  right: Pick<Briefing, "date" | "edition" | "lastUpdatedAt">,
): number {
  const dateComparison = right.date.localeCompare(left.date);
  if (dateComparison !== 0) {
    return dateComparison;
  }

  const editionComparison = getEditionRank(right.edition) - getEditionRank(left.edition);
  if (editionComparison !== 0) {
    return editionComparison;
  }

  return (right.lastUpdatedAt ?? "").localeCompare(left.lastUpdatedAt ?? "");
}
