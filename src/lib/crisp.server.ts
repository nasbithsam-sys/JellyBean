// Server-only Crisp REST helpers. Never imported from client code.

export interface CrispCredentials {
  websiteId: string;
  tokenId: string;
  tokenKey: string;
}

export function getCrispCredentials(): CrispCredentials {
  const websiteId = process.env["CRISP_WEBSITE_ID"];
  const tokenId = process.env["CRISP_TOKEN_ID"];
  const tokenKey = process.env["CRISP_TOKEN_KEY"];
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
    "X-Crisp-Tier": "website",
    "Content-Type": "application/json",
  };
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
