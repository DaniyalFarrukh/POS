import dotenv from 'dotenv';
import { asc } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';
import { pharmacies } from '../db/schema';
import { getDb, closePool } from '../db';
import { seedDefaultChartOfAccounts } from '../ledger/coa-seed';

dotenv.config();

/**
 * Idempotently seeds the default Chart of Accounts across all existing pharmacies.
 */
export async function seedChartOfAccountsForAllPharmacies(
  customDb?: NodePgDatabase<typeof schema>
): Promise<Array<{ pharmacyId: string; pharmacyName: string; accountCount: number }>> {
  const db = customDb || getDb();
  const allPharmacies = await db
    .select()
    .from(pharmacies)
    .orderBy(asc(pharmacies.createdAt));

  const results: Array<{ pharmacyId: string; pharmacyName: string; accountCount: number }> = [];

  for (const pharmacy of allPharmacies) {
    const accountsList = await db.transaction((tx) =>
      seedDefaultChartOfAccounts(tx, pharmacy.id)
    );
    results.push({
      pharmacyId: pharmacy.id,
      pharmacyName: pharmacy.name,
      accountCount: accountsList.length,
    });
  }

  return results;
}

async function main() {
  try {
    console.log('[SeedCOA] Seeding default Chart of Accounts for existing pharmacies...');
    const results = await seedChartOfAccountsForAllPharmacies();
    for (const r of results) {
      console.log(`  ✔ ${r.pharmacyName} (${r.pharmacyId}): ${r.accountCount} accounts active`);
    }
    console.log('[SeedCOA] Completed cleanly.');
  } catch (error) {
    console.error('[SeedCOA] Failed to seed Chart of Accounts:', error);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('seed-coa.ts')) {
  main();
}

