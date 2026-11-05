import { z } from 'zod';

// ============================================================================
// 1. EXECUTIVE (OWNER / MANAGER) DASHBOARD
// ============================================================================

export const SalesMetricItemSchema = z.object({
  salesPaisa: z.number().int(),
  invoiceCount: z.number().int(),
  variancePercentage: z.number().optional(),
});
export type SalesMetricItem = z.infer<typeof SalesMetricItemSchema>;

export const ExecutiveDashboardDataSchema = z.object({
  businessDate: z.string(), // YYYY-MM-DD
  salesComparison: z.object({
    today: SalesMetricItemSchema,
    yesterday: SalesMetricItemSchema,
    lastWeek: SalesMetricItemSchema,
  }),
  grossMargin: z.object({
    revenuePaisa: z.number().int(),
    cogsPaisa: z.number().int(),
    grossMarginPaisa: z.number().int(),
    grossMarginPercentage: z.number(),
  }),
  cashPosition: z.object({
    totalCashPaisa: z.number().int(),
    accounts: z.array(
      z.object({
        id: z.string(),
        code: z.string(),
        name: z.string(),
        balancePaisa: z.number().int(),
      })
    ),
  }),
  payablesDuePaisa: z.number().int(),
  receivablesDuePaisa: z.number().int(),
  receivablesAging: z.object({
    currentPaisa: z.number().int(),
    days30Paisa: z.number().int(),
    days60Paisa: z.number().int(),
    days90PlusPaisa: z.number().int(),
  }),
  expiringStockValuePaisa: z.number().int(),
  expiringBatchesCount: z.number().int(),
  lowStockCount: z.number().int(),
  topMovers: z.array(
    z.object({
      productId: z.string(),
      productName: z.string(),
      unitsSold: z.number().int(),
      revenuePaisa: z.number().int(),
    })
  ),
  slowMovers: z.array(
    z.object({
      productId: z.string(),
      productName: z.string(),
      currentStock: z.number().int(),
      unitsSoldLast30Days: z.number().int(),
    })
  ),
  branchComparison: z.array(
    z.object({
      branchId: z.string(),
      branchName: z.string(),
      todaySalesPaisa: z.number().int(),
      todayInvoiceCount: z.number().int(),
      grossMarginPaisa: z.number().int(),
    })
  ),
  syncHealth: z.object({
    totalDevices: z.number().int(),
    onlineDevices: z.number().int(),
    warningDevices: z.number().int(),
    offlineDevices: z.number().int(),
    devices: z.array(
      z.object({
        deviceId: z.string(),
        deviceName: z.string(),
        branchName: z.string().optional(),
        counterName: z.string().optional(),
        lastSeenAt: z.string().nullable().optional(),
        status: z.enum(['online', 'warning', 'offline']),
      })
    ),
  }),
});
export type ExecutiveDashboardData = z.infer<typeof ExecutiveDashboardDataSchema>;

// ============================================================================
// 2. ACCOUNTANT DASHBOARD
// ============================================================================

export const AccountantDashboardDataSchema = z.object({
  businessDate: z.string(),
  unreconciledItems: z.object({
    unpostedEntriesCount: z.number().int(),
    unreconciledBankCount: z.number().int(),
    trialBalanceBalanced: z.boolean(),
    discrepancyPaisa: z.number().int(),
  }),
  periodCloseStatus: z.object({
    currentPeriod: z
      .object({
        id: z.string(),
        month: z.string(),
        startDate: z.string(),
        endDate: z.string(),
        status: z.string(),
      })
      .nullable(),
    checklist: z.object({
      unpostedDocuments: z.number().int(),
      bankReconciliationDone: z.boolean(),
      stockCountDone: z.boolean(),
      differencesZero: z.boolean(),
    }),
    canClose: z.boolean(),
  }),
  overdueReceivables: z.object({
    totalOverduePaisa: z.number().int(),
    aging: z.object({
      bucket0to30Paisa: z.number().int(),
      bucket31to60Paisa: z.number().int(),
      bucket61to90Paisa: z.number().int(),
      bucket90PlusPaisa: z.number().int(),
    }),
    topDebtors: z.array(
      z.object({
        customerId: z.string(),
        customerName: z.string(),
        customerPhone: z.string(),
        balancePaisa: z.number().int(),
        overdueDays: z.number().int(),
      })
    ),
  }),
  quickBalanceSheet: z.object({
    totalAssetsPaisa: z.number().int(),
    totalLiabilitiesPaisa: z.number().int(),
    totalEquityPaisa: z.number().int(),
  }),
});
export type AccountantDashboardData = z.infer<typeof AccountantDashboardDataSchema>;

// ============================================================================
// 3. PHARMACIST DASHBOARD
// ============================================================================

export const ExpiringBatchItemSchema = z.object({
  batchId: z.string(),
  batchNo: z.string(),
  productId: z.string(),
  productName: z.string(),
  expiryDate: z.string(),
  daysUntilExpiry: z.number().int(),
  currentStock: z.number().int(),
  costPaisa: z.number().int(),
  branchName: z.string().optional(),
});
export type ExpiringBatchItem = z.infer<typeof ExpiringBatchItemSchema>;

export const PharmacistDashboardDataSchema = z.object({
  businessDate: z.string(),
  expiringBatches: z.object({
    criticalUnder30Days: z.array(ExpiringBatchItemSchema),
    warning31to60Days: z.array(ExpiringBatchItemSchema),
    notice61to90Days: z.array(ExpiringBatchItemSchema),
    totalExpiringCount: z.number().int(),
    totalExpiringValuePaisa: z.number().int(),
  }),
  pendingRefills: z.object({
    dueSoonCount: z.number().int(),
    refills: z.array(
      z.object({
        prescriptionId: z.string(),
        prescriptionNumber: z.string(),
        patientName: z.string(),
        patientPhone: z.string(),
        doctorName: z.string().nullable().optional(),
        nextRefillDate: z.string(),
        repeatsRemaining: z.number().int(),
        isControlledDrug: z.boolean(),
      })
    ),
  }),
  controlledDrugLog: z.object({
    dispensedTodayCount: z.number().int(),
    recentDispenses: z.array(
      z.object({
        id: z.string(),
        prescriptionNumber: z.string().nullable().optional(),
        patientName: z.string(),
        doctorName: z.string().nullable().optional(),
        doctorRegistrationNumber: z.string().nullable().optional(),
        drugName: z.string(),
        quantity: z.number().int(),
        dispensedAt: z.string(),
        invoiceNumber: z.string().nullable().optional(),
      })
    ),
  }),
  lowStockDispensary: z.object({
    lowStockCount: z.number().int(),
    items: z.array(
      z.object({
        productId: z.string(),
        productName: z.string(),
        currentStock: z.number().int(),
        minStockLevel: z.number().int(),
      })
    ),
  }),
});
export type PharmacistDashboardData = z.infer<typeof PharmacistDashboardDataSchema>;
