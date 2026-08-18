// Server-only Crisp REST helpers. Never imported from client code.

export interface CrispPluginCredentials {
  tokenId: string;
  tokenKey: string;
}

export interface CrispWebsiteCredentials {
  websiteId: string;
  tokenId: string;
  tokenKey: string;
}

export function getCrispPluginCredentials(): CrispPluginCredentials | null {
  const tokenId = process.env["CRISP_PLUGIN_TOKEN_ID"]?.trim();
  const tokenKey = process.env["CRISP_PLUGIN_TOKEN_KEY"]?.trim();
  if (!tokenId || !tokenKey) return null;
  return { tokenId, tokenKey };
}

export function getLegacyCrispWebsiteCredentials(): CrispWebsiteCredentials | null {
  const websiteId = process.env["CRISP_WEBSITE_ID"]?.trim();
  const tokenId = process.env["CRISP_TOKEN_ID"]?.trim();
  const tokenKey = process.env["CRISP_TOKEN_KEY"]?.trim();
  if (!websiteId || !tokenId || !tokenKey) return null;
  return { websiteId, tokenId, tokenKey };
}

export function crispPluginHeaders(creds: CrispPluginCredentials): Record<string, string> {
  return {
    Authorization: `Basic ${btoa(`${creds.tokenId}:${creds.tokenKey}`)}`,
    "X-Crisp-Tier": "plugin",
    "Content-Type": "application/json",
  };
}

export function crispWebsiteHeaders(creds: CrispWebsiteCredentials): Record<string, string> {
  return {
    Authorization: `Basic ${btoa(`${creds.tokenId}:${creds.tokenKey}`)}`,
    "X-Crisp-Tier": "website",
    "Content-Type": "application/json",
  };
}

export function crispApiError(status: number, payload: Record<string, unknown>, mode: "plugin" | "website"): string {
  const reason = String(payload["reason"] ?? payload["message"] ?? "");
  if (reason === "invalid_session" || status === 401) {
    if (mode === "plugin") {
      return "Crisp rejected Plugin credentials. Verify CRISP_PLUGIN_TOKEN_ID and CRISP_PLUGIN_TOKEN_KEY belong to an active Crisp Plugin.";
    }
    return "Crisp rejected legacy Website credentials. Verify CRISP_WEBSITE_ID, CRISP_TOKEN_ID and CRISP_TOKEN_KEY.";
  }
  return reason || `Crisp API returned status ${status}`;
}

export function messageText(rawContent: unknown): string {
  if (typeof rawContent === "string") return rawContent;
  if (rawContent && typeof rawContent === "object") {
    const text = (rawContent as { text?: unknown }).text;
    if (typeof text === "string") return text;
    return JSON.stringify(rawContent);
  }
  return "";
}
