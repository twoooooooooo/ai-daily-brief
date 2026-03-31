/**
 * API configuration for Azure Functions integration.
 *
 * Default behavior uses the relative `/api` path:
 * - In production, Azure Static Web Apps routes `/api/*` to Functions.
 * - In local Vite development, the dev server proxies `/api/*` to the
 *   local Azure Functions host.
 *
 * You can still override the full API base URL via `VITE_API_BASE_URL`
 * when you need to point the frontend at a different environment.
 */

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

export const API_BASE_URL = configuredApiBaseUrl || "/api";

export const endpoints = {
  /** GET  /api/briefings/today */
  todayBriefing: `${API_BASE_URL}/briefings/today`,
  /** GET  /api/briefings          — archive list */
  archiveBriefings: `${API_BASE_URL}/briefings`,
  /** GET  /api/briefings/:id      — single briefing */
  briefingById: (id: string) => `${API_BASE_URL}/briefings/${encodeURIComponent(id.trim())}`,
  /** GET  /api/search             — full-text search across briefings */
  search: `${API_BASE_URL}/search`,
  /** GET|POST /api/ops/run-daily-briefing */
  runDailyBriefing: `${API_BASE_URL}/ops/run-daily-briefing`,
} as const;
