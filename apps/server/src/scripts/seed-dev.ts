import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { eq, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { generateUuidV7 } from '@pos/shared';
import * as schema from '../db/schema';
import { pharmacies, branches, counters, users, deviceRegistrationCodes } from '../db/schema';
import { getDb, closePool } from '../db';
import { generatePlainRegistrationCode, hashRegistrationCode } from '../auth/jwt';

dotenv.config();

export interface SeedResult {
  pharmacy: typeof pharmacies.$inferSelect;
  branch: typeof branches.$inferSelect;
  counter: typeof counters.$inferSelect;
  owner: typeof users.$inferSelect;
  registrationCode: {
    id: string;
    plainCode: string;
    codeHash: string;
    expiresAt: string;
  };
}

/**
 * Creates/retrieves development tenant, branch, counter, owner user,
 * and generates a single-use hashed device registration code.
 */
export async function seedDevEnvironment(db: NodePgDatabase<typeof schema>): Promise<SeedResult> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run seedDevEnvironment in production');
  }

  const now = new Date().toISOString();

  // 1. Get or create Dev Pharmacy
  const existingPharmacies = await db
    .select()
    .from(pharmacies)
    .where(eq(pharmacies.name, 'Apex Health Pharmacy (Dev)'))
    .limit(1);

  let pharmacy = existingPharmacies[0];
  if (!pharmacy) {
    const pharmacyId = generateUuidV7();
    const inserted = await db
      .insert(pharmacies)
      .values({
        id: pharmacyId,
        name: 'Apex Health Pharmacy (Dev)',
        code: 'DEV',
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    pharmacy = inserted[0]!;
  } else if (!pharmacy.code) {
    const [updated] = await db
      .update(pharmacies)
      .set({ code: 'DEV', updatedAt: now })
      .where(eq(pharmacies.id, pharmacy.id))
      .returning();
    pharmacy = updated!;
  }

  // 2. Get or create Dev Branch
  const existingBranches = await db
    .select()
    .from(branches)
    .where(and(eq(branches.pharmacyId, pharmacy.id), eq(branches.name, 'Main Branch')))
    .limit(1);

  let branch = existingBranches[0];
  if (!branch) {
    const branchId = generateUuidV7();
    const inserted = await db
      .insert(branches)
      .values({
        id: branchId,
        pharmacyId: pharmacy.id,
        name: 'Main Branch',
        address: 'Clifton Block 2, Karachi',
        phone: '+92-21-35800000',
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    branch = inserted[0]!;
  }

  // 3. Get or create Dev Counter
  const existingCounters = await db
    .select()
    .from(counters)
    .where(
      and(
        eq(counters.pharmacyId, pharmacy.id),
        eq(counters.branchId, branch.id),
        eq(counters.name, 'Counter 1')
      )
    )
    .limit(1);

  let counter = existingCounters[0];
  if (!counter) {
    const counterId = generateUuidV7();
    const inserted = await db
      .insert(counters)
      .values({
        id: counterId,
        pharmacyId: pharmacy.id,
        branchId: branch.id,
        name: 'Counter 1',
        code: 'C1',
        lastInvoiceSeq: 0,
        lastCreditNoteSeq: 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    counter = inserted[0]!;
  }

  // 4. Get or create Owner User
  const existingOwners = await db
    .select()
    .from(users)
    .where(and(eq(users.pharmacyId, pharmacy.id), eq(users.role, 'owner')))
    .limit(1);

  let owner = existingOwners[0];
  if (!owner) {
    const ownerId = generateUuidV7();
    const pinHash = await bcrypt.hash('12345678', 10);
    const inserted = await db
      .insert(users)
      .values({
        id: ownerId,
        pharmacyId: pharmacy.id,
        name: 'Dev Pharmacy Owner',
        role: 'owner',
        pinHash,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    owner = inserted[0]!;
  } else if (!owner.pinHash.startsWith('$2')) {
    const pinHash = await bcrypt.hash('12345678', 10);
    const [updated] = await db
      .update(users)
      .set({ pinHash, updatedAt: now })
      .where(eq(users.id, owner.id))
      .returning();
    owner = updated!;
  }

  // 5. Generate a fresh one-time device registration code
  const plainCode = generatePlainRegistrationCode();
  const codeHash = hashRegistrationCode(plainCode);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h expiry
  const codeId = generateUuidV7();

  await db.insert(deviceRegistrationCodes).values({
    id: codeId,
    pharmacyId: pharmacy.id,
    branchId: branch.id,
    counterId: counter.id,
    codeHash,
    expiresAt,
    usedAt: null,
    createdAt: now,
  });

  return {
    pharmacy,
    branch,
    counter,
    owner,
    registrationCode: {
      id: codeId,
      plainCode,
      codeHash,
      expiresAt,
    },
  };
}

// CLI runner when executed directly
async function main() {
  try {
    const db = getDb();
    console.log('Seeding development pharmacy, branch, counter, owner...');
    const result = await seedDevEnvironment(db);

    console.log('\n==================================================');
    console.log('✅ Development Seed & Registration Code Generated');
    console.log('==================================================');
    console.log(`Pharmacy:  ${result.pharmacy.name}`);
    console.log(`           ID: ${result.pharmacy.id}`);
    console.log(`Branch:    ${result.branch.name}`);
    console.log(`           ID: ${result.branch.id}`);
    console.log(`Counter:   ${result.counter.name} (${result.counter.code})`);
    console.log(`           ID: ${result.counter.id}`);
    console.log(`Owner:     ${result.owner.name} (Role: ${result.owner.role}, Default PIN: 1234)`);
    console.log(`           ID: ${result.owner.id}`);
    console.log('\n🔑 ONE-TIME DEVICE REGISTRATION CODE:');
    console.log('--------------------------------------------------');
    console.log(`Plain Code: ${result.registrationCode.plainCode}`);
    console.log(`Expires At: ${result.registrationCode.expiresAt}`);
    console.log(`Code Hash:  ${result.registrationCode.codeHash} (Stored in DB)`);
    console.log('--------------------------------------------------');
    console.log('Register a device terminal via:');
    console.log(`curl -X POST http://localhost:3001/devices/register \\`);
    console.log(`  -H "Content-Type: application/json" \\`);
    console.log(
      `  -d '{"code":"${result.registrationCode.plainCode}","deviceName":"HexaPharm Counter 1 Terminal"}'`
    );
    console.log('==================================================\n');
  } catch (error) {
    console.error('Failed to run development seed script:', error);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

// Run CLI if script is directly executed
if (process.argv[1]?.replace(/\\/g, '/').endsWith('seed-dev.ts')) {
  main();
}
