import { EmailClient } from "@azure/communication-email";
import { getBriefingEmailSettings } from "../config/runtimeConfig.js";
import { listActiveSubscribers } from "../repositories/subscriberStore.js";
import type { Briefing } from "../shared/contracts.js";
import { createLogger, type LogContext } from "../utils/logger.js";

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

function buildBriefingLink(siteUrl: string, briefing: Briefing): string {
  const baseUrl = siteUrl.replace(/\/+$/, "");
  return `${baseUrl}/archive/${encodeURIComponent(briefing.id)}`;
}

function buildPlainTextBody(briefing: Briefing, siteUrl: string): string {
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

function buildHtmlBody(briefing: Briefing, siteUrl: string): string {
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
  const articleMarkup = articles.slice(0, 8).map((article) => `
    <div style="padding:22px 22px 20px;border:1px solid #E5E7EB;border-radius:18px;background:#FFFFFF;margin-bottom:14px;">
      <div style="font-size:12px;color:#64748B;margin-bottom:10px;letter-spacing:0.04em;">${escapeHtml(article.source)} · ${escapeHtml(article.category)} · ${escapeHtml(article.importance)}</div>
      <div style="font-size:21px;line-height:1.4;font-weight:700;color:#0F172A;margin-bottom:10px;">${escapeHtml(article.title)}</div>
      <div style="font-size:14px;line-height:1.75;color:#334155;margin-bottom:12px;">${escapeHtml(article.summary)}</div>
      <div style="font-size:13px;line-height:1.75;color:#0F172A;margin-bottom:8px;"><strong>Why it matters:</strong> ${escapeHtml(article.whyItMatters)}</div>
      <div style="font-size:13px;line-height:1.75;color:#0F172A;margin-bottom:14px;"><strong>Practical impact:</strong> ${escapeHtml(article.practicalImpact)}</div>
      <a href="${escapeHtml(article.sourceUrl)}" style="display:inline-block;font-size:13px;color:#1D4ED8;text-decoration:none;font-weight:700;">Read source</a>
    </div>
  `).join("");

  return `
    <div style="margin:0;padding:28px;background:#F3F6FB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,Helvetica,sans-serif;color:#0F172A;">
      <div style="max-width:860px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:28px;overflow:hidden;box-shadow:0 18px 45px rgba(15,23,42,0.06);">
        <div style="padding:30px 32px;background:linear-gradient(145deg,#08101D 0%,#173256 100%);color:#FFFFFF;">
          <div style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#B6F8E3;font-weight:700;margin-bottom:14px;">Global AI Daily Brief</div>
          <div style="font-size:32px;line-height:1.2;font-weight:700;margin-bottom:8px;">${escapeHtml(briefing.date)} ${escapeHtml(getEditionLabel(briefing.edition))} Edition</div>
          <div style="font-size:13px;letter-spacing:0.12em;text-transform:uppercase;color:#D3E6FF;font-weight:700;margin-bottom:18px;">Today's Executive Summary</div>
          ${lastUpdatedLabel ? `<div style="font-size:12px;color:#F1F5F9;margin-bottom:18px;">Last updated ${escapeHtml(lastUpdatedLabel)}</div>` : ""}
          <div style="border-left:2px solid #8EF0D0;padding-left:16px;font-size:15px;line-height:1.9;color:#FFFFFF;max-width:690px;font-style:italic;">"${escapeHtml(briefing.dailySummary.trend)}"</div>
          <div style="margin-top:22px;">
            <a href="${escapeHtml(briefingLink)}" style="display:inline-block;padding:11px 18px;border-radius:999px;background:#86F5D0;color:#08111F;font-size:13px;font-weight:700;text-decoration:none;margin-right:10px;">View Full Briefing</a>
            <a href="${escapeHtml(siteUrl)}" style="display:inline-block;padding:11px 18px;border-radius:999px;border:1px solid rgba(255,255,255,0.34);background:rgba(255,255,255,0.08);color:#FFFFFF;font-size:13px;font-weight:700;text-decoration:none;">Open Homepage</a>
          </div>
        </div>
        <div style="padding:28px 32px 10px;background:#F8FAFC;border-bottom:1px solid #EAEFF6;">
          <div style="margin-bottom:18px;">
            <div style="font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:0.16em;margin-bottom:10px;font-weight:700;">Top Keywords</div>
            ${briefing.dailySummary.topKeywords.map((keyword) => `<span style="display:inline-block;margin:0 8px 8px 0;padding:8px 12px;border-radius:999px;background:#FFFFFF;border:1px solid #CBD5E1;color:#0F172A;font-size:12px;font-weight:700;">${escapeHtml(keyword)}</span>`).join("")}
          </div>
          <div style="margin-bottom:6px;">
            <div style="font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:0.16em;margin-bottom:10px;font-weight:700;">Trending Topics</div>
            ${briefing.trendingTopics.map((topic) => `<span style="display:inline-block;margin:0 8px 8px 0;padding:8px 12px;border-radius:999px;background:#EFF6FF;border:1px solid #BFDBFE;color:#1D4ED8;font-size:12px;font-weight:700;">${escapeHtml(topic)}</span>`).join("")}
          </div>
        </div>
        <div style="padding:26px 32px;background:#FFFFFF;">
          <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:22px;">
            <div style="flex:1 1 180px;min-width:180px;padding:16px 18px;border-radius:18px;background:#F8FAFC;border:1px solid #E5E7EB;">
              <div style="font-size:10px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#475569;margin-bottom:6px;">Analyzed Articles</div>
              <div style="font-size:24px;font-weight:700;color:#0F172A;">${articles.length}</div>
            </div>
            <div style="flex:1 1 180px;min-width:180px;padding:16px 18px;border-radius:18px;background:#F8FAFC;border:1px solid #E5E7EB;">
              <div style="font-size:10px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#475569;margin-bottom:6px;">Top Category</div>
              <div style="font-size:24px;font-weight:700;color:#0F172A;">${escapeHtml(briefing.dailySummary.topCategory)}</div>
            </div>
            <div style="flex:1 1 180px;min-width:180px;padding:16px 18px;border-radius:18px;background:#F8FAFC;border:1px solid #E5E7EB;">
              <div style="font-size:10px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#475569;margin-bottom:6px;">Top Mention</div>
              <div style="font-size:24px;font-weight:700;color:#0F172A;">${escapeHtml(briefing.dailySummary.topMention)}</div>
            </div>
          </div>
          ${articleMarkup}
        </div>
        <div style="padding:18px 32px 28px;background:#FFFFFF;">
          <div style="font-size:12px;color:#64748B;line-height:1.7;">
            You're receiving this because you subscribed to Global AI Daily Brief updates.
          </div>
        </div>
      </div>
    </div>
  `.trim();
}

export async function sendBriefingEmail(
  briefing: Briefing,
  logContext: LogContext = {},
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

  const subscriberAddresses = (await listActiveSubscribers()).map((subscriber) => subscriber.email);
  const recipientAddresses = [...new Set([...settings.recipients, ...subscriberAddresses])];

  if (recipientAddresses.length === 0) {
    scopedLogger.warn("Skipping briefing email because there are no recipients configured.");
    return { skipped: true, reason: "no-recipients" };
  }

  const client = new EmailClient(settings.connectionString);
  const poller = await client.beginSend({
    // Azure Communication Services validates senderAddress as a plain email address.
    senderAddress: settings.senderAddress,
    content: {
      subject: buildSubject(briefing, settings.subjectPrefix),
      plainText: buildPlainTextBody(briefing, settings.siteUrl),
      html: buildHtmlBody(briefing, settings.siteUrl),
    },
    recipients: {
      to: recipientAddresses.map((address) => ({ address })),
    },
  });

  await poller.pollUntilDone();
  scopedLogger.info("Sent briefing email notification.", {
    briefingId: briefing.id,
    recipientCount: recipientAddresses.length,
  });

  return {
    skipped: false,
    recipientCount: recipientAddresses.length,
  };
}
