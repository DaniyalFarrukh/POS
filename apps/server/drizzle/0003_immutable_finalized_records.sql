ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_finalized_record_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'finalized records are immutable';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_invoices_immutable
BEFORE UPDATE OR DELETE ON "invoices"
FOR EACH ROW EXECUTE FUNCTION prevent_finalized_record_modification();--> statement-breakpoint
CREATE TRIGGER trg_invoice_lines_immutable
BEFORE UPDATE OR DELETE ON "invoice_lines"
FOR EACH ROW EXECUTE FUNCTION prevent_finalized_record_modification();--> statement-breakpoint
CREATE TRIGGER trg_payments_immutable
BEFORE UPDATE OR DELETE ON "payments"
FOR EACH ROW EXECUTE FUNCTION prevent_finalized_record_modification();--> statement-breakpoint
CREATE TRIGGER trg_credit_notes_immutable
BEFORE UPDATE OR DELETE ON "credit_notes"
FOR EACH ROW EXECUTE FUNCTION prevent_finalized_record_modification();--> statement-breakpoint
CREATE TRIGGER trg_credit_note_lines_immutable
BEFORE UPDATE OR DELETE ON "credit_note_lines"
FOR EACH ROW EXECUTE FUNCTION prevent_finalized_record_modification();

