import { describe, it, expect } from 'vitest';
import { parseBankStatementCsv, computeReconciliationMath } from './lib/cash-bank-utils';

describe('Cash & Bank Utilities & Reconciliation Math', () => {
  it('1. parses standard CSV bank statements with debit and credit columns correctly into integer paisa', () => {
    const csvContent = `Date,Description,Reference,Debit,Credit,Balance
2026-11-01,Opening Balance,,0,500000.00,500000.00
2026-11-02,Cheque Cleared #5501,CHQ-5501,25000.50,0,474999.50
2026-11-03,Counter Cash Deposit,DEP-01,0,150000.00,624999.50
2026-11-04,Bank Charges,BC-01,250.00,0,624749.50
`;

    const lines = parseBankStatementCsv(csvContent);
    expect(lines.length).toBe(4);

    // Line 1: Opening balance 500,000.00 PKR -> 50,000,000 paisa credit (deposit)
    expect(lines[0]!.date).toBe('2026-11-01');
    expect(lines[0]!.creditPaisa).toBe(50000000);
    expect(lines[0]!.debitPaisa).toBe(0);

    // Line 2: Cheque 25,000.50 PKR -> 2,500,050 paisa debit (withdrawal)
    expect(lines[1]!.reference).toBe('CHQ-5501');
    expect(lines[1]!.debitPaisa).toBe(2500050);
    expect(lines[1]!.creditPaisa).toBe(0);

    // Line 3: Deposit 150,000 PKR -> 15,000,000 paisa credit
    expect(lines[2]!.creditPaisa).toBe(15000000);

    // Line 4: Bank Charges 250 PKR -> 25,000 paisa debit
    expect(lines[3]!.debitPaisa).toBe(25000);
  });

  it('2. parses single signed amount column CSV statements (+ for deposit, - for withdrawal)', () => {
    const csvContent = `Date,Description,Reference,Amount
2026-11-01,Vendor Online Payment,REF-1,-4500.00
2026-11-02,Cash Deposit,REF-2,12000.00
`;

    const lines = parseBankStatementCsv(csvContent);
    expect(lines.length).toBe(2);

    expect(lines[0]!.debitPaisa).toBe(450000); // Withdrawal
    expect(lines[0]!.creditPaisa).toBe(0);

    expect(lines[1]!.creditPaisa).toBe(1200000); // Deposit
    expect(lines[1]!.debitPaisa).toBe(0);
  });

  it('3. computes reconciliation difference math: exactly zero when all transactions match', () => {
    // Statement Ending Balance = 62,474,950 paisa
    const statementBalancePaisa = 62474950;
    // Ledger Ending Balance = 62,474,950 paisa
    const ledgerBalancePaisa = 62474950;

    const result = computeReconciliationMath({
      statementBalancePaisa,
      ledgerBalancePaisa,
      outstandingDepositsPaisa: 0,
      outstandingPaymentsPaisa: 0,
    });

    expect(result.adjustedStatementBalancePaisa).toBe(62474950);
    expect(result.differencePaisa).toBe(0);
    expect(result.isReconciled).toBe(true);
  });

  it('4. calculates unreconciled difference math when deposits in transit or uncleared checks exist', () => {
    // Statement Ending Balance: 50,000,000 paisa
    const statementBalancePaisa = 50000000;
    // Ledger Ending Balance: 55,000,000 paisa (recorded cash deposit not yet cleared by bank)
    const ledgerBalancePaisa = 55000000;

    // Case A: 5,000,000 deposit in transit (outstanding deposit)
    const resultWithTransit = computeReconciliationMath({
      statementBalancePaisa,
      ledgerBalancePaisa,
      outstandingDepositsPaisa: 5000000,
      outstandingPaymentsPaisa: 0,
    });

    // Adjusted statement balance = 50,000,000 + 5,000,000 = 55,000,000
    expect(resultWithTransit.adjustedStatementBalancePaisa).toBe(55000000);
    expect(resultWithTransit.differencePaisa).toBe(0);
    expect(resultWithTransit.isReconciled).toBe(true);

    // Case B: Discrepancy where transit does NOT explain the gap
    const resultDiscrepancy = computeReconciliationMath({
      statementBalancePaisa,
      ledgerBalancePaisa,
      outstandingDepositsPaisa: 2000000, // only 2,000,000 accounted for
      outstandingPaymentsPaisa: 0,
    });

    // Adjusted = 52,000,000, Ledger = 55,000,000 -> Diff = 3,000,000
    expect(resultDiscrepancy.differencePaisa).toBe(3000000);
    expect(resultDiscrepancy.isReconciled).toBe(false);
  });
});
