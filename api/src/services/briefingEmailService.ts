import { EmailClient } from "@azure/communication-email";
import { getBriefingEmailSettings } from "../config/runtimeConfig.js";
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
  const articleMarkup = articles.slice(0, 8).map((article) => `
    <div style="padding:18px 0;border-top:1px solid #E5E7EB;">
      <div style="font-size:12px;color:#64748B;margin-bottom:8px;">${escapeHtml(article.source)} · ${escapeHtml(article.category)} · ${escapeHtml(article.importance)}</div>
      <div style="font-size:20px;line-height:1.35;font-weight:700;color:#0F172A;margin-bottom:10px;">${escapeHtml(article.title)}</div>
      <div style="font-size:14px;line-height:1.7;color:#334155;margin-bottom:10px;">${escapeHtml(article.summary)}</div>
      <div style="font-size:13px;line-height:1.7;color:#0F172A;margin-bottom:8px;"><strong>Why it matters:</strong> ${escapeHtml(article.whyItMatters)}</div>
      <div style="font-size:13px;line-height:1.7;color:#0F172A;margin-bottom:10px;"><strong>Practical impact:</strong> ${escapeHtml(article.practicalImpact)}</div>
      <a href="${escapeHtml(article.sourceUrl)}" style="font-size:13px;color:#2563EB;text-decoration:none;">Read source</a>
    </div>
  `).join("");

  return `
    <div style="margin:0;padding:32px;background:#F8FAFC;font-family:Arial,Helvetica,sans-serif;color:#0F172A;">
      <div style="max-width:820px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:24px;overflow:hidden;">
        <div style="padding:32px;background:linear-gradient(135deg,#08111F 0%,#16325C 100%);color:#FFFFFF;">
          <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#9FEACD;margin-bottom:12px;">Global AI Daily Brief</div>
          <div style="font-size:30px;line-height:1.2;font-weight:700;margin-bottom:10px;">${escapeHtml(briefing.date)} ${escapeHtml(getEditionLabel(briefing.edition))} Edition</div>
          <div style="font-size:16px;line-height:1.7;color:#D9E4F7;">${escapeHtml(briefing.dailySummary.trend)}</div>
          <div style="margin-top:20px;">
            <a href="${escapeHtml(briefingLink)}" style="display:inline-block;padding:11px 18px;border-radius:999px;background:#87F5D1;color:#08111F;font-size:13px;font-weight:700;text-decoration:none;margin-right:10px;">View Full Briefing</a>
            <a href="${escapeHtml(siteUrl)}" style="display:inline-block;padding:11px 18px;border-radius:999px;border:1px solid rgba(255,255,255,0.18);color:#FFFFFF;font-size:13px;font-weight:700;text-decoration:none;">Open Homepage</a>
          </div>
        </div>
        <div style="padding:28px 32px;">
          <div style="font-size:12px;color:#64748B;text-transform:uppercase;letter-spacing:0.14em;margin-bottom:12px;">Top Keywords</div>
          <div style="margin-bottom:20px;">
            ${briefing.dailySummary.topKeywords.map((keyword) => `<span style="display:inline-block;margin:0 8px 8px 0;padding:7px 12px;border-radius:999px;background:#EEF2FF;color:#1D4ED8;font-size:12px;font-weight:600;">${escapeHtml(keyword)}</span>`).join("")}
          </div>
          <div style="margin-bottom:20px;">
            <div style="font-size:12px;color:#64748B;text-transform:uppercase;letter-spacing:0.14em;margin-bottom:12px;">Trending Topics</div>
            ${briefing.trendingTopics.map((topic) => `<span style="display:inline-block;margin:0 8px 8px 0;padding:7px 12px;border-radius:999px;background:#ECFDF5;color:#047857;font-size:12px;font-weight:600;">${escapeHtml(topic)}</span>`).join("")}
          </div>
          ${articleMarkup}
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

  if (!settings.connectionString || !settings.senderAddress || settings.recipients.length === 0) {
    scopedLogger.warn("Skipping briefing email because email configuration is incomplete.", {
      hasConnectionString: Boolean(settings.connectionString),
      hasSenderAddress: Boolean(settings.senderAddress),
      recipientCount: settings.recipients.length,
    });
    return { skipped: true, reason: "email-config-incomplete" };
  }

  const client = new EmailClient(settings.connectionString);
  const poller = await client.beginSend({
      senderAddress: settings.senderAddress,
      content: {
        subject: buildSubject(briefing, settings.subjectPrefix),
        plainText: buildPlainTextBody(briefing, settings.siteUrl),
        html: buildHtmlBody(briefing, settings.siteUrl),
      },
    recipients: {
      to: settings.recipients.map((address) => ({ address })),
    },
  });

  await poller.pollUntilDone();
  scopedLogger.info("Sent briefing email notification.", {
    briefingId: briefing.id,
    recipientCount: settings.recipients.length,
  });

  return {
    skipped: false,
    recipientCount: settings.recipients.length,
  };
}
