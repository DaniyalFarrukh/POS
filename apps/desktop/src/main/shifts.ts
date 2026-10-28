import type { Database as DatabaseInstance } from 'better-sqlite3';
import { getDatabase } from './db';
import {
  generateUuidV7,
  type OpenShiftInput,
  type CloseShiftInput,
  type ShiftRecord,
  type UserRole,
  OpenShiftInputSchema,
  CloseShiftInputSchema,
} from '@pos/shared';
import { getSession, assertRole } from './auth';

interface RawShiftRow {
  id: string;
  branch_id: string;
  counter_id: string;
  cashier_user_id: string;
  status: 'open' | 'closed';
  opened_at: string;
  closed_at: string | null;
  opening_cash_paisa: number;
  counted_cash_paisa: number | null;
  expected_cash_paisa: number | null;
  difference_paisa: number | null;
  sales_cash_paisa: number;
  sales_card_paisa: number;
  sales_wallet_paisa: number;
  returns_cash_paisa: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  cashier_name?: string | null;
  counter_name?: string | null;
}

function resolveCounterAndBranch(
  db: DatabaseInstance,
  explicitCounterId?: string,
  explicitBranchId?: string
): { counterId: string; branchId: string } {
  let counterId = explicitCounterId;
  let branchId = explicitBranchId;

  if (!counterId) {
    const counter = db.prepare(`SELECT id, branch_id FROM counters LIMIT 1;`).get() as
      | { id: string; branch_id: string }
      | undefined;
    if (!counter) {
      throw new Error('No counters found in system. Please configure a counter first.');
    }
    counterId = counter.id;
    branchId = branchId || counter.branch_id;
  } else if (!branchId) {
    const counter = db.prepare(`SELECT branch_id FROM counters WHERE id = ?;`).get(counterId) as
      | { branch_id: string }
      | undefined;
    if (counter) {
      branchId = counter.branch_id;
    } else {
      const branch = db.prepare(`SELECT id FROM branches LIMIT 1;`).get() as { id: string } | undefined;
      if (!branch) throw new Error('No branches found in system.');
      branchId = branch.id;
    }
  }

  return { counterId, branchId: branchId! };
}

function computeLiveShiftTotals(
  db: DatabaseInstance,
  counterId: string,
  openedAt: string,
  closedAt?: string | null
): {
  salesCashPaisa: number;
  salesCardPaisa: number;
  salesWalletPaisa: number;
  salesTotalPaisa: number;
  salesCount: number;
  returnsCashPaisa: number;
  returnsCount: number;
} {
  const timeUpper = closedAt || new Date().toISOString();

  // Aggregate payments for finalized invoices at this counter during the shift window
  const salesRow = db
    .prepare(
      `
      SELECT
        COALESCE(SUM(CASE WHEN p.method = 'cash' THEN p.amount_paisa ELSE 0 END), 0) AS sales_cash,
        COALESCE(SUM(CASE WHEN p.method = 'card' THEN p.amount_paisa ELSE 0 END), 0) AS sales_card,
        COALESCE(SUM(CASE WHEN p.method = 'wallet' THEN p.amount_paisa ELSE 0 END), 0) AS sales_wallet,
        COUNT(DISTINCT i.id) AS sales_count
      FROM invoices i
      LEFT JOIN payments p ON p.invoice_id = i.id
      WHERE i.counter_id = ?
        AND i.status = 'finalized'
        AND i.created_at >= ?
        AND i.created_at <= ?;
    `
    )
    .get(counterId, openedAt, timeUpper) as {
    sales_cash: number;
    sales_card: number;
    sales_wallet: number;
    sales_count: number;
  };

  // Aggregate credit note cash returns at this counter during the shift window
  const returnsRow = db
    .prepare(
      `
      SELECT
        COALESCE(SUM(CASE WHEN refund_method = 'cash' THEN total_paisa ELSE 0 END), 0) AS returns_cash,
        COUNT(id) AS returns_count
      FROM credit_notes
      WHERE counter_id = ?
        AND created_at >= ?
        AND created_at <= ?;
    `
    )
    .get(counterId, openedAt, timeUpper) as {
    returns_cash: number;
    returns_count: number;
  };

  const salesCashPaisa = salesRow?.sales_cash ?? 0;
  const salesCardPaisa = salesRow?.sales_card ?? 0;
  const salesWalletPaisa = salesRow?.sales_wallet ?? 0;
  const salesTotalPaisa = salesCashPaisa + salesCardPaisa + salesWalletPaisa;
  const salesCount = salesRow?.sales_count ?? 0;
  const returnsCashPaisa = returnsRow?.returns_cash ?? 0;
  const returnsCount = returnsRow?.returns_count ?? 0;

  return {
    salesCashPaisa,
    salesCardPaisa,
    salesWalletPaisa,
    salesTotalPaisa,
    salesCount,
    returnsCashPaisa,
    returnsCount,
  };
}

/**
 * Open a new shift for a counter with opening cash.
 */
export function openShift(
  input: OpenShiftInput,
  options?: {
    counterId?: string;
    cashierUserId?: string;
    branchId?: string;
    rawDb?: DatabaseInstance;
  }
): ShiftRecord {
  const validated = OpenShiftInputSchema.parse(input);
  const db = options?.rawDb ?? getDatabase();

  const { counterId, branchId } = resolveCounterAndBranch(
    db,
    options?.counterId,
    options?.branchId
  );

  let cashierUserId = options?.cashierUserId;
  if (!cashierUserId) {
    const session = getSession();
    if (session) {
      cashierUserId = session.user.id;
    } else {
      const firstUser = db.prepare(`SELECT id FROM users LIMIT 1;`).get() as { id: string } | undefined;
      if (!firstUser) throw new Error('No users found in system.');
      cashierUserId = firstUser.id;
    }
  }
  const resolvedCashierUserId: string = cashierUserId;

  return db.transaction(() => {
    // 1. Check if there is already an open shift for this counter
    const existingOpen = db
      .prepare(`SELECT id FROM shifts WHERE counter_id = ? AND status = 'open' LIMIT 1;`)
      .get(counterId) as { id: string } | undefined;

    if (existingOpen) {
      throw new Error('An active shift is already open for this counter. Please close it first.');
    }

    const shiftId = generateUuidV7();
    const now = new Date().toISOString();

    db.prepare(
      `
      INSERT INTO shifts (
        id,
        branch_id,
        counter_id,
        cashier_user_id,
        status,
        opened_at,
        closed_at,
        opening_cash_paisa,
        counted_cash_paisa,
        expected_cash_paisa,
        difference_paisa,
        sales_cash_paisa,
        sales_card_paisa,
        sales_wallet_paisa,
        returns_cash_paisa,
        notes,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, 'open', ?, NULL, ?, NULL, ?, NULL, 0, 0, 0, 0, ?, ?, ?);
    `
    ).run(
      shiftId,
      branchId,
      counterId,
      resolvedCashierUserId,
      now,
      validated.openingCashPaisa,
      validated.openingCashPaisa, // expected cash is opening cash at start
      validated.notes ?? null,
      now,
      now
    );

    // Outbox event
    const outboxEventId = generateUuidV7();
    db.prepare(
      `
      INSERT INTO outbox (
        id,
        event_id,
        device_seq,
        type,
        event_type,
        entity_id,
        payload,
        occurred_at,
        status,
        attempts,
        created_at,
        synced_at
      ) VALUES (?, ?, (SELECT COALESCE(MAX(device_seq), 0) + 1 FROM outbox), 'shift.opened', 'shift.opened', ?, ?, ?, 'pending', 0, ?, null);
    `
    ).run(
      outboxEventId,
      outboxEventId,
      shiftId,
      JSON.stringify({
        shiftId,
        counterId,
        cashierUserId: resolvedCashierUserId,
        openingCashPaisa: validated.openingCashPaisa,
        openedAt: now,
      }),
      now,
      now
    );

    // Fetch names for record
    const names = db
      .prepare(
        `
      SELECT u.name AS cashier_name, c.name AS counter_name
      FROM users u, counters c
      WHERE u.id = ? AND c.id = ?;
    `
      )
      .get(resolvedCashierUserId, counterId) as { cashier_name: string; counter_name: string } | undefined;

    return {
      id: shiftId,
      branchId,
      counterId,
      cashierUserId: resolvedCashierUserId,
      status: 'open' as const,
      openedAt: now,
      closedAt: null,
      openingCashPaisa: validated.openingCashPaisa,
      countedCashPaisa: null,
      expectedCashPaisa: validated.openingCashPaisa,
      differencePaisa: null,
      salesCashPaisa: 0,
      salesCardPaisa: 0,
      salesWalletPaisa: 0,
      salesTotalPaisa: 0,
      returnsCashPaisa: 0,
      salesCount: 0,
      returnsCount: 0,
      cashierName: names?.cashier_name ?? undefined,
      counterName: names?.counter_name ?? undefined,
      notes: validated.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }).immediate();
}

/**
 * Get the currently open shift for a counter (with dynamic live sales and returns totals).
 */
export function getCurrentShift(
  counterId?: string,
  rawDb?: DatabaseInstance
): ShiftRecord | null {
  const db = rawDb ?? getDatabase();
  const { counterId: targetCounterId } = resolveCounterAndBranch(db, counterId);

  const row = db
    .prepare(
      `
      SELECT
        s.*,
        u.name AS cashier_name,
        c.name AS counter_name
      FROM shifts s
      LEFT JOIN users u ON s.cashier_user_id = u.id
      LEFT JOIN counters c ON s.counter_id = c.id
      WHERE s.counter_id = ? AND s.status = 'open'
      LIMIT 1;
    `
    )
    .get(targetCounterId) as RawShiftRow | undefined;

  if (!row) {
    return null;
  }

  const live = computeLiveShiftTotals(db, row.counter_id, row.opened_at, null);
  const expectedCashPaisa = row.opening_cash_paisa + live.salesCashPaisa - live.returnsCashPaisa;

  return {
    id: row.id,
    branchId: row.branch_id,
    counterId: row.counter_id,
    cashierUserId: row.cashier_user_id,
    status: 'open',
    openedAt: row.opened_at,
    closedAt: null,
    openingCashPaisa: row.opening_cash_paisa,
    countedCashPaisa: null,
    expectedCashPaisa,
    differencePaisa: null,
    salesCashPaisa: live.salesCashPaisa,
    salesCardPaisa: live.salesCardPaisa,
    salesWalletPaisa: live.salesWalletPaisa,
    salesTotalPaisa: live.salesTotalPaisa,
    returnsCashPaisa: live.returnsCashPaisa,
    salesCount: live.salesCount,
    returnsCount: live.returnsCount,
    cashierName: row.cashier_name ?? undefined,
    counterName: row.counter_name ?? undefined,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Close an active shift with counted cash. Computes expected vs counted difference and seals shift.
 */
export function closeShift(
  input: CloseShiftInput,
  options?: {
    cashierUserId?: string;
    userRole?: UserRole;
    rawDb?: DatabaseInstance;
  }
): ShiftRecord {
  const validated = CloseShiftInputSchema.parse(input);
  const db = options?.rawDb ?? getDatabase();

  return db.transaction(() => {
    const row = db
      .prepare(
        `
        SELECT
          s.*,
          u.name AS cashier_name,
          c.name AS counter_name
        FROM shifts s
        LEFT JOIN users u ON s.cashier_user_id = u.id
        LEFT JOIN counters c ON s.counter_id = c.id
        WHERE s.id = ?;
      `
      )
      .get(validated.shiftId) as RawShiftRow | undefined;

    if (!row) {
      throw new Error(`Shift not found: ${validated.shiftId}`);
    }

    if (row.status !== 'open') {
      throw new Error(`Shift is already ${row.status}.`);
    }

    // Role ownership check: cashier may only close their own shift
    if (
      options?.cashierUserId &&
      options?.userRole === 'cashier' &&
      row.cashier_user_id !== options.cashierUserId
    ) {
      throw new Error('Unauthorized: Cashier may only close their own shift.');
    }

    const now = new Date().toISOString();
    const live = computeLiveShiftTotals(db, row.counter_id, row.opened_at, now);

    const expectedCashPaisa = row.opening_cash_paisa + live.salesCashPaisa - live.returnsCashPaisa;
    const differencePaisa = validated.countedCashPaisa - expectedCashPaisa;
    const finalNotes = validated.notes !== undefined ? validated.notes : row.notes;

    db.prepare(
      `
      UPDATE shifts SET
        status = 'closed',
        closed_at = ?,
        counted_cash_paisa = ?,
        expected_cash_paisa = ?,
        difference_paisa = ?,
        sales_cash_paisa = ?,
        sales_card_paisa = ?,
        sales_wallet_paisa = ?,
        returns_cash_paisa = ?,
        notes = ?,
        updated_at = ?
      WHERE id = ?;
    `
    ).run(
      now,
      validated.countedCashPaisa,
      expectedCashPaisa,
      differencePaisa,
      live.salesCashPaisa,
      live.salesCardPaisa,
      live.salesWalletPaisa,
      live.returnsCashPaisa,
      finalNotes ?? null,
      now,
      row.id
    );

    // Outbox event
    const outboxEventId = generateUuidV7();
    db.prepare(
      `
      INSERT INTO outbox (
        id,
        event_id,
        device_seq,
        type,
        event_type,
        entity_id,
        payload,
        occurred_at,
        status,
        attempts,
        created_at,
        synced_at
      ) VALUES (?, ?, (SELECT COALESCE(MAX(device_seq), 0) + 1 FROM outbox), 'shift.closed', 'shift.closed', ?, ?, ?, 'pending', 0, ?, null);
    `
    ).run(
      outboxEventId,
      outboxEventId,
      row.id,
      JSON.stringify({
        shiftId: row.id,
        counterId: row.counter_id,
        cashierUserId: row.cashier_user_id,
        openedAt: row.opened_at,
        closedAt: now,
        openingCashPaisa: row.opening_cash_paisa,
        countedCashPaisa: validated.countedCashPaisa,
        expectedCashPaisa,
        differencePaisa,
        salesCashPaisa: live.salesCashPaisa,
        salesCardPaisa: live.salesCardPaisa,
        salesWalletPaisa: live.salesWalletPaisa,
        returnsCashPaisa: live.returnsCashPaisa,
      }),
      now,
      now
    );

    return {
      id: row.id,
      branchId: row.branch_id,
      counterId: row.counter_id,
      cashierUserId: row.cashier_user_id,
      status: 'closed' as const,
      openedAt: row.opened_at,
      closedAt: now,
      openingCashPaisa: row.opening_cash_paisa,
      countedCashPaisa: validated.countedCashPaisa,
      expectedCashPaisa,
      differencePaisa,
      salesCashPaisa: live.salesCashPaisa,
      salesCardPaisa: live.salesCardPaisa,
      salesWalletPaisa: live.salesWalletPaisa,
      salesTotalPaisa: live.salesTotalPaisa,
      returnsCashPaisa: live.returnsCashPaisa,
      salesCount: live.salesCount,
      returnsCount: live.returnsCount,
      cashierName: row.cashier_name ?? undefined,
      counterName: row.counter_name ?? undefined,
      notes: finalNotes ?? null,
      createdAt: row.created_at,
      updatedAt: now,
    };
  }).immediate();
}

/**
 * Get shift history for a branch or counter.
 */
export function getShiftHistory(
  options?: {
    branchId?: string;
    counterId?: string;
    limit?: number;
    offset?: number;
    rawDb?: DatabaseInstance;
  }
): ShiftRecord[] {
  const db = options?.rawDb ?? getDatabase();
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options?.branchId) {
    conditions.push('s.branch_id = ?');
    params.push(options.branchId);
  }
  if (options?.counterId) {
    conditions.push('s.counter_id = ?');
    params.push(options.counterId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `
      SELECT
        s.*,
        u.name AS cashier_name,
        c.name AS counter_name
      FROM shifts s
      LEFT JOIN users u ON s.cashier_user_id = u.id
      LEFT JOIN counters c ON s.counter_id = c.id
      ${whereClause}
      ORDER BY s.opened_at DESC
      LIMIT ? OFFSET ?;
    `
    )
    .all(...params, limit, offset) as RawShiftRow[];

  return rows.map((r) => {
    const isClosed = r.status === 'closed';
    // If closed, numbers are stored in DB. If open, compute dynamically.
    if (isClosed) {
      const salesTotal = r.sales_cash_paisa + r.sales_card_paisa + r.sales_wallet_paisa;
      return {
        id: r.id,
        branchId: r.branch_id,
        counterId: r.counter_id,
        cashierUserId: r.cashier_user_id,
        status: r.status,
        openedAt: r.opened_at,
        closedAt: r.closed_at,
        openingCashPaisa: r.opening_cash_paisa,
        countedCashPaisa: r.counted_cash_paisa,
        expectedCashPaisa: r.expected_cash_paisa ?? r.opening_cash_paisa,
        differencePaisa: r.difference_paisa,
        salesCashPaisa: r.sales_cash_paisa,
        salesCardPaisa: r.sales_card_paisa,
        salesWalletPaisa: r.sales_wallet_paisa,
        salesTotalPaisa: salesTotal,
        returnsCashPaisa: r.returns_cash_paisa,
        salesCount: 0,
        returnsCount: 0,
        cashierName: r.cashier_name ?? undefined,
        counterName: r.counter_name ?? undefined,
        notes: r.notes,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    } else {
      const live = computeLiveShiftTotals(db, r.counter_id, r.opened_at, null);
      const expectedCash = r.opening_cash_paisa + live.salesCashPaisa - live.returnsCashPaisa;
      return {
        id: r.id,
        branchId: r.branch_id,
        counterId: r.counter_id,
        cashierUserId: r.cashier_user_id,
        status: r.status,
        openedAt: r.opened_at,
        closedAt: null,
        openingCashPaisa: r.opening_cash_paisa,
        countedCashPaisa: null,
        expectedCashPaisa: expectedCash,
        differencePaisa: null,
        salesCashPaisa: live.salesCashPaisa,
        salesCardPaisa: live.salesCardPaisa,
        salesWalletPaisa: live.salesWalletPaisa,
        salesTotalPaisa: live.salesTotalPaisa,
        returnsCashPaisa: live.returnsCashPaisa,
        salesCount: live.salesCount,
        returnsCount: live.returnsCount,
        cashierName: r.cashier_name ?? undefined,
        counterName: r.counter_name ?? undefined,
        notes: r.notes,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    }
  });
}

/**
 * Role guarded wrappers for IPC
 */
export function roleGuardedOpenShift(input: OpenShiftInput): ShiftRecord {
  const session = assertRole(getSession(), ['cashier', 'pharmacist', 'owner']);
  return openShift(input, {
    counterId: session.counter.id,
    branchId: session.branch.id,
    cashierUserId: session.user.id,
  });
}

export function roleGuardedCloseShift(input: CloseShiftInput): ShiftRecord {
  const session = assertRole(getSession(), ['cashier', 'pharmacist', 'owner']);
  return closeShift(input, {
    cashierUserId: session.user.id,
    userRole: session.user.role,
  });
}

export function roleGuardedGetCurrentShift(counterId?: string): ShiftRecord | null {
  const session = assertRole(getSession(), ['cashier', 'pharmacist', 'owner']);
  return getCurrentShift(counterId || session.counter.id);
}

export function roleGuardedGetShiftHistory(options?: {
  branchId?: string;
  counterId?: string;
  limit?: number;
  offset?: number;
}): ShiftRecord[] {
  const session = assertRole(getSession(), ['cashier', 'pharmacist', 'owner']);
  const isOwner = session.user.role === 'owner';
  return getShiftHistory({
    limit: options?.limit,
    offset: options?.offset,
    branchId: isOwner && options?.branchId ? options.branchId : session.branch.id,
    counterId: isOwner && options?.counterId ? options.counterId : session.counter.id,
  });
}
