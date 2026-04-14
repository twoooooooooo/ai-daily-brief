import { EmailClient } from "@azure/communication-email";
import { getBriefingEmailSettings } from "../config/runtimeConfig.js";
import { listActiveSubscribers } from "../repositories/subscriberStore.js";
import type { Briefing } from "../shared/contracts.js";
import { createLogger, type LogContext } from "../utils/logger.js";
import { buildRecipientUnsubscribeLink } from "./subscriptionEmailService.js";

const logger = createLogger("briefing-email");

function getEditionLabel(edition: Briefing["edition"]): string {
  return edition === "Morning" ? "Morning" : "Afternoon";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function buildSubject(briefing: Briefing, subjectPrefix: string): string {
  return `${subjectPrefix} ${briefing.date} ${getEditionLabel(briefing.edition)} Edition`;
}

function getCategoryBadgeStyles(category: Briefing["issues"][number]["category"]): {
  background: string;
  color: string;
  dot: string;
  label: string;
} {
  switch (category) {
    case "Model":
      return { background: "#DBEAFE", color: "#1D4ED8", dot: "#2563EB", label: "모델" };
    case "Research":
      return { background: "#EDE9FE", color: "#6D28D9", dot: "#7C3AED", label: "연구" };
    case "Policy":
      return { background: "#DCFCE7", color: "#166534", dot: "#16A34A", label: "정책" };
    case "Product":
      return { background: "#FEF3C7", color: "#92400E", dot: "#F59E0B", label: "제품" };
    case "Investment":
      return { background: "#FCE7F3", color: "#9D174D", dot: "#EC4899", label: "투자" };
    case "Infrastructure":
      return { background: "#E0F2FE", color: "#0C4A6E", dot: "#0EA5E9", label: "인프라" };
    default:
      return { background: "#E5E7EB", color: "#475569", dot: "#94A3B8", label: category };
  }
}

function getImportanceBadgeStyles(importance: Briefing["issues"][number]["importance"]): {
  background: string;
  border: string;
  color: string;
  label: string;
} {
  switch (importance) {
    case "High":
      return {
        background: "#FEE2E2",
        border: "#FCA5A5",
        color: "#991B1B",
        label: "높음",
      };
    case "Medium":
      return {
        background: "#FEF3C7",
        border: "#FCD34D",
        color: "#92400E",
        label: "보통",
      };
    default:
      return {
        background: "#DBEAFE",
        border: "#93C5FD",
        color: "#1E3A8A",
        label: "낮음",
      };
  }
}

function buildBriefingLink(siteUrl: string, briefing: Briefing): string {
  const baseUrl = siteUrl.replace(/\/+$/, "");
  return `${baseUrl}/archive/${encodeURIComponent(briefing.id)}`;
}

function buildPlainTextBody(briefing: Briefing, siteUrl: string, unsubscribeUrl: string): string {
  const articles = [...briefing.issues, ...briefing.researchHighlights];
  const briefingLink = buildBriefingLink(siteUrl, briefing);
  const lines = [
    `${briefing.date} ${getEditionLabel(briefing.edition)} Edition`,
    "",
    briefing.dailySummary.trend,
    "",
    `Top keywords: ${briefing.dailySummary.topKeywords.join(", ")}`,
    `Trending topics: ${briefing.trendingTopics.join(", ")}`,
    "",
    `View full briefing: ${briefingLink}`,
    `Open homepage: ${siteUrl}`,
    `Manage subscription: ${unsubscribeUrl}`,
    "",
    ...articles.slice(0, 8).flatMap((article, index) => [
      `${index + 1}. ${article.title}`,
      `${article.source} | ${article.category} | ${article.importance}`,
      article.summary,
      `Why it matters: ${article.whyItMatters}`,
      `Practical impact: ${article.practicalImpact}`,
      article.sourceUrl,
      "",
    ]),
  ];

  return lines.join("\n").trim();
}

function buildHtmlBody(briefing: Briefing, siteUrl: string, unsubscribeUrl: string): string {
  const articles = [...briefing.issues, ...briefing.researchHighlights];
  const briefingLink = buildBriefingLink(siteUrl, briefing);
  const lastUpdatedLabel = briefing.lastUpdatedAt
    ? new Date(briefing.lastUpdatedAt).toLocaleString("ko-KR", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
    : null;
  const articleMarkup = articles.slice(0, 8).map((article) => {
    const categoryBadge = getCategoryBadgeStyles(article.category);
    const importanceBadge = getImportanceBadgeStyles(article.importance);
    return `
    <div style="padding:22px 22px 20px;border:1px solid #E5E7EB;border-radius:18px;background:#FFFFFF;margin-bottom:14px;">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
        <span style="display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;background:${categoryBadge.background};color:${categoryBadge.color};font-size:11px;font-weight:800;letter-spacing:0.06em;">
          <span style="display:inline-block;width:6px;height:6px;border-radius:999px;background:${categoryBadge.dot};"></span>
          ${escapeHtml(categoryBadge.label)}
        </span>
        <span style="display:inline-flex;align-items:center;padding:5px 10px;border-radius:999px;background:${importanceBadge.background};border:1px solid ${importanceBadge.border};color:${importanceBadge.color};font-size:11px;font-weight:800;letter-spacing:0.06em;">
          ${escapeHtml(importanceBadge.label)}
        </span>
        <a href="${escapeHtml(article.sourceUrl)}" style="display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;background:#F8FAFC;border:1px solid #CBD5E1;color:#334155;font-size:11px;font-weight:700;text-decoration:none;">
          원문 ${escapeHtml(article.source)}
        </a>
      </div>
      <div style="font-size:21px;line-height:1.4;font-weight:700;color:#0F172A;margin-bottom:10px;">${escapeHtml(article.title)}</div>
      <div style="font-size:14px;line-height:1.75;color:#334155;margin-bottom:12px;">${escapeHtml(article.summary)}</div>
      <div style="font-size:13px;line-height:1.75;color:#0F172A;margin-bottom:8px;"><strong>Why it matters:</strong> ${escapeHtml(article.whyItMatters)}</div>
      <div style="font-size:13px;line-height:1.75;color:#0F172A;"><strong>Practical impact:</strong> ${escapeHtml(article.practicalImpact)}</div>
    </div>
  `;
  }).join("");

  return `
    <div style="margin:0;padding:28px;background:#EEF2F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,Helvetica,sans-serif;color:#0F172A;">
      <div style="max-width:860px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:28px;overflow:hidden;box-shadow:0 18px 45px rgba(15,23,42,0.06);">
        <div style="padding:30px 32px;background:#FFFFFF;color:#0F172A;border-bottom:1px solid #E2E8F0;">
          <div style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#2563EB;font-weight:700;margin-bottom:14px;">Global AI Daily Brief</div>
          <div style="font-size:32px;line-height:1.2;font-weight:700;margin-bottom:8px;color:#0F172A;">${escapeHtml(briefing.date)} ${escapeHtml(getEditionLabel(briefing.edition))} Edition</div>
          <div style="font-size:13px;letter-spacing:0.12em;text-transform:uppercase;color:#475569;font-weight:700;margin-bottom:18px;">Today's Executive Summary</div>
          ${lastUpdatedLabel ? `<div style="font-size:12px;color:#64748B;margin-bottom:18px;">Last updated ${escapeHtml(lastUpdatedLabel)}</div>` : ""}
          <div style="border-left:3px solid #2563EB;padding:2px 0 2px 16px;font-size:15px;line-height:1.9;color:#0F172A;max-width:690px;font-style:italic;background:#F8FAFC;border-radius:0 12px 12px 0;">"${escapeHtml(briefing.dailySummary.trend)}"</div>
          <div style="margin-top:22px;">
            <a href="${escapeHtml(briefingLink)}" style="display:inline-block;padding:11px 18px;border-radius:999px;background:#0F172A;color:#FFFFFF;font-size:13px;font-weight:700;text-decoration:none;margin-right:10px;">View Full Briefing</a>
            <a href="${escapeHtml(siteUrl)}" style="display:inline-block;padding:11px 18px;border-radius:999px;border:1px solid #CBD5E1;background:#FFFFFF;color:#0F172A;font-size:13px;font-weight:700;text-decoration:none;">Open Homepage</a>
          </div>
        </div>
        <div style="padding:28px 32px 10px;background:#F8FAFC;border-bottom:1px solid #EAEFF6;">
          <div style="margin-bottom:18px;">
            <div style="font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:0.16em;margin-bottom:10px;font-weight:700;">Top Keywords</div>
            ${briefing.dailySummary.topKeywords.map((keyword) => `<span style="display:inline-block;margin:0 8px 8px 0;padding:8px 12px;border-radius:999px;background:#FFFFFF;border:1px solid #94A3B8;color:#0F172A;font-size:12px;font-weight:700;">${escapeHtml(keyword)}</span>`).join("")}
          </div>
          <div style="margin-bottom:6px;">
            <div style="font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:0.16em;margin-bottom:10px;font-weight:700;">Trending Topics</div>
            ${briefing.trendingTopics.map((topic) => `<span style="display:inline-block;margin:0 8px 8px 0;padding:8px 12px;border-radius:999px;background:#DBEAFE;border:1px solid #93C5FD;color:#1E3A8A;font-size:12px;font-weight:700;">${escapeHtml(topic)}</span>`).join("")}
          </div>
        </div>
        <div style="padding:26px 32px;background:#FFFFFF;">
          <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:22px;">
            <div style="flex:1 1 180px;min-width:180px;padding:16px 18px;border-radius:18px;background:#F8FAFC;border:1px solid #CBD5E1;">
              <div style="font-size:10px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#475569;margin-bottom:6px;">Analyzed Articles</div>
              <div style="font-size:24px;font-weight:700;color:#0F172A;">${articles.length}</div>
            </div>
            <div style="flex:1 1 180px;min-width:180px;padding:16px 18px;border-radius:18px;background:#F8FAFC;border:1px solid #CBD5E1;">
              <div style="font-size:10px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#475569;margin-bottom:6px;">Top Category</div>
              <div style="font-size:24px;font-weight:700;color:#0F172A;">${escapeHtml(briefing.dailySummary.topCategory)}</div>
            </div>
            <div style="flex:1 1 180px;min-width:180px;padding:16px 18px;border-radius:18px;background:#F8FAFC;border:1px solid #CBD5E1;">
              <div style="font-size:10px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#475569;margin-bottom:6px;">Top Mention</div>
              <div style="font-size:19px;font-weight:700;color:#0F172A;line-height:1.35;">${escapeHtml(briefing.dailySummary.topMention)}</div>
            </div>
          </div>
          ${articleMarkup}
        </div>
        <div style="padding:18px 32px 28px;background:#FFFFFF;">
          <div style="font-size:12px;color:#64748B;line-height:1.7;">
            You're receiving this because you subscribed to Global AI Daily Brief updates.
            <a href="${escapeHtml(unsubscribeUrl)}" style="color:#1D4ED8;text-decoration:none;margin-left:6px;">Unsubscribe</a>
          </div>
        </div>
      </div>
    </div>
  `.trim();
}

export async function sendBriefingEmail(
  briefing: Briefing,
  logContext: LogContext = {},
  options: {
    overrideRecipients?: string[];
  } = {},
): Promise<{ skipped: boolean; reason?: string; recipientCount?: number }> {
  const settings = getBriefingEmailSettings();
  const scopedLogger = logger.child(logContext);

  if (!settings.enabled) {
    return { skipped: true, reason: "email-disabled" };
  }

  if (!settings.connectionString || !settings.senderAddress) {
    scopedLogger.warn("Skipping briefing email because email configuration is incomplete.", {
      hasConnectionString: Boolean(settings.connectionString),
      hasSenderAddress: Boolean(settings.senderAddress),
      recipientCount: settings.recipients.length,
    });
    return { skipped: true, reason: "email-config-incomplete" };
  }

  const subscriberAddresses = options.overrideRecipients
    ? []
    : (await listActiveSubscribers()).map((subscriber) => subscriber.email);
  const recipientAddresses = [...new Set(options.overrideRecipients ?? [...settings.recipients, ...subscriberAddresses])];

  if (recipientAddresses.length === 0) {
    scopedLogger.warn("Skipping briefing email because there are no recipients configured.");
    return { skipped: true, reason: "no-recipients" };
  }

  const client = new EmailClient(settings.connectionString);
  for (const address of recipientAddresses) {
    const unsubscribeUrl = buildRecipientUnsubscribeLink(address);
    const poller = await client.beginSend({
      // Azure Communication Services validates senderAddress as a plain email address.
      senderAddress: settings.senderAddress,
      content: {
        subject: buildSubject(briefing, settings.subjectPrefix),
        plainText: buildPlainTextBody(briefing, settings.siteUrl, unsubscribeUrl),
        html: buildHtmlBody(briefing, settings.siteUrl, unsubscribeUrl),
      },
      recipients: {
        to: [{ address }],
      },
    });

    await poller.pollUntilDone();
  }
  scopedLogger.info("Sent briefing email notification.", {
    briefingId: briefing.id,
    recipientCount: recipientAddresses.length,
  });

  return {
    skipped: false,
    recipientCount: recipientAddresses.length,
  };
}
