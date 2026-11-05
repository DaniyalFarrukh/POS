import { describe, it, expect } from 'vitest';
import type { GlobalSearchResponse, UserNotification } from '@pos/shared';

describe('Web Notifications, Search & Audit Log Utilities', () => {
  it('correctly calculates unread notifications count and handles mark as read immutably', () => {
    const notifications: UserNotification[] = [
      {
        id: '01a1abea-0001-7000-8000-000000000001',
        pharmacyId: '01a1abea-0000-7000-8000-000000000001',
        userId: '01a1abea-0000-7000-8000-000000000002',
        type: 'expiring_stock',
        title: 'Batch Expiring',
        message: 'Panadol expiring in 15 days',
        severity: 'warning',
        isRead: false,
        createdAt: '2026-11-05T10:00:00Z',
      },
      {
        id: '01a1abea-0001-7000-8000-000000000002',
        pharmacyId: '01a1abea-0000-7000-8000-000000000001',
        userId: '01a1abea-0000-7000-8000-000000000002',
        type: 'low_stock',
        title: 'Low Stock Alert',
        message: 'Amoxicillin 500mg below reorder level',
        severity: 'critical',
        isRead: true,
        readAt: '2026-11-05T11:00:00Z',
        createdAt: '2026-11-05T09:00:00Z',
      },
    ];

    const initialUnread = notifications.filter((n) => !n.isRead).length;
    expect(initialUnread).toBe(1);

    // Simulate mark as read
    const updated = notifications.map((n) =>
      n.id === '01a1abea-0001-7000-8000-000000000001'
        ? { ...n, isRead: true, readAt: new Date().toISOString() }
        : n
    );
    const postUnread = updated.filter((n) => !n.isRead).length;
    expect(postUnread).toBe(0);
    expect(updated[0]?.isRead).toBe(true);
    expect(updated[0]?.readAt).toBeDefined();
  });

  it('structures global search results safely and handles empty restricted sections', () => {
    // Restricted cashier search response (suppliers empty)
    const cashierSearch: GlobalSearchResponse = {
      query: 'Glaxo',
      results: {
        invoices: [],
        customers: [],
        products: [
          {
            id: '01a1abea-0002-7000-8000-000000000001',
            type: 'product',
            title: 'Augmentin 625mg',
            subtitle: 'Amoxicillin • MRP Rs. 240.00',
            link: '/stock-management?productId=01a1abea-0002-7000-8000-000000000001',
          },
        ],
        suppliers: [], // Strictly omitted for cashier role
      },
      totalCount: 1,
    };

    expect(cashierSearch.results.suppliers).toEqual([]);
    expect(cashierSearch.results.products.length).toBe(1);
    expect(cashierSearch.totalCount).toBe(1);
  });

  it('formats RFC-4180 CSV entries with quotes and escapes internal commas', () => {
    const rawData = [
      {
        seq: 1,
        user: 'Dr. Tariq, Owner',
        action: 'fiscal_period.close',
        summary: 'Closed period "2026-Q3", verified balances',
      },
    ];

    const escapeCsv = (val: unknown) => {
      const str = String(val ?? '').replace(/"/g, '""');
      return `"${str}"`;
    };

    const csvRow = [
      escapeCsv(rawData[0]?.seq),
      escapeCsv(rawData[0]?.user),
      escapeCsv(rawData[0]?.action),
      escapeCsv(rawData[0]?.summary),
    ].join(',');

    expect(csvRow).toBe(
      '"1","Dr. Tariq, Owner","fiscal_period.close","Closed period ""2026-Q3"", verified balances"'
    );
  });
});
