import type { LeaveRequestRecord, LeaveCalendarItem } from '../types';

export function formatLeaveDateRange(
  startDate: string,
  endDate: string,
  daysCount: number
): string {
  const daysText = `${daysCount} ${daysCount === 1 ? 'day' : 'days'}`;
  if (startDate === endDate) {
    return `${startDate} (${daysText})`;
  }
  return `${startDate} to ${endDate} (${daysText})`;
}

export function filterLeaveRequests(
  requests: LeaveRequestRecord[],
  filter: { status?: string; search?: string; leaveTypeId?: string }
): LeaveRequestRecord[] {
  return requests.filter((req) => {
    if (filter.status && filter.status !== 'all' && req.status !== filter.status) {
      return false;
    }
    if (
      filter.leaveTypeId &&
      filter.leaveTypeId !== 'all' &&
      req.leaveTypeId !== filter.leaveTypeId
    ) {
      return false;
    }
    if (filter.search && filter.search.trim()) {
      const q = filter.search.trim().toLowerCase();
      const matchName = req.employeeName?.toLowerCase().includes(q);
      const matchCode = req.employeeCode?.toLowerCase().includes(q);
      const matchType = req.leaveTypeName?.toLowerCase().includes(q);
      const matchReason = req.reason?.toLowerCase().includes(q);
      if (!matchName && !matchCode && !matchType && !matchReason) {
        return false;
      }
    }
    return true;
  });
}

export function getLeaveStatusBadge(status: LeaveRequestRecord['status']): {
  label: string;
  variant: 'default' | 'success' | 'destructive' | 'warning' | 'secondary';
} {
  switch (status) {
    case 'approved':
      return { label: 'Approved', variant: 'success' };
    case 'pending':
      return { label: 'Pending Approval', variant: 'warning' };
    case 'rejected':
      return { label: 'Rejected', variant: 'destructive' };
    case 'cancelled':
      return { label: 'Cancelled', variant: 'secondary' };
    default:
      return { label: status, variant: 'default' };
  }
}

export function groupCalendarLeavesByDate(
  items: LeaveCalendarItem[]
): Record<string, LeaveCalendarItem[]> {
  const map: Record<string, LeaveCalendarItem[]> = {};

  for (const item of items) {
    const start = new Date(`${item.startDate}T00:00:00Z`);
    const end = new Date(`${item.endDate}T00:00:00Z`);
    const cur = new Date(start);

    while (cur <= end) {
      const dateStr = cur.toISOString().substring(0, 10);
      if (!map[dateStr]) {
        map[dateStr] = [];
      }
      map[dateStr].push(item);
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  }

  return map;
}

export function formatPKR(paisa: number): string {
  const rs = (paisa / 100).toLocaleString('en-PK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `Rs. ${rs}`;
}
