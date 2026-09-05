/**
 * Jellybean CRM -> Google Sheets Sync Dispatcher
 * Dispatches INSERT, UPDATE, and DELETE events to your Google Apps Script Webhook.
 */

// Optional: You can put your deployed Google Apps Script Web App URL here or in .env
const GOOGLE_SCRIPT_WEBHOOK_URL =
  (import.meta.env.VITE_GOOGLE_SHEETS_WEBHOOK_URL as string | undefined) || "";

export type SyncAction = "INSERT" | "UPDATE" | "DELETE";

export type LeadSyncPayload = {
  id: string;
  customer_name?: string | null;
  customer_number?: string | null;
  customer_number_2?: string | null;
  main_area?: string | null;
  sub_area?: string | null;
  service?: string | null;
  cs_status?: string | null;
  number_name?: string | null;
  context?: string | null;
  requirement_1?: string | null;
  requirement_2?: string | null;
  post_text?: string | null;
  marketing_notes?: string | null;
  assigned_to?: string | null;
  created_at?: string | null;
  assigned_at?: string | null;
  pinned_important?: boolean | null;
  is_important?: boolean | null;
  [key: string]: unknown;
};

export async function syncLeadToGoogleSheet(
  action: SyncAction,
  lead: LeadSyncPayload,
  webhookUrl = GOOGLE_SCRIPT_WEBHOOK_URL
) {
  if (!webhookUrl) {
    // If webhook URL is not configured yet, skip quietly
    return;
  }

  try {
    const payload = {
      type: action,
      record: action !== "DELETE" ? lead : null,
      old_record: action === "DELETE" ? { id: lead.id } : undefined,
      timestamp: new Date().toISOString(),
    };

    // Google Apps Script requires no-cors if calling from browser, or simple POST
    await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify(payload),
      mode: "no-cors", // Allows browser-to-Google Apps Script without CORS blockage
    });
  } catch (err) {
    console.warn("[GoogleSheetsSync] Best-effort sync notice:", err);
  }
}
