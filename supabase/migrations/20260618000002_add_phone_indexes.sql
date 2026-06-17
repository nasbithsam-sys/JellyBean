CREATE INDEX IF NOT EXISTS idx_qualified_leads_customer_number
ON qualified_leads (customer_number);

CREATE INDEX IF NOT EXISTS idx_qualified_leads_customer_number_2
ON qualified_leads (customer_number_2);

CREATE INDEX IF NOT EXISTS idx_qualified_leads_assigned_at
ON qualified_leads (assigned_at DESC);
