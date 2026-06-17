CREATE INDEX IF NOT EXISTS idx_raw_lead_cache_captured_at
ON raw_lead_cache (captured_at DESC NULLS LAST);
