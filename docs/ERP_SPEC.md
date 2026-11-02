# ERP Spec (Phases 7 to 12)

## Product shape
- Cloud back-office (apps/web) for owners, managers, accountants. Counter app (apps/desktop) for cashiers and pharmacists.
- Accounting is derived from business documents (invoices, credit notes, purchases, payments, expenses, payroll) by a server-side posting engine. Nobody edits balances.

## Roles (permission matrix lives in packages/shared)
owner: everything, including user management and period close.
manager: operations across branches, approvals, no ledger changes and no user management.
accountant: finance modules, journals, reports, period close proposals; no user management.
pharmacist: counter + stock + purchasing receiving + prescriptions.
cashier: counter only.
Menus are generated from the same matrix as the server guards. A hidden menu item is never the only protection.

## Navigation (apps/web)
Dashboard
Sales & Customers: Sales (invoices), Returns and Credit Notes, Customers, Prescriptions, Loyalty
Inventory: Products, Stock Management, Batches & Expiry, Warehouses & Locations, Purchase Orders, Goods Received, Suppliers, Stock Transfers, Stock Counts, Supplier Returns
Finance & Accounting: Dashboard, Invoices, Payments, Expenses, Accounts Receivable, Accounts Payable, Cash & Bank, Sales Ledger, Journal Entries, Chart of Accounts, Financial Reports (Trial Balance, Profit & Loss, Balance Sheet, Cash Flow, General Ledger), Budget Planning, Period Close
Human Resources: Employees, Attendance, Leave Management, Payroll
Reports & Analytics
Settings: Pharmacy profile, Branches & Counters, Tax categories, Receipt templates, Devices & Sync
User Management, Audit Log, Help
(The reference product's "Cash Receivable" is folded into Payments and Cash & Bank.)

## Ledger model (server, Postgres)
- accounts: id, pharmacy_id, code (unique per pharmacy), name, type (asset|liability|equity|revenue|expense), parent_id, is_active, is_system.
- fiscal_periods: id, pharmacy_id, start_date, end_date, status (open|closed).
- journal_entries: id, pharmacy_id, entry_no (sequential per pharmacy), entry_date (Karachi business date), source_type, source_id, memo, status (posted|reversed), reverses_entry_id, created_by, created_at. UNIQUE (pharmacy_id, source_type, source_id) for auto-posted entries (idempotency).
- journal_lines: id, entry_id, pharmacy_id, account_id, debit_paisa, credit_paisa, branch_id, party_type (customer|supplier|employee|null), party_id, memo. Each line has exactly one of debit or credit > 0.
- Rules: each entry balances (sum debit = sum credit), enforced in code and by a database constraint trigger; entries and lines are immutable (triggers like invoices); no posting into a closed period; corrections are reversing entries; reports derive from journal lines only.
- Inventory valuation uses the batch cost of the batch actually sold (we sell by batch).

## Default chart of accounts (an accountant must review before real use)
Assets: 1000 Cash in Hand, 1010 Bank, 1020 Mobile Wallets, 1100 Accounts Receivable, 1200 Inventory, 1300 Input Sales Tax, 1400 Advances to Suppliers, 1500 Fixed Assets, 1590 Accumulated Depreciation
Liabilities: 2000 Accounts Payable, 2100 Output Sales Tax Payable, 2110 Withholding Tax Payable, 2200 Salaries Payable, 2210 EOBI and Other Statutory Payable, 2300 Other Payables, 2400 Customer Advances
Equity: 3000 Owner Capital, 3100 Retained Earnings, 3200 Owner Drawings
Revenue: 4000 Sales, 4090 Sales Returns and Discounts (contra), 4100 Other Income
Cost of sales: 5000 Cost of Goods Sold, 5010 Stock Adjustments and Write-offs
Expenses: 6000 Salaries, 6010 Rent, 6020 Utilities, 6030 Marketing, 6040 Office, 6050 Repairs, 6060 Bank Charges, 6070 Depreciation, 6900 Miscellaneous

## Posting rules (auto-posted on the server when a document syncs, same transaction as the applier)
- Sale (invoice.created): Dr Cash/Bank/Wallet/AR per payment; Cr Sales (net of tax); Cr Output Sales Tax; Dr COGS and Cr Inventory (sum of line quantity x batch cost).
- Return (credit_note.created): reverse the matching sale amounts (Dr Sales Returns, Dr Output Tax, Cr cash/AR; Dr Inventory, Cr COGS when stock is restocked).
- Purchase received (purchase.received): Dr Inventory, Dr Input Sales Tax (if recoverable, configurable), Cr Accounts Payable (supplier party).
- Supplier payment: Dr Accounts Payable, Cr Cash/Bank.
- Customer receipt on credit: Dr Cash/Bank, Cr Accounts Receivable (customer party).
- Expense: Dr Expense account, Cr Cash/Bank or Accounts Payable.
- Stock adjustment / expired write-off: Dr Stock Adjustments and Write-offs, Cr Inventory (reverse for gains).
- Supplier return: Dr Accounts Payable, Cr Inventory (and tax).
- Payroll run: Dr Salaries (and employer costs), Cr Salaries Payable, Cr statutory payables; payment: Dr Salaries Payable, Cr Cash/Bank.
- Tax treatment of medicines (exempt, reduced, standard, input tax recoverability) is configuration, not hardcoded. Confirm with an accountant.

## Acceptance tests (must exist)
1. After 1,000 random mixed transactions, trial balance debits equal credits and the balance sheet balances (assets = liabilities + equity + current period profit).
2. Every auto-posted document has exactly one balanced entry; replaying a sync event never creates a second one.
3. Stock value in the ledger equals the sum of (batch stock x batch cost) from stock movements.
4. Receivables and payables control accounts equal the sum of customer and supplier balances.
5. Posting into a closed period is rejected; editing or deleting any entry or line is rejected at the database level.
6. A cashier cannot reach finance routes; tenant isolation tests cover every new route.