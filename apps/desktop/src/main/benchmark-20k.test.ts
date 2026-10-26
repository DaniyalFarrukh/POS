import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import Database from 'better-sqlite3';
import { MIGRATIONS } from './db';

describe('Performance Benchmark with 20,000 Products (Low-End PC Profile)', () => {
  let tempDir: string;
  let dbPath: string;
  let rawDb: InstanceType<typeof Database>;

  const TOTAL_PRODUCTS = 20000;
  const sampleBarcodes: string[] = [];

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-benchmark-20k-'));
    dbPath = path.join(tempDir, 'pos-benchmark.db');

    // Initialize raw SQLite with WAL mode on disk
    rawDb = new Database(dbPath);
    rawDb.pragma('journal_mode = WAL');
    rawDb.pragma('synchronous = NORMAL');
    rawDb.pragma('foreign_keys = ON');

    // Run migrations
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    for (const migration of MIGRATIONS) {
      migration.up(rawDb);
      rawDb
        .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, new Date().toISOString());
    }

    // Insert Default Tax Category
    rawDb
      .prepare(
        `INSERT INTO tax_categories (id, name, rate_bp, is_exempt, created_at, updated_at)
         VALUES ('tax-std', 'Standard 18%', 1800, 0, datetime('now'), datetime('now'))`
      )
      .run();

    // Seed 20,000 realistic pharmacy products in a single transaction
    const insertStmt = rawDb.prepare(`
      INSERT INTO products (
        id, brand_name, generic_name, form, strength, manufacturer,
        barcode, mrp_paisa, is_controlled, is_active, tax_category_id,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, 1, 'tax-std',
        datetime('now'), datetime('now')
      )
    `);

    const brands = [
      'Panadol', 'Brufen', 'Augmentin', 'Disprin', 'Arinac', 'Risek', 'Softin',
      'Gravinate', 'Ponstan', 'Flagyl', 'Ciproxin', 'Surbex-Z', 'Calpol', 'Loprin',
      'Nuberol Forte', 'Zyrtec', 'Tegral', 'Lipiget', 'Xanax', 'Lexotanil'
    ];
    const forms = ['Tablet', 'Syrup', 'Capsule', 'Injection', 'Suspension', 'Ointment'];
    const strengths = ['250mg', '500mg', '400mg', '10mg', '20mg', '1g', '625mg'];
    const generics = [
      'Paracetamol', 'Ibuprofen', 'Amoxicillin + Clavulanate', 'Aspirin',
      'Omeprazole', 'Loratadine', 'Dimenhydrinate', 'Mefenamic Acid',
      'Metronidazole', 'Ciprofloxacin', 'Atorvastatin', 'Alprazolam'
    ];

    const seedStart = performance.now();
    const seedTx = rawDb.transaction(() => {
      for (let i = 1; i <= TOTAL_PRODUCTS; i++) {
        const id = `prod-bench-${String(i).padStart(6, '0')}`;
        const brand = `${brands[i % brands.length]} ${i}`;
        const generic = generics[i % generics.length];
        const form = forms[i % forms.length];
        const strength = strengths[i % strengths.length];
        const barcode = `890${String(i).padStart(10, '0')}`;
        const mrpPaisa = 1000 + (i % 500) * 100;
        const isControlled = i % 50 === 0 ? 1 : 0;

        if (i % 400 === 0) {
          sampleBarcodes.push(barcode);
        }

        insertStmt.run(id, brand, generic, form, strength, 'GSK / Abbott Pharma', barcode, mrpPaisa, isControlled);
      }
    });

    seedTx();
    const seedDurationMs = performance.now() - seedStart;
    const dbStats = fs.statSync(dbPath);

    console.log(`\n======================================================`);
    console.log(`[Benchmark 20k] Database Seeding Complete`);
    console.log(`- Total Products Seeded: ${TOTAL_PRODUCTS}`);
    console.log(`- Ingestion Time: ${seedDurationMs.toFixed(2)} ms`);
    console.log(`- Database File Size: ${(dbStats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`======================================================\n`);
  });

  afterAll(() => {
    try {
      rawDb.close();
    } catch {
      // Ignore database close error
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore directory cleanup error
    }
  });

  it('measures database reconnection and PRAGMA integrity_check startup latency', () => {
    const startupStart = performance.now();
    const testDb = new Database(dbPath, { readonly: true });
    const integrityRes = testDb.pragma('integrity_check', { simple: true }) as string;
    const countRes = (testDb.prepare('SELECT COUNT(*) as cnt FROM products').get() as { cnt: number }).cnt;
    const startupDurationMs = performance.now() - startupStart;
    testDb.close();

    console.log(`[Benchmark 20k Startup & Integrity]`);
    console.log(`- Integrity Check Result: ${integrityRes}`);
    console.log(`- Verified Product Count: ${countRes}`);
    console.log(`- Startup & Full Integrity Duration: ${startupDurationMs.toFixed(2)} ms`);

    expect(integrityRes).toBe('ok');
    expect(countRes).toBe(TOTAL_PRODUCTS);
    // Even with PRAGMA integrity_check over 20,000 rows, should complete under 1000ms
    expect(startupDurationMs).toBeLessThan(1000);
  });

  it('measures exact barcode search latency (<15ms budget)', () => {
    const barcodeStmt = rawDb.prepare(`
      SELECT id, brand_name, generic_name, form, strength, barcode, mrp_paisa
      FROM products
      WHERE barcode = ?
      LIMIT 1
    `);

    const latencies: number[] = [];

    // Run 50 barcode search iterations
    for (const barcode of sampleBarcodes) {
      const start = performance.now();
      const row = barcodeStmt.get(barcode);
      const duration = performance.now() - start;
      latencies.push(duration);
      expect(row).toBeDefined();
    }

    latencies.sort((a, b) => a - b);
    const avg = latencies.reduce((sum, v) => sum + v, 0) / latencies.length;
    const median = latencies[Math.floor(latencies.length / 2)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];

    console.log(`[Benchmark 20k Exact Barcode Lookup] (Sample Size: ${latencies.length})`);
    console.log(`- Average Latency: ${avg.toFixed(3)} ms`);
    console.log(`- Median Latency: ${(median ?? 0).toFixed(3)} ms`);
    console.log(`- 95th Percentile: ${(p95 ?? 0).toFixed(3)} ms`);
    console.log(`- Max Latency: ${(latencies[latencies.length - 1] ?? 0).toFixed(3)} ms`);

    // Exact barcode lookups are indexed via unique barcode index: must be very fast (<15ms)
    expect(p95 ?? 0).toBeLessThan(15);
  });

  it('measures brand name prefix search latency (<25ms budget)', () => {
    const prefixStmt = rawDb.prepare(`
      SELECT id, brand_name, generic_name, form, strength, barcode, mrp_paisa
      FROM products
      WHERE brand_name LIKE ?
      LIMIT 25
    `);

    const prefixes = ['Panad%', 'Bruf%', 'Augm%', 'Dispr%', 'Ponst%', 'Grav%', 'Soft%'];
    const latencies: number[] = [];

    for (let i = 0; i < 50; i++) {
      const q = prefixes[i % prefixes.length];
      const start = performance.now();
      const rows = prefixStmt.all(q);
      const duration = performance.now() - start;
      latencies.push(duration);
      expect(rows.length).toBeGreaterThan(0);
    }

    latencies.sort((a, b) => a - b);
    const avg = latencies.reduce((sum, v) => sum + v, 0) / latencies.length;
    const median = latencies[Math.floor(latencies.length / 2)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];

    console.log(`[Benchmark 20k Brand Prefix Search] (Sample Size: ${latencies.length})`);
    console.log(`- Average Latency: ${avg.toFixed(3)} ms`);
    console.log(`- Median Latency: ${(median ?? 0).toFixed(3)} ms`);
    console.log(`- 95th Percentile: ${(p95 ?? 0).toFixed(3)} ms`);

    expect(p95 ?? 0).toBeLessThan(25);
  });

  it('measures generic name substring search latency (<50ms budget)', () => {
    const substringStmt = rawDb.prepare(`
      SELECT id, brand_name, generic_name, form, strength, barcode, mrp_paisa
      FROM products
      WHERE generic_name LIKE ?
      LIMIT 25
    `);

    const terms = ['%paracetamol%', '%ibuprofen%', '%amoxicillin%', '%aspirin%', '%omeprazole%'];
    const latencies: number[] = [];

    for (let i = 0; i < 50; i++) {
      const q = terms[i % terms.length];
      const start = performance.now();
      const rows = substringStmt.all(q);
      const duration = performance.now() - start;
      latencies.push(duration);
      expect(rows.length).toBeGreaterThan(0);
    }

    latencies.sort((a, b) => a - b);
    const avg = latencies.reduce((sum, v) => sum + v, 0) / latencies.length;
    const median = latencies[Math.floor(latencies.length / 2)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];

    console.log(`[Benchmark 20k Generic Substring Search] (Sample Size: ${latencies.length})`);
    console.log(`- Average Latency: ${avg.toFixed(3)} ms`);
    console.log(`- Median Latency: ${(median ?? 0).toFixed(3)} ms`);
    console.log(`- 95th Percentile: ${(p95 ?? 0).toFixed(3)} ms`);

    expect(p95 ?? 0).toBeLessThan(50);
  });
});
