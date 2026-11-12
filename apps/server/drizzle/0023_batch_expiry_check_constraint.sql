-- Enforce YYYY-MM-DD standard format on batches.expiry_date
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'batches_expiry_date_format_chk'
  ) THEN
    ALTER TABLE "batches"
      ADD CONSTRAINT "batches_expiry_date_format_chk"
      CHECK (expiry_date ~ '^\d{4}-\d{2}-\d{2}$');
  END IF;
END $$;
