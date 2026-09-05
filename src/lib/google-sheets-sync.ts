/**
 * Jellybean CRM -> Google Sheets Sync Dispatcher
 * Dispatches INSERT, UPDATE, and DELETE events to your Google Apps Script Webhook.
 */

export function getGoogleSheetsWebhookUrl(): string {
  if (typeof window !== "undefined") {
    const fromStorage = localStorage.getItem("jellybean_google_sheets_webhook");
    if (fromStorage && fromStorage.trim()) {
      return fromStorage.trim();
    }
  }
  return (import.meta.env.VITE_GOOGLE_SHEETS_WEBHOOK_URL as string | undefined) || "";
}

export function isGoogleSheetsAutoSyncEnabled(): boolean {
  if (typeof window !== "undefined") {
    return localStorage.getItem("jellybean_google_sheets_autosync") !== "false";
  }
  return true;
}

export type SyncAction = "INSERT" | "UPDATE" | "DELETE";

export type LeadSyncPayload = {
  id: string;
  customer_name?: string | null;
  customer_number?: string | null;
  customer_number_2?: string | null;
  main_area?: string | null;
  sub_area?: string | null;
  area?: string | null;
  service?: string | null;
  cs_status?: string | null;
  number_name?: string | null;
  context?: string | null;
  requirement_1?: string | null;
  requirement_2?: string | null;
  post_text?: string | null;
  marketing_notes?: string | null;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  created_at?: string | null;
  assigned_at?: string | null;
  pinned_important?: boolean | null;
  is_important?: boolean | null;
  [key: string]: unknown;
};

export async function syncLeadToGoogleSheet(
  action: SyncAction,
  lead: LeadSyncPayload,
  customWebhookUrl?: string,
) {
  const webhookUrl = (customWebhookUrl || getGoogleSheetsWebhookUrl()).trim();

  if (!webhookUrl || !isGoogleSheetsAutoSyncEnabled()) {
    return;
  }

  try {
    const payload = {
      type: action,
      action: action,
      record: action !== "DELETE" ? lead : null,
      lead: action !== "DELETE" ? lead : null,
      old_record: action === "DELETE" ? { id: lead.id } : undefined,
      old_lead: action === "DELETE" ? { id: lead.id } : undefined,
      leadId: lead.id,
      timestamp: new Date().toISOString(),
    };

    // Use mode: 'no-cors' so browser fetch to Google Apps Script does not fail on CORS redirect
    await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify(payload),
      mode: "no-cors",
    });
  } catch (err) {
    console.warn("[GoogleSheetsSync] Sync notice:", err);
  }
}
