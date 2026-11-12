import { parseCsv, parsePkrToPaisa } from '@pos/shared';

export interface BankStatementLine {
  id: string;
  date: string;
  description: string;
  reference?: string | null;
  debitPaisa: number; // money withdrawn / paid
  creditPaisa: number; // money deposited / received
  balancePaisa?: number | null;
  matched?: boolean;
}

export interface ReconciliationMathInput {
  statementBalancePaisa: number;
  ledgerBalancePaisa: number;
  outstandingDepositsPaisa: number;
  outstandingPaymentsPaisa: number;
}

export interface ReconciliationMathResult {
  adjustedStatementBalancePaisa: number;
  differencePaisa: number;
  isReconciled: boolean;
}

/**
 * Parses a decimal string (e.g. "1250.50" or "-500") into integer paisa
 */
export const parsePaisaFromString = (val?: string | null): number =>
  val ? parsePkrToPaisa(val) : 0;

/**
 * Parses raw CSV bank statement data into strongly typed statement lines
 */
export function parseBankStatementCsv(csvText: string): BankStatementLine[] {
  const allRows = parseCsv(csvText);
  if (!allRows || allRows.length < 2) {
    return [];
  }

  const rawHeaders = allRows[0] || [];
  const headers = rawHeaders.map((h) => h.toLowerCase().trim());
  const dateIdx = headers.findIndex((h) => h.includes('date'));
  const descIdx = headers.findIndex(
    (h) =>
      h.includes('desc') || h.includes('detail') || h.includes('narrat') || h.includes('particular')
  );
  const refIdx = headers.findIndex(
    (h) => h.includes('ref') || h.includes('chq') || h.includes('cheque') || h.includes('trans')
  );
  const debitIdx = headers.findIndex(
    (h) => h.includes('debit') || h.includes('withdr') || h.includes('out')
  );
  const creditIdx = headers.findIndex(
    (h) => h.includes('credit') || h.includes('dep') || h.includes('in')
  );
  const amountIdx = headers.findIndex((h) => h.includes('amount'));
  const balIdx = headers.findIndex((h) => h.includes('bal'));

  const lines: BankStatementLine[] = [];
  const dataRows = allRows.slice(1);

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i]!;
    const rawDate = dateIdx >= 0 ? row[dateIdx] : '';
    if (!rawDate?.trim()) continue;

    const description = descIdx >= 0 && row[descIdx] ? row[descIdx]!.trim() : 'Transaction';
    const reference = refIdx >= 0 && row[refIdx] ? row[refIdx]!.trim() : null;

    let debitPaisa = 0;
    let creditPaisa = 0;

    if (debitIdx >= 0 || creditIdx >= 0) {
      if (debitIdx >= 0) {
        debitPaisa = Math.abs(parsePaisaFromString(row[debitIdx]));
      }
      if (creditIdx >= 0) {
        creditPaisa = Math.abs(parsePaisaFromString(row[creditIdx]));
      }
    } else if (amountIdx >= 0) {
      const amtPaisa = parsePaisaFromString(row[amountIdx]);
      if (amtPaisa < 0) {
        debitPaisa = Math.abs(amtPaisa);
      } else {
        creditPaisa = amtPaisa;
      }
    }

    let balancePaisa: number | null = null;
    if (balIdx >= 0 && row[balIdx]) {
      balancePaisa = parsePaisaFromString(row[balIdx]);
    }

    lines.push({
      id: `stmt-line-${i + 1}`,
      date: rawDate.trim(),
      description,
      reference,
      debitPaisa,
      creditPaisa,
      balancePaisa,
      matched: false,
    });
  }

  return lines;
}

/**
 * Computes the reconciliation arithmetic:
 * Adjusted Statement Balance = Statement Balance + Outstanding Deposits - Outstanding Checks
 * Difference = |Ledger Balance - Adjusted Statement Balance|
 */
export function computeReconciliationMath(
  input: ReconciliationMathInput
): ReconciliationMathResult {
  const adjustedStatementBalancePaisa =
    input.statementBalancePaisa + input.outstandingDepositsPaisa - input.outstandingPaymentsPaisa;

  const differencePaisa = Math.abs(input.ledgerBalancePaisa - adjustedStatementBalancePaisa);

  return {
    adjustedStatementBalancePaisa,
    differencePaisa,
    isReconciled: differencePaisa === 0,
  };
}
