import { getDb, closePool } from '../db/index';
import { batches } from '../db/schema';
import { normalizeBatchExpiry } from '@pos/shared';

interface DiscrepancyReport {
  id: string;
  pharmacyId: string;
  productId: string;
  batchNo: string;
  rawExpiry: string;
  convertedExpiry: string | null;
  error?: string;
}

export async function runExpiryDryRunCheck(): Promise<{
  total: number;
  valid: number;
  discrepancies: DiscrepancyReport[];
}> {
  const db = getDb();
  console.log('[DryRunExpiryCheck] Querying batches table from PostgreSQL...');

  const allBatches = await db
    .select({
      id: batches.id,
      pharmacyId: batches.pharmacyId,
      productId: batches.productId,
      batchNo: batches.batchNo,
      expiryDate: batches.expiryDate,
    })
    .from(batches);

  console.log(`[DryRunExpiryCheck] Total batches found: ${allBatches.length}`);

  let valid = 0;
  const discrepancies: DiscrepancyReport[] = [];

  for (const b of allBatches) {
    const raw = b.expiryDate;
    const isIsoYmd = /^\d{4}-\d{2}-\d{2}$/.test(raw);

    try {
      const normalized = normalizeBatchExpiry(raw);
      if (isIsoYmd && normalized === raw) {
        valid++;
      } else {
        discrepancies.push({
          id: b.id,
          pharmacyId: b.pharmacyId,
          productId: b.productId,
          batchNo: b.batchNo,
          rawExpiry: raw,
          convertedExpiry: normalized,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      discrepancies.push({
        id: b.id,
        pharmacyId: b.pharmacyId,
        productId: b.productId,
        batchNo: b.batchNo,
        rawExpiry: raw,
        convertedExpiry: null,
        error: msg,
      });
    }
  }

  console.log(`\n==================================================`);
  console.log(`BATCH EXPIRY DRY-RUN AUDIT REPORT`);
  console.log(`==================================================`);
  console.log(`Total batches examined:   ${allBatches.length}`);
  console.log(`Valid YYYY-MM-DD batches: ${valid}`);
  console.log(`Discrepancies found:      ${discrepancies.length}`);

  if (discrepancies.length > 0) {
    console.log(`\n[!] Non-matching rows identified (DRY-RUN - NO CHANGES APPLIED):`);
    console.table(
      discrepancies.map((d) => ({
        id: d.id,
        batchNo: d.batchNo,
        rawExpiry: d.rawExpiry,
        convertedExpiry: d.convertedExpiry ?? 'INVALID',
        error: d.error ?? 'None',
      }))
    );
  } else {
    console.log(`\n[OK] 100% of existing rows in batches satisfy YYYY-MM-DD format!`);
    console.log(`Safe to apply CHECK constraint directly.`);
  }

  return { total: allBatches.length, valid, discrepancies };
}

// Run directly if invoked via CLI
if (process.argv[1]?.includes('dry-run-expiry-check')) {
  runExpiryDryRunCheck()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[DryRunExpiryCheck] Error during dry-run audit:', err);
      await closePool();
      process.exit(1);
    });
}
