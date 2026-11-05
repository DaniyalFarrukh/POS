import { describe, it, expect } from 'vitest';
import {
  formatLeaveDateRange,
  filterLeaveRequests,
  getLeaveStatusBadge,
  groupCalendarLeavesByDate,
  formatPKR,
} from './lib/leave-utils';
import type { LeaveRequestRecord, LeaveCalendarItem } from './types';

describe('HR Leave Utilities', () => {
  it('formats single-day and multi-day date ranges accurately', () => {
    expect(formatLeaveDateRange('2026-11-10', '2026-11-10', 1)).toBe('2026-11-10 (1 day)');
    expect(formatLeaveDateRange('2026-11-10', '2026-11-15', 6)).toBe(
      '2026-11-10 to 2026-11-15 (6 days)'
    );
  });

  it('filters leave requests by search term, status and leave type', () => {
    const list: LeaveRequestRecord[] = [
      {
        id: '1',
        pharmacyId: 'p1',
        employeeId: 'e1',
        employeeName: 'Zain Ahmed',
        employeeCode: 'EMP-001',
        leaveTypeId: 'lt1',
        leaveTypeCode: 'ANNUAL',
        leaveTypeName: 'Annual Leave',
        isPaid: true,
        startDate: '2026-11-10',
        endDate: '2026-11-15',
        daysCount: 6,
        reason: 'Family trip',
        status: 'approved',
        createdAt: '2026-11-01',
        updatedAt: '2026-11-02',
      },
      {
        id: '2',
        pharmacyId: 'p1',
        employeeId: 'e2',
        employeeName: 'Sara Khan',
        employeeCode: 'EMP-002',
        leaveTypeId: 'lt2',
        leaveTypeCode: 'UNPAID',
        leaveTypeName: 'Unpaid Leave',
        isPaid: false,
        startDate: '2026-11-20',
        endDate: '2026-11-22',
        daysCount: 3,
        reason: 'Personal emergency',
        status: 'pending',
        createdAt: '2026-11-01',
        updatedAt: '2026-11-01',
      },
    ];

    expect(filterLeaveRequests(list, { status: 'approved' })).toHaveLength(1);
    expect(filterLeaveRequests(list, { search: 'Sara' })).toHaveLength(1);
    expect(filterLeaveRequests(list, { search: 'EMP-001' })).toHaveLength(1);
    expect(filterLeaveRequests(list, { leaveTypeId: 'lt2' })).toHaveLength(1);
    expect(filterLeaveRequests(list, { search: 'NonExistent' })).toHaveLength(0);
  });

  it('maps calendar leave events across each individual date in range', () => {
    const calendarItems: LeaveCalendarItem[] = [
      {
        id: 'c1',
        employeeId: 'e1',
        employeeName: 'Zain Ahmed',
        employeeCode: 'EMP-001',
        leaveTypeId: 'lt1',
        leaveTypeCode: 'ANNUAL',
        leaveTypeName: 'Annual Leave',
        isPaid: true,
        startDate: '2026-11-10',
        endDate: '2026-11-12',
        daysCount: 3,
        status: 'approved',
        reason: 'Holiday',
      },
    ];

    const grouped = groupCalendarLeavesByDate(calendarItems);
    expect(grouped['2026-11-10']).toHaveLength(1);
    expect(grouped['2026-11-11']).toHaveLength(1);
    expect(grouped['2026-11-12']).toHaveLength(1);
    expect(grouped['2026-11-13']).toBeUndefined();
  });

  it('formats paisa amounts to Pakistani Rupee notation', () => {
    expect(formatPKR(6000000)).toBe('Rs. 60,000.00');
    expect(formatPKR(5400000)).toBe('Rs. 54,000.00');
    expect(formatPKR(0)).toBe('Rs. 0.00');
  });

  it('returns valid status badges', () => {
    expect(getLeaveStatusBadge('approved').variant).toBe('success');
    expect(getLeaveStatusBadge('pending').variant).toBe('warning');
    expect(getLeaveStatusBadge('rejected').variant).toBe('destructive');
  });
});
