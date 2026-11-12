import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getKarachiBusinessDate,
  toKarachiBusinessDate,
  getKarachiDayStartUtc,
  getKarachiNextDayStartUtc,
  addDaysToBusinessDate,
  generateUuidV7,
} from '../../packages/shared/src/index';
import { createTestContext, type TestDatabaseContext } from '../../apps/server/src/db/test-helper';
import { pharmacies, branches, counters, users, invoices } from '../../apps/server/src/db/schema';
import { getDashboardOverview, getSalesReport } from '../../apps/server/src/reports/queries';

describe('B2: Date-Sensitive Suites under Mocked Clock (2026-11-11T20:00:00Z = 01:00 PKT Nov 12)', () => {
  let ctx: TestDatabaseContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('proves Karachi business date and day queries are 100% accurate at 01:00 AM PKT when UTC is still yesterday', async () => {
    // Mock system clock to 2026-11-11T20:00:00.000Z (which is 2026-11-12 01:00:00 PKT)
    const mockedNow = new Date('2026-11-11T20:00:00.000Z');

    // 1. UTC slice returns yesterday (wrong)
    // eslint-disable-next-line no-restricted-syntax -- Intentional proof that naive UTC slice returns yesterday while Karachi business date is today
    expect(mockedNow.toISOString().slice(0, 10)).toBe('2026-11-11');

    // 2. getKarachiBusinessDate returns today (correct)
    const today = getKarachiBusinessDate(mockedNow);
    expect(today).toBe('2026-11-12');
    expect(toKarachiBusinessDate(mockedNow)).toBe('2026-11-12');

    // 3. Half-open day boundaries
    const startUtc = getKarachiDayStartUtc(today);
    const nextDayStartUtc = getKarachiNextDayStartUtc(today);

    expect(startUtc).toBe('2026-11-11T19:00:00.000Z');
    expect(nextDayStartUtc).toBe('2026-11-12T19:00:00.000Z');

    // 4. Relative dates
    const expiryIn45Days = addDaysToBusinessDate(today, 45);
    expect(expiryIn45Days).toBe('2026-12-27');

    // 5. Seed an invoice created at this exact night-shift moment (20:00 UTC = 01:00 PKT Nov 12)
    const pharmacyId = generateUuidV7();
    const branchId = generateUuidV7();
    const counterId = generateUuidV7();
    const userId = generateUuidV7();
    const invoiceId = generateUuidV7();

    await ctx.db.insert(pharmacies).values({
      id: pharmacyId,
      name: 'Night Shift Pharmacy',
      code: 'PH-NIGHT',
      createdAt: mockedNow.toISOString(),
      updatedAt: mockedNow.toISOString(),
    });

    await ctx.db.insert(branches).values({
      id: branchId,
      pharmacyId,
      name: 'Main Branch',
      isMain: true,
      createdAt: mockedNow.toISOString(),
      updatedAt: mockedNow.toISOString(),
    });

    await ctx.db.insert(counters).values({
      id: counterId,
      pharmacyId,
      branchId,
      name: 'Counter 1',
      createdAt: mockedNow.toISOString(),
      updatedAt: mockedNow.toISOString(),
    });

    await ctx.db.insert(users).values({
      id: userId,
      pharmacyId,
      name: 'Night Cashier',
      role: 'cashier',
      pinHash: 'dummy',
      createdAt: mockedNow.toISOString(),
      updatedAt: mockedNow.toISOString(),
    });

    await ctx.db.insert(invoices).values({
      id: invoiceId,
      pharmacyId,
      counterId,
      cashierUserId: userId,
      invoiceNumber: 'INV-NIGHT-001',
      clientRequestId: generateUuidV7(),
      status: 'finalized',
      subtotalPaisa: 50000,
      discountPaisa: 0,
      taxPaisa: 0,
      totalPaisa: 50000,
      createdAt: mockedNow.toISOString(),
    });

    // Overview for today ('2026-11-12') must find this invoice
    const overviewToday = await getDashboardOverview(ctx.db, pharmacyId, '2026-11-12');
    expect(overviewToday.todayInvoiceCount).toBe(1);
    expect(overviewToday.todaySalesPaisa).toBe(50000);

    // Overview for yesterday ('2026-11-11') must NOT find this invoice
    const overviewYesterday = await getDashboardOverview(ctx.db, pharmacyId, '2026-11-11');
    expect(overviewYesterday.todayInvoiceCount).toBe(0);

    // Sales report for 2026-11-12 must find this invoice
    const reportToday = await getSalesReport(ctx.db, {
      pharmacyId,
      startDate: '2026-11-12',
      endDate: '2026-11-12',
    });
    expect(reportToday.totals.invoiceCount).toBe(1);
    expect(reportToday.totals.totalPaisa).toBe(50000);

    // Sales report for yesterday must be empty
    const reportYesterday = await getSalesReport(ctx.db, {
      pharmacyId,
      startDate: '2026-11-11',
      endDate: '2026-11-11',
    });
    expect(reportYesterday.totals.invoiceCount).toBe(0);
  });
});
