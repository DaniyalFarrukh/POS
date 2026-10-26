import dotenv from 'dotenv';
import { eq, and } from 'drizzle-orm';
import { generateUuidV7 } from '@pos/shared';
import { getDb, closePool } from '../db';
import {
  pharmacies,
  taxCategories,
  products,
} from '../db/schema';
import { recordMasterDataChange } from '../sync/change-log';

dotenv.config();

export async function seedProductsDemo() {
  const db = getDb();
  const now = new Date().toISOString();

  console.log('Seeding demo products and writing change_log entries...');

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
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    pharmacy = inserted[0]!;
  }

  // 2. Get or create Tax Category (Standard 0%)
  const existingTax = await db
    .select()
    .from(taxCategories)
    .where(
      and(
        eq(taxCategories.pharmacyId, pharmacy.id),
        eq(taxCategories.name, 'Medicine Exempt 0%')
      )
    )
    .limit(1);

  let taxCategory = existingTax[0];
  if (!taxCategory) {
    const taxCatId = generateUuidV7();
    const inserted = await db
      .insert(taxCategories)
      .values({
        id: taxCatId,
        pharmacyId: pharmacy.id,
        name: 'Medicine Exempt 0%',
        rateBp: 0,
        isExempt: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    taxCategory = inserted[0]!;

    await recordMasterDataChange(db, {
      pharmacyId: pharmacy.id,
      entity: 'tax_category',
      entityId: taxCategory.id,
      op: 'upsert',
      data: taxCategory,
    });
  }

  // 3. Products list to create/upsert
  const demoProducts = [
    {
      brandName: 'Panadol Extra 500mg',
      genericName: 'Paracetamol + Caffeine',
      strength: '500mg/65mg',
      form: 'Tablet',
      manufacturer: 'GSK Pakistan',
      barcode: '8964000123456',
      mrpPaisa: 6500, // 65.00 PKR
    },
    {
      brandName: 'Augmentin 625mg',
      genericName: 'Amoxicillin + Clavulanic Acid',
      strength: '625mg',
      form: 'Tablet',
      manufacturer: 'GSK Pakistan',
      barcode: '8964000654321',
      mrpPaisa: 42000, // 420.00 PKR
    },
    {
      brandName: 'Brufen 400mg',
      genericName: 'Ibuprofen',
      strength: '400mg',
      form: 'Tablet',
      manufacturer: 'Abbott Laboratories',
      barcode: '8964000987654',
      mrpPaisa: 12000, // 120.00 PKR
    },
    {
      brandName: 'Disprin 300mg Soluble',
      genericName: 'Aspirin',
      strength: '300mg',
      form: 'Tablet',
      manufacturer: 'Reckitt Benckiser',
      barcode: '8964000345678',
      mrpPaisa: 3500, // 35.00 PKR
    },
  ];

  console.log(`\nPharmacy: ${pharmacy.name} (${pharmacy.id})`);
  console.log('--------------------------------------------------');

  const createdProducts: Array<{ name: string; id: string; mrpPaisa: number; seq: number }> = [];

  for (const p of demoProducts) {
    const existing = await db
      .select()
      .from(products)
      .where(
        and(
          eq(products.pharmacyId, pharmacy.id),
          eq(products.brandName, p.brandName)
        )
      )
      .limit(1);

    let productId = existing[0]?.id;
    if (!productId) {
      productId = generateUuidV7();
      await db.insert(products).values({
        id: productId,
        pharmacyId: pharmacy.id,
        brandName: p.brandName,
        genericName: p.genericName,
        strength: p.strength,
        form: p.form,
        manufacturer: p.manufacturer,
        barcode: p.barcode,
        taxCategoryId: taxCategory.id,
        mrpPaisa: p.mrpPaisa,
        isControlled: false,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    const seq = await recordMasterDataChange(db, {
      pharmacyId: pharmacy.id,
      entity: 'product',
      entityId: productId,
      op: 'upsert',
      data: {
        id: productId,
        brandName: p.brandName,
        genericName: p.genericName,
        mrpPaisa: p.mrpPaisa,
        taxCategoryId: taxCategory.id,
      },
    });

    createdProducts.push({
      name: p.brandName,
      id: productId,
      mrpPaisa: p.mrpPaisa,
      seq,
    });

    console.log(`+ Product: ${p.brandName} (MRP: ${(p.mrpPaisa / 100).toFixed(2)} PKR) -> change_log seq #${seq}`);
  }

  // 4. Update price on first product (demonstrating price update for pull)
  const productToUpdate = createdProducts[0]!;
  const newPricePaisa = 7200; // 72.00 PKR

  await db
    .update(products)
    .set({
      mrpPaisa: newPricePaisa,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(products.id, productToUpdate.id));

  const updateSeq = await recordMasterDataChange(db, {
    pharmacyId: pharmacy.id,
    entity: 'product',
    entityId: productToUpdate.id,
    op: 'upsert',
    data: {
      id: productToUpdate.id,
      brandName: productToUpdate.name,
      mrpPaisa: newPricePaisa,
      updatedAt: new Date().toISOString(),
    },
  });

  console.log(`\n↻ Price Update: ${productToUpdate.name} MRP updated to ${(newPricePaisa / 100).toFixed(2)} PKR -> change_log seq #${updateSeq}`);
  console.log('--------------------------------------------------');
  console.log('Demonstrate GET /sync/pull:');
  console.log(`curl http://localhost:3001/sync/pull?cursor=0&limit=50 -H "Authorization: Bearer <TOKEN>"`);
  console.log('==================================================\n');

  return { pharmacy, createdProducts, updateSeq };
}

// CLI runner
async function main() {
  try {
    await seedProductsDemo();
  } catch (error) {
    console.error('Failed to seed products:', error);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('seed-products.ts')) {
  main();
}
