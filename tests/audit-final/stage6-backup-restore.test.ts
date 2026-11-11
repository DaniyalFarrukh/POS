import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { generateUuidV7, type SyncEventEnvelope } from '../../packages/shared/src/index';
import {
  initDatabase,
  closeDatabase,
  getDatabase,
  getDbMetadata,
} from '../../apps/desktop/src/main/db';
import {
  createDatabaseBackup,
  restoreDatabaseBackup,
  enforceBackupRetention,
  listDatabaseBackups,
} from '../../apps/desktop/src/main/backup';
import { finalizeSale } from '../../apps/desktop/src/main/finalizeSale';
import { processReturn } from '../../apps/desktop/src/main/returns';
import { openShift, closeShift } from '../../apps/desktop/src/main/shifts';
import { adjustStock, receiveGrn } from '../../apps/desktop/src/main/purchasing';
import {
  createTestContext,
  isPostgresReachable,
  type TestDatabaseContext,
} from '../../apps/server/src/db/test-helper';
import * as serverSchema from '../../apps/server/src/db/schema';
import { seedDefaultAccountMappings } from '../../apps/server/src/ledger/coa-seed';
import { processSyncPushEvents } from '../../apps/server/src/sync/service';

describe('Stage 6 — Backup/Restore End-to-End & Operational Verification', () => {
  let tmpRoot: string;
  let ctx: TestDatabaseContext;

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-stage6-backup-'));
    const reachable = await isPostgresReachable();
    expect(reachable).toBe(true);
    ctx = await createTestContext();
  });

  afterAll(async () => {
    closeDatabase();
    if (ctx) {
      await ctx.cleanup();
    }
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup lock on Windows
    }
  });

  it('6.1 Populates counter DB (products, batches, GRN, sales, returns, adjustments, shifts, outbox), backs up during active writes, and restores cleanly into a new directory', async () => {
    const sourceDir = path.join(tmpRoot, 'counter-source');
    const backupDir = path.join(tmpRoot, 'backups');
    const restoreDir = path.join(tmpRoot, 'counter-restored');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(backupDir, { recursive: true });
    fs.mkdirSync(restoreDir, { recursive: true });

    const sourceDbPath = path.join(sourceDir, 'pos_counter.db');
    initDatabase(sourceDbPath);
    const db = getDatabase();

    const now = '2026-08-15T10:00:00.000Z';
    const branchId = generateUuidV7();
    const counterId = generateUuidV7();
    const ownerId = generateUuidV7();
    const supplierId = generateUuidV7();
    const taxCategoryId = generateUuidV7();
    const productId = generateUuidV7();

    db.prepare(`INSERT INTO branches (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(
      branchId,
      'Main Branch',
      now,
      now
    );
    db.prepare(
      `INSERT INTO counters (id, branch_id, name, code, last_invoice_seq, last_credit_note_seq, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 0, ?, ?)`
    ).run(counterId, branchId, 'Counter 1', 'C1', now, now);
    db.prepare(
      `INSERT INTO users (id, name, role, pin_hash, is_active, created_at, updated_at)
       VALUES (?, ?, 'owner', ?, 1, ?, ?)`
    ).run(
      ownerId,
      'Owner User',
      '$2b$10$dummyhash000000000000000000000000000000000000000',
      now,
      now
    );
    db.prepare(
      `INSERT INTO suppliers (id, name, phone, address, is_active, created_at, updated_at)
       VALUES (?, ?, '03001234567', 'Karachi', 1, ?, ?)`
    ).run(supplierId, 'Prime Pharma', now, now);
    db.prepare(
      `INSERT INTO tax_categories (id, name, rate_bp, is_exempt, created_at, updated_at)
       VALUES (?, 'Zero Rated', 0, 0, ?, ?)`
    ).run(taxCategoryId, now, now);
    db.prepare(
      `INSERT INTO products (id, brand_name, generic_name, strength, form, manufacturer, barcode, tax_category_id, mrp_paisa, is_controlled, is_active, created_at, updated_at)
       VALUES (?, 'Cefspan 400mg', 'Cefixime', '400mg', 'Capsule', 'AGP', '8964002345678', ?, 50000, 0, 1, ?, ?)`
    ).run(productId, taxCategoryId, now, now);

    // 1. Receive GRN (creates batch, stock_movement, and outbox event)
    const grn = receiveGrn({
      supplierId,
      supplierInvoiceNo: 'SUP-INV-100',
      invoiceDate: '2026-08-15',
      lines: [
        {
          productId,
          batchNo: 'BATCH-S6-01',
          expiryDate: '2028-12-31',
          quantity: 100,
          costPaisa: 35000,
          mrpPaisa: 50000,
        },
      ],
    });
    expect(grn.lines.length).toBe(1);
    const batchId = grn.lines[0]!.batchId;

    // 2. Open shift
    const shift = openShift({
      counterId,
      userId: ownerId,
      openingCashPaisa: 100_000,
      notes: 'Morning Shift',
    });

    // 3. Finalize 3 sales
    const sale1 = finalizeSale({
      clientRequestId: generateUuidV7(),
      counterId,
      cashierUserId: ownerId,
      lines: [{ productId, quantity: 4, discountPaisa: 0 }],
      payments: [{ method: 'cash', amountPaisa: 200_000 }],
    });
    const sale2 = finalizeSale({
      clientRequestId: generateUuidV7(),
      counterId,
      cashierUserId: ownerId,
      lines: [{ productId, quantity: 2, discountPaisa: 0 }],
      payments: [{ method: 'cash', amountPaisa: 100_000 }],
    });
    const sale3 = finalizeSale({
      clientRequestId: generateUuidV7(),
      counterId,
      cashierUserId: ownerId,
      lines: [{ productId, quantity: 3, discountPaisa: 0 }],
      payments: [{ method: 'cash', amountPaisa: 150_000 }],
    });
    expect(sale2.invoiceNumber).toBe('C1-000002');
    expect(sale3.invoiceNumber).toBe('C1-000003');

    // 4. Process a return against sale1
    const invoiceLines = db
      .prepare(`SELECT id FROM invoice_lines WHERE invoice_id = ?`)
      .all(sale1.id) as { id: string }[];
    const creditNote = processReturn(
      {
        clientRequestId: generateUuidV7(),
        originalInvoiceId: sale1.id,
        reason: 'customer_return',
        refundMethod: 'cash',
        lines: [
          {
            invoiceLineId: invoiceLines[0]!.id,
            quantity: 1,
          },
        ],
      },
      { db, counterId, cashierUserId: ownerId, branchId }
    );
    expect(creditNote.creditNoteNumber).toBe('CN-C1-000001');

    // 5. Stock adjustment (-2 damaged)
    adjustStock({
      productId,
      batchId,
      quantitySigned: -2,
      reasonType: 'damage',
      reason: 'Crushed pack',
    });

    // 6. Close shift
    closeShift({
      shiftId: shift.id,
      countedCashPaisa: 500_000,
      notes: 'Shift closed',
    });

    // Record pre-backup counts (before concurrent write)
    const backupPromise = createDatabaseBackup({ db, backupDir });
    // Trigger a concurrent write right after initiating backup
    finalizeSale({
      clientRequestId: generateUuidV7(),
      counterId,
      cashierUserId: ownerId,
      lines: [{ productId, quantity: 1, discountPaisa: 0 }],
      payments: [{ method: 'cash', amountPaisa: 50_000 }],
    });
    const backupInfo = await backupPromise;
    expect(fs.existsSync(backupInfo.filePath)).toBe(true);
    expect(backupInfo.sizeBytes).toBeGreaterThan(0);

    // 7. Restore into a brand-new user-data directory
    closeDatabase();
    const restoredDbPath = path.join(restoreDir, 'pos_counter.db');
    initDatabase(restoredDbPath); // Empty target DB first
    const restoreRes = await restoreDatabaseBackup(backupInfo.filename, 'owner', {
      customDir: backupDir,
      targetDbPath: restoredDbPath,
      shouldRelaunch: false,
    });
    expect(restoreRes.success).toBe(true);
    expect(restoreRes.safetyBackupFile).toBeDefined();

    const restoredDb = getDatabase();
    const integrity = restoredDb.pragma('integrity_check', { simple: true }) as string;
    expect(integrity).toBe('ok');

    // Verify restored data consistency (contains at least the 3 sales committed before backup)
    const invCount = (
      restoredDb.prepare(`SELECT COUNT(*) as cnt FROM invoices`).get() as { cnt: number }
    ).cnt;
    expect(invCount).toBeGreaterThanOrEqual(3);

    const cnCount = (
      restoredDb.prepare(`SELECT COUNT(*) as cnt FROM credit_notes`).get() as { cnt: number }
    ).cnt;
    expect(cnCount).toBe(1);

    const outboxCount = (
      restoredDb.prepare(`SELECT COUNT(*) as cnt FROM outbox WHERE status = 'pending'`).get() as {
        cnt: number;
      }
    ).cnt;
    expect(outboxCount).toBeGreaterThanOrEqual(7); // GRN + shift open + 3 sales + return + adjustment + shift close

    // Verify next sale continues invoice sequence without collision
    const counterSeqBefore = (
      restoredDb.prepare(`SELECT last_invoice_seq FROM counters WHERE id = ?`).get(counterId) as {
        last_invoice_seq: number;
      }
    ).last_invoice_seq;
    const nextSale = finalizeSale({
      clientRequestId: generateUuidV7(),
      counterId,
      cashierUserId: ownerId,
      lines: [{ productId, quantity: 1, discountPaisa: 0 }],
      payments: [{ method: 'cash', amountPaisa: 50_000 }],
    });
    expect(nextSale.invoiceNumber).toBe(`C1-${String(counterSeqBefore + 1).padStart(6, '0')}`);
  });

  it('6.2 Rejects corrupted backup file during restore and rejects non-owner restore; reproduces missing schema_migrations check and post-restore server sequence collision (F-M-09)', async () => {
    const testDir = path.join(tmpRoot, 'corruption-and-collision');
    const backupDir = path.join(testDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    const activeDbPath = path.join(testDir, 'active.db');
    closeDatabase();
    initDatabase(activeDbPath);
    const db = getDatabase();

    // 1. Non-owner restore rejection
    await expect(
      restoreDatabaseBackup('any.db', 'cashier', {
        customDir: backupDir,
        targetDbPath: activeDbPath,
        shouldRelaunch: false,
      })
    ).rejects.toThrow(/strictly restricted to the Owner role/);

    // 2. Corrupted backup file rejection
    const corruptFilename = 'backup-corrupt.db';
    fs.writeFileSync(
      path.join(backupDir, corruptFilename),
      Buffer.from('NOT A VALID SQLITE FILE HEADER 000000000000000000000000')
    );

    await expect(
      restoreDatabaseBackup(corruptFilename, 'owner', {
        customDir: backupDir,
        targetDbPath: activeDbPath,
        shouldRelaunch: false,
      })
    ).rejects.toThrow();

    // Active DB remains intact
    expect(getDatabase().pragma('integrity_check', { simple: true })).toBe('ok');

    // 3. Reproduce F-M-09 (a): Backup with a newer schema_migrations version (e.g. 999) is NOT rejected by restoreDatabaseBackup
    const futureBackupInfo = await createDatabaseBackup({ db, backupDir });
    closeDatabase();
    initDatabase(futureBackupInfo.filePath);
    const futureDb = getDatabase();
    futureDb
      .prepare(
        `INSERT INTO schema_migrations (version, name, applied_at) VALUES (999, '0999_future', ?)`
      )
      .run(new Date().toISOString());
    futureDb
      .prepare(`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '999')`)
      .run();
    futureDb.pragma('wal_checkpoint(TRUNCATE)');
    closeDatabase();

    initDatabase(activeDbPath);
    const futureRestoreRes = await restoreDatabaseBackup(futureBackupInfo.filename, 'owner', {
      customDir: backupDir,
      targetDbPath: activeDbPath,
      shouldRelaunch: false,
    });
    expect(futureRestoreRes.success).toBe(true);
    expect(getDbMetadata().schemaVersion).toBe(999);

    // 4. Reproduce F-M-09 (b): Restoring a backup taken at seq=1 after seq=2 was already pushed to server causes invoiceNumber collision on next sale
    closeDatabase();
    const seqDbPath = path.join(testDir, 'seq-collision.db');
    initDatabase(seqDbPath);
    const seqDb = getDatabase();
    const now = '2026-08-16T10:00:00.000Z';
    const pharmacyId = generateUuidV7();
    const branchId = generateUuidV7();
    const counterId = generateUuidV7();
    const userId = generateUuidV7();
    const deviceId = generateUuidV7();
    const taxCategoryId = generateUuidV7();
    const productId = generateUuidV7();
    const batchId = generateUuidV7();

    await ctx.db.insert(serverSchema.pharmacies).values({
      id: pharmacyId,
      name: 'Stage 6 Pharmacy',
      code: 'PH-S6',
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(serverSchema.branches).values({
      id: branchId,
      pharmacyId,
      name: 'B1',
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(serverSchema.counters).values({
      id: counterId,
      pharmacyId,
      branchId,
      name: 'C1',
      code: 'C1',
      lastInvoiceSeq: 0,
      lastCreditNoteSeq: 0,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(serverSchema.users).values({
      id: userId,
      pharmacyId,
      name: 'Owner',
      role: 'owner',
      pinHash: '$2b$10$dummyhash000000000000000000000000000000000000000',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(serverSchema.devices).values({
      id: deviceId,
      pharmacyId,
      branchId,
      counterId,
      deviceName: 'Device 1',
      deviceFingerprint: 'fp-s6',
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(serverSchema.taxCategories).values({
      id: taxCategoryId,
      pharmacyId,
      name: 'Zero',
      rateBp: 0,
      isExempt: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(serverSchema.products).values({
      id: productId,
      pharmacyId,
      brandName: 'Drug A',
      genericName: 'Drug',
      strength: '10mg',
      form: 'Tab',
      manufacturer: 'Lab',
      barcode: '8964009999991',
      taxCategoryId,
      mrpPaisa: 10000,
      isControlled: false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(serverSchema.batches).values({
      id: batchId,
      pharmacyId,
      productId,
      batchNo: 'B-COLLIDE',
      expiryDate: '2028-12-31',
      costPaisa: 6000,
      mrpPaisa: 10000,
      createdAt: now,
      updatedAt: now,
    });
    await seedDefaultAccountMappings(ctx.db, pharmacyId);

    seqDb
      .prepare(`INSERT INTO branches (id, name, created_at, updated_at) VALUES (?, 'B1', ?, ?)`)
      .run(branchId, now, now);
    seqDb
      .prepare(
        `INSERT INTO counters (id, branch_id, name, code, last_invoice_seq, last_credit_note_seq, created_at, updated_at)
         VALUES (?, ?, 'C1', 'C1', 0, 0, ?, ?)`
      )
      .run(counterId, branchId, now, now);
    seqDb
      .prepare(
        `INSERT INTO users (id, name, role, pin_hash, is_active, created_at, updated_at)
         VALUES (?, 'Owner', 'owner', 'hash', 1, ?, ?)`
      )
      .run(userId, now, now);
    seqDb
      .prepare(
        `INSERT INTO tax_categories (id, name, rate_bp, is_exempt, created_at, updated_at)
         VALUES (?, 'Zero', 0, 0, ?, ?)`
      )
      .run(taxCategoryId, now, now);
    seqDb
      .prepare(
        `INSERT INTO products (id, brand_name, generic_name, strength, form, manufacturer, barcode, tax_category_id, mrp_paisa, is_controlled, is_active, created_at, updated_at)
         VALUES (?, 'Drug A', 'Drug', '10mg', 'Tab', 'Lab', '8964009999991', ?, 10000, 0, 1, ?, ?)`
      )
      .run(productId, taxCategoryId, now, now);
    seqDb
      .prepare(
        `INSERT INTO batches (id, product_id, batch_no, expiry_date, cost_paisa, mrp_paisa, created_at, updated_at)
         VALUES (?, ?, 'B-COLLIDE', '2028-12-31', 6000, 10000, ?, ?)`
      )
      .run(batchId, productId, now, now);
    seqDb
      .prepare(
        `INSERT INTO stock_movements (id, product_id, batch_id, branch_id, type, quantity_signed, reference_type, reference_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'purchase', 50, 'grn', ?, ?, ?)`
      )
      .run(generateUuidV7(), productId, batchId, branchId, generateUuidV7(), now, now);

    // Sale #1 -> C1-000001
    finalizeSale({
      clientRequestId: generateUuidV7(),
      counterId,
      cashierUserId: userId,
      lines: [{ productId, quantity: 1, discountPaisa: 0 }],
      payments: [{ method: 'cash', amountPaisa: 10000 }],
    });

    // Take backup at last_invoice_seq = 1
    const snapAt1 = await createDatabaseBackup({ db: seqDb, backupDir });

    // Sale #2 -> C1-000002 (created and synced to server BEFORE restore)
    finalizeSale({
      clientRequestId: generateUuidV7(),
      counterId,
      cashierUserId: userId,
      lines: [{ productId, quantity: 1, discountPaisa: 0 }],
      payments: [{ method: 'cash', amountPaisa: 10000 }],
    });

    const outboxBeforeRestore = seqDb
      .prepare(`SELECT * FROM outbox ORDER BY device_seq ASC`)
      .all() as {
      event_id: string;
      device_seq: number;
      type: string;
      event_type: string;
      entity_id: string;
      payload: string;
      occurred_at: string;
      created_at: string;
    }[];

    const pushBeforeRestore = await processSyncPushEvents(
      ctx.db,
      { pharmacyId, deviceId, branchId },
      outboxBeforeRestore.map((r) => ({
        eventId: r.event_id,
        deviceId,
        deviceSeq: r.device_seq,
        type: (r.type || r.event_type) as SyncEventEnvelope['type'],
        entityId: r.entity_id || r.event_id,
        payload: JSON.parse(r.payload),
        occurredAt: r.occurred_at || r.created_at,
        schemaVersion: 1,
      }))
    );
    expect(pushBeforeRestore.every((r) => r.status === 'accepted')).toBe(true);

    // Now restore the backup taken at seq=1 and create a new sale -> generates a DIFFERENT invoice id with invoiceNumber = 'C1-000002'!
    await restoreDatabaseBackup(snapAt1.filename, 'owner', {
      customDir: backupDir,
      targetDbPath: seqDbPath,
      shouldRelaunch: false,
    });
    const restoredSeqDb = getDatabase();
    const collidingSale = finalizeSale({
      clientRequestId: generateUuidV7(),
      counterId,
      cashierUserId: userId,
      lines: [{ productId, quantity: 1, discountPaisa: 0 }],
      payments: [{ method: 'cash', amountPaisa: 10000 }],
    });
    expect(collidingSale.invoiceNumber).toBe('C1-000002');

    const collidingRow = restoredSeqDb
      .prepare(`SELECT * FROM outbox WHERE device_seq = 2`)
      .get() as {
      event_id: string;
      device_seq: number;
      type: string;
      event_type: string;
      entity_id: string;
      payload: string;
      occurred_at: string;
      created_at: string;
    };

    const pushAfterRestore = await processSyncPushEvents(
      ctx.db,
      { pharmacyId, deviceId, branchId },
      [
        {
          eventId: collidingRow.event_id,
          deviceId,
          deviceSeq: collidingRow.device_seq,
          type: (collidingRow.type || collidingRow.event_type) as SyncEventEnvelope['type'],
          entityId: collidingRow.entity_id || collidingRow.event_id,
          payload: JSON.parse(collidingRow.payload),
          occurredAt: collidingRow.occurred_at || collidingRow.created_at,
          schemaVersion: 1,
        },
      ]
    );
    // Reproduces F-M-09: Server fails with 23505 unique constraint on (pharmacy_id, invoice_number) and permanently rejects the post-restore sale!
    expect(pushAfterRestore[0]?.status).toBe('rejected');
    expect(pushAfterRestore[0]?.code).toBe('INTERNAL_ERROR');

    // 5. Verify 14-backup retention policy
    const retentionDir = path.join(testDir, 'retention');
    fs.mkdirSync(retentionDir, { recursive: true });
    for (let i = 1; i <= 16; i++) {
      const f = path.join(retentionDir, `backup-2026-08-${String(i).padStart(2, '0')}-120000.db`);
      fs.writeFileSync(f, `dummy-${i}`);
      const mtime = new Date(Date.UTC(2026, 7, i, 12, 0, 0));
      fs.utimesSync(f, mtime, mtime);
    }
    enforceBackupRetention(retentionDir, 14);
    const remaining = listDatabaseBackups(retentionDir);
    expect(remaining.length).toBe(14);
  });
});
