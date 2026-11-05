import type { PrescriptionRecord, RefillReminderItem } from '../types';

export function getRefillDaysStatus(
  nextRefillDate: string,
  today: string
): {
  daysRemaining: number;
  label: string;
  isOverdue: boolean;
  urgency: 'overdue' | 'due_soon' | 'future';
  badgeClass: string;
} {
  const target = new Date(nextRefillDate).getTime();
  const current = new Date(today).getTime();
  const diffDays = Math.round((target - current) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return {
      daysRemaining: diffDays,
      label: `${Math.abs(diffDays)}d Overdue`,
      isOverdue: true,
      urgency: 'overdue',
      badgeClass: 'bg-red-100 text-red-800 border-red-200',
    };
  }

  if (diffDays === 0) {
    return {
      daysRemaining: 0,
      label: 'Due Today',
      isOverdue: false,
      urgency: 'due_soon',
      badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
    };
  }

  if (diffDays <= 3) {
    return {
      daysRemaining: diffDays,
      label: `Due in ${diffDays}d`,
      isOverdue: false,
      urgency: 'due_soon',
      badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
    };
  }

  return {
    daysRemaining: diffDays,
    label: `Due in ${diffDays}d`,
    isOverdue: false,
    urgency: 'future',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
  };
}

export function formatRefillContactText(item: RefillReminderItem): string {
  return `Refill Reminder: Dear ${item.patientName}, your prescription #${item.prescriptionNumber} (Dr. ${item.doctorName}) is due for refill on ${item.nextRefillDate}. You have ${item.remainingRepeats} repeat(s) remaining. Contact: ${item.patientPhone}`;
}

export function filterPrescriptions(
  items: PrescriptionRecord[],
  searchTerm: string,
  tabFilter: 'all' | 'active' | 'controlled' | 'fulfilled'
): PrescriptionRecord[] {
  const term = searchTerm.toLowerCase().trim();
  return items.filter((rx) => {
    if (term) {
      const matchPatient = rx.patientName.toLowerCase().includes(term);
      const matchNum = rx.prescriptionNumber.toLowerCase().includes(term);
      const matchDoctor = (rx.doctorName || '').toLowerCase().includes(term);
      const matchPhone = (rx.patientPhone || '').toLowerCase().includes(term);
      if (!matchPatient && !matchNum && !matchDoctor && !matchPhone) return false;
    }

    if (tabFilter === 'active') return rx.status === 'active';
    if (tabFilter === 'controlled') return rx.isControlledDrug;
    if (tabFilter === 'fulfilled') return rx.status === 'fulfilled';
    return true;
  });
}
