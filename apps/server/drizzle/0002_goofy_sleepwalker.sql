ALTER TABLE "change_log" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
CREATE INDEX "idx_change_log_pharmacy_branch_seq" ON "change_log" USING btree ("pharmacy_id","branch_id","seq");--> statement-breakpoint
-- Backfill branch_id for branch-scoped entities where the referenced branch exists
UPDATE "change_log" c
SET "branch_id" = v.extracted_id
FROM (
  SELECT seq,
    CASE
      WHEN (data->>'branchId') IS NOT NULL AND (data->>'branchId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN (data->>'branchId')::uuid
      WHEN (data->>'branch_id') IS NOT NULL AND (data->>'branch_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN (data->>'branch_id')::uuid
      ELSE NULL
    END AS extracted_id
  FROM "change_log"
  WHERE "branch_id" IS NULL
    AND "entity" IN ('stock_movement', 'counter', 'device', 'stock_alert')
    AND ((data->>'branchId') IS NOT NULL OR (data->>'branch_id') IS NOT NULL)
) v
WHERE c.seq = v.seq
  AND v.extracted_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "branches" b
    WHERE b.id = v.extracted_id AND b.pharmacy_id = c.pharmacy_id
  );
