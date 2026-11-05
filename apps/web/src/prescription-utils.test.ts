import { describe, it, expect } from 'vitest';
import {
  getRefillDaysStatus,
  formatRefillContactText,
  filterPrescriptions,
} from './lib/prescription-utils';
import type { PrescriptionRecord, RefillReminderItem } from './types';

describe('Prescription Utilities', () => {
  it('calculates refill days status: overdue, due today, due soon, future', () => {
    const today = '2026-11-05';

    const overdue = getRefillDaysStatus('2026-11-02', today);
    expect(overdue.isOverdue).toBe(true);
    expect(overdue.label).toBe('3d Overdue');
    expect(overdue.urgency).toBe('overdue');

    const dueToday = getRefillDaysStatus('2026-11-05', today);
    expect(dueToday.label).toBe('Due Today');
    expect(dueToday.urgency).toBe('due_soon');

    const dueSoon = getRefillDaysStatus('2026-11-07', today);
    expect(dueSoon.label).toBe('Due in 2d');
    expect(dueSoon.urgency).toBe('due_soon');

    const future = getRefillDaysStatus('2026-11-15', today);
    expect(future.label).toBe('Due in 10d');
    expect(future.urgency).toBe('future');
  });

  it('formats call/SMS-ready contact message for patients', () => {
    const item: RefillReminderItem = {
      prescriptionId: 'rx-1',
      prescriptionNumber: 'RX-20261105-001',
      patientName: 'Mrs. Saima',
      patientPhone: '03001234567',
      doctorName: 'Asad',
      prescriptionDate: '2026-11-01',
      nextRefillDate: '2026-11-26',
      repeatCount: 3,
      repeatsUsed: 1,
      remainingRepeats: 2,
      isControlledDrug: false,
      contactSummary: 'Summary',
    };

    const text = formatRefillContactText(item);
    expect(text).toContain('Mrs. Saima');
    expect(text).toContain('RX-20261105-001');
    expect(text).toContain('2026-11-26');
    expect(text).toContain('2 repeat(s) remaining');
    expect(text).toContain('03001234567');
  });

  it('filters prescriptions by search and tabs', () => {
    const items: PrescriptionRecord[] = [
      {
        id: '1',
        pharmacyId: 'p1',
        prescriptionNumber: 'RX-001',
        patientName: 'Ali Raza',
        prescriptionDate: '2026-11-01',
        repeatCount: 1,
        repeatsUsed: 0,
        refillIntervalDays: 30,
        isControlledDrug: false,
        status: 'active',
        retentionStatus: 'active',
        statutoryRetentionUntil: '2028-11-01',
        createdAt: '2026-11-01',
        updatedAt: '2026-11-01',
      },
      {
        id: '2',
        pharmacyId: 'p1',
        prescriptionNumber: 'RX-002',
        patientName: 'Zainab Bibi',
        prescriptionDate: '2026-11-01',
        repeatCount: 2,
        repeatsUsed: 0,
        refillIntervalDays: 30,
        isControlledDrug: true,
        status: 'active',
        retentionStatus: 'active',
        statutoryRetentionUntil: '2031-11-01',
        createdAt: '2026-11-01',
        updatedAt: '2026-11-01',
      },
      {
        id: '3',
        pharmacyId: 'p1',
        prescriptionNumber: 'RX-003',
        patientName: 'Hamza Khan',
        prescriptionDate: '2026-10-01',
        repeatCount: 0,
        repeatsUsed: 0,
        refillIntervalDays: 30,
        isControlledDrug: false,
        status: 'fulfilled',
        retentionStatus: 'active',
        statutoryRetentionUntil: '2028-10-01',
        createdAt: '2026-10-01',
        updatedAt: '2026-10-01',
      },
    ];

    expect(filterPrescriptions(items, 'ali', 'all')).toHaveLength(1);
    expect(filterPrescriptions(items, '', 'active')).toHaveLength(2);
    expect(filterPrescriptions(items, '', 'controlled')).toHaveLength(1);
    expect(filterPrescriptions(items, '', 'controlled')[0]!.id).toBe('2');
    expect(filterPrescriptions(items, '', 'fulfilled')).toHaveLength(1);
    expect(filterPrescriptions(items, '', 'fulfilled')[0]!.id).toBe('3');
  });
});
