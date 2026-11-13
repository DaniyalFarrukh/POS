import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { eq } from 'drizzle-orm';
import { generateUuidV7 } from '@pos/shared';
import {
  pharmacies,
  branches,
  counters,
  users,
  taxCategories,
  deviceRegistrationCodes,
} from '../db/schema';
import { getDb, closePool } from '../db';
import { generatePlainRegistrationCode, hashRegistrationCode } from '../auth/jwt';
import { seedDefaultChartOfAccounts } from '../ledger/coa-seed';

dotenv.config();

export interface ProvisionInput {
  name: string;
  code: string;
  ownerName: string;
  ownerPin?: string;
  branchName?: string;
  counterName?: string;
  address?: string;
  phone?: string;
}

export async function provisionPharmacy(input: ProvisionInput) {
  const db = getDb();
  const now = new Date().toISOString();

  const pharmacyName = input.name.trim();
  const pharmacyCode = input.code.trim().toUpperCase();
  const ownerName = input.ownerName.trim();
  const ownerPin = (input.ownerPin || '12345678').trim();
  const branchName = (input.branchName || 'Main Branch').trim();
  const counterName = (input.counterName || 'Counter 1').trim();
  const address = input.address?.trim() || 'Karachi, Pakistan';
  const phone = input.phone?.trim() || '+92-300-0000000';

  if (!/^\d{8}$/.test(ownerPin)) {
    throw new Error(`Owner PIN must be exactly 8 digits. Received: ${ownerPin}`);
  }

  // 1. Verify code uniqueness
  const existingCode = await db
    .select({ id: pharmacies.id, name: pharmacies.name })
    .from(pharmacies)
    .where(eq(pharmacies.code, pharmacyCode))
    .limit(1);

  if (existingCode.length > 0) {
    throw new Error(
      `Pharmacy Code '${pharmacyCode}' is already in use by '${existingCode[0]!.name}' (ID: ${existingCode[0]!.id}). Please choose a unique code.`
    );
  }

  const pharmacyId = generateUuidV7();
  const branchId = generateUuidV7();
  const counterId = generateUuidV7();
  const ownerId = generateUuidV7();
  const ownerPinHash = await bcrypt.hash(ownerPin, 10);

  // 2. Insert Pharmacy
  const [pharmacy] = await db
    .insert(pharmacies)
    .values({
      id: pharmacyId,
      name: pharmacyName,
      code: pharmacyCode,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  // 3. Seed isolated Chart of Accounts
  await seedDefaultChartOfAccounts(db, pharmacyId);

  // 4. Seed standard Tax Categories
  await db.insert(taxCategories).values([
    {
      id: generateUuidV7(),
      pharmacyId,
      name: 'Standard GST (18%)',
      rateBp: 1800,
      isExempt: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: generateUuidV7(),
      pharmacyId,
      name: 'Exempt Life Saving Drugs',
      rateBp: 0,
      isExempt: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  // 5. Insert First Branch
  const [branch] = await db
    .insert(branches)
    .values({
      id: branchId,
      pharmacyId,
      name: branchName,
      address,
      phone,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  // 6. Insert First Counter Terminal
  const [counter] = await db
    .insert(counters)
    .values({
      id: counterId,
      pharmacyId,
      branchId,
      name: counterName,
      code: 'C1',
      lastInvoiceSeq: 0,
      lastCreditNoteSeq: 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  // 7. Insert Owner User
  const [owner] = await db
    .insert(users)
    .values({
      id: ownerId,
      pharmacyId,
      name: ownerName,
      role: 'owner',
      pinHash: ownerPinHash,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  // 8. Generate One-Time Device Pairing Code (7 days validity)
  const plainCode = generatePlainRegistrationCode();
  const codeHash = hashRegistrationCode(plainCode);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const codeId = generateUuidV7();

  await db.insert(deviceRegistrationCodes).values({
    id: codeId,
    pharmacyId,
    branchId,
    counterId,
    codeHash,
    expiresAt,
    usedAt: null,
    createdAt: now,
  });

  return {
    pharmacy: pharmacy!,
    branch: branch!,
    counter: counter!,
    owner: owner!,
    ownerPlainPin: ownerPin,
    registrationCode: {
      plainCode,
      expiresAt,
    },
  };
}

function parseCliArgs(): ProvisionInput {
  const args = process.argv.slice(2);
  const params: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith('--')) {
      const key = arg.replace(/^--/, '');
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        params[key] = next;
        i++;
      } else {
        params[key] = 'true';
      }
    }
  }

  if (!params.name || !params.code || !params.owner) {
    console.log(`
Usage:
  pnpm --filter @pos/server provision --name "<Pharmacy Name>" --code "<CODE>" --owner "<Owner Name>" [--pin "<8-digit-pin>"] [--branch "<Branch Name>"]

Example:
  pnpm --filter @pos/server provision --name "City Medcare Pharmacy" --code "CITYMED" --owner "Dr. Tariq" --pin "87654321" --branch "Main Branch"
`);
    process.exit(1);
  }

  return {
    name: params.name,
    code: params.code,
    ownerName: params.owner,
    ownerPin: params.pin || '12345678',
    branchName: params.branch || 'Main Branch',
    counterName: params.counter || 'Counter 1',
    address: params.address,
    phone: params.phone,
  };
}

async function main() {
  try {
    const input = parseCliArgs();
    console.log(`\n⏳ Provisioning tenant pharmacy '${input.name}' [${input.code.toUpperCase()}]...`);
    const result = await provisionPharmacy(input);

    console.log('\n======================================================================');
    console.log('🎉 NEW PHARMACY TENANT PROVISIONED SUCCESSFULLY');
    console.log('======================================================================\n');
    console.log(`📋 PHARMACY ENTITY:`);
    console.log(`   Name:               ${result.pharmacy.name}`);
    console.log(`   Pharmacy Code:      ${result.pharmacy.code}`);
    console.log(`   Pharmacy UUID:      ${result.pharmacy.id}`);
    console.log(`\n👤 OWNER CREDENTIALS (pos.hexalogictechandsolutions.com):`);
    console.log(`   Management URL:     https://pos.hexalogictechandsolutions.com`);
    console.log(`   Pharmacy Code:      ${result.pharmacy.code}`);
    console.log(`   Username:           ${result.owner.name}`);
    console.log(`   Owner PIN:          ${result.ownerPlainPin} (8 digits)`);
    console.log(`\n🏢 FIRST STORE BRANCH:`);
    console.log(`   Branch Name:        ${result.branch.name}`);
    console.log(`   Counter:            ${result.counter.name} (${result.counter.code})`);
    console.log(`\n🔑 CLOUD PAIRING CODE (For Counter PC Terminal Setup):`);
    console.log(`   Registration Code:  ${result.registrationCode.plainCode}`);
    console.log(`   Expires At:         ${result.registrationCode.expiresAt}`);
    console.log(`   Server URL:         https://api.hexalogictechandsolutions.com`);
    console.log('\n======================================================================');
    console.log('💡 Give this slip to the client pharmacy owner to log in and pair their PC.');
    console.log('======================================================================\n');
  } catch (err: unknown) {
    console.error('\n❌ Provisioning failed:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

if (process.argv[1]?.includes('provision-pharmacy')) {
  void main();
}
