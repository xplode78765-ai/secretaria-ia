ALTER TABLE evolution_api_connections
ADD COLUMN IF NOT EXISTS qr_code_updated_at timestamptz;
