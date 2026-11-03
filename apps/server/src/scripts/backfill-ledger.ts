import { getDb, closePool } from '../db';
import { backfillLedgerEntries } from '../ledger/backfill';

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const pharmacyArg = args.find((a) => a.startsWith('--pharmacy-id='));
  const pharmacyId = pharmacyArg ? pharmacyArg.split('=')[1] : undefined;

  const db = getDb();
  try {
    const summary = await backfillLedgerEntries(db, {
      pharmacyId,
      dryRun,
    });

    console.log(
      JSON.stringify(
        {
          mode: summary.dryRun ? 'dry-run' : 'live',
          pharmacyId: summary.pharmacyId ?? 'ALL',
          purchases: summary.purchases,
          invoices: summary.invoices,
          creditNotes: summary.creditNotes,
          stockAdjustments: summary.stockAdjustments,
          totalEntriesPosted: summary.totalEntriesPosted,
        },
        null,
        2
      )
    );
  } finally {
    await closePool();
  }
}

if (process.argv[1] && process.argv[1].endsWith('backfill-ledger.ts')) {
  main().catch((err) => {
    console.error('[backfill-ledger] Fatal error:', err);
    process.exit(1);
  });
}
