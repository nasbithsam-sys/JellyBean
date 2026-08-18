// Server-only Crisp REST helpers. Never imported from client code.

export interface CrispCredentials {
  websiteId: string;
  tokenId: string;
  tokenKey: string;
}

export function getCrispCredentials(): CrispCredentials {
  const websiteId = process.env["CRISP_WEBSITE_ID"]?.trim();
  const tokenId = process.env["CRISP_TOKEN_ID"]?.trim();
  const tokenKey = process.env["CRISP_TOKEN_KEY"]?.trim();
  if (!websiteId || !tokenId || !tokenKey) {
    throw new Error(
      "Crisp integration is not configured yet. Missing CRISP_WEBSITE_ID, CRISP_TOKEN_ID or CRISP_TOKEN_KEY.",
    );
  }
  return { websiteId, tokenId, tokenKey };
}

export function crispHeaders(creds: CrispCredentials): Record<string, string> {
  return {
    Authorization: `Basic ${btoa(`${creds.tokenId}:${creds.tokenKey}`)}`,
    // Token ID / Token Key credentials are Crisp plugin tokens. The "website"
    // tier expects a website session and Crisp rejects plugin tokens as invalid_session.
    "X-Crisp-Tier": "plugin",
    "Content-Type": "application/json",
  };
}

export function crispApiError(status: number, payload: Record<string, unknown>): string {
  const reason = String(payload["reason"] ?? payload["message"] ?? "");
  if (reason === "invalid_session" || status === 401) {
    return "Crisp rejected the integration credentials. Verify that the Token ID and Token Key belong to an active Crisp plugin with website conversation permissions.";
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
