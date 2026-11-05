import type { FastifyPluginAsync } from 'fastify';
import { eq, and, or, ilike } from 'drizzle-orm';
import { hasPermission } from '@pos/shared';
import type { GlobalSearchResultItem, GlobalSearchResponse } from '@pos/shared';
import { requirePermission } from '../auth/user-auth';
import { getDb } from '../db';
import { products, suppliers, customers, invoices } from '../db/schema';

export const searchRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/search?q=:query
   * Global search across invoices, customers, products, suppliers
   * Strictly scopes every query by JWT pharmacy_id.
   * Filters out entities the caller's role is not permitted to access.
   */
  fastify.get<{ Querystring: { q?: string } }>(
    '/',
    { preHandler: [requirePermission('auth.me.view')] },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const query = (request.query.q || '').trim();

      if (!query || query.length < 2) {
        return reply.status(200).send({
          query,
          results: {
            invoices: [],
            customers: [],
            products: [],
            suppliers: [],
          },
          totalCount: 0,
        });
      }

      const { role, pharmacyId } = userContext;
      const searchPattern = `%${query}%`;

      // 1. Invoices (Permitted if role can view sales or invoices or is owner/manager/cashier/pharmacist/accountant)
      const canViewInvoices =
        hasPermission(role, 'sales.invoice.view') ||
        hasPermission(role, 'reports.sales.view') ||
        ['owner', 'manager', 'accountant', 'pharmacist', 'cashier'].includes(role);

      let invoiceItems: GlobalSearchResultItem[] = [];
      if (canViewInvoices) {
        const invoiceRows = await db
          .select({
            id: invoices.id,
            invoiceNumber: invoices.invoiceNumber,
            totalPaisa: invoices.totalPaisa,
            createdAt: invoices.createdAt,
          })
          .from(invoices)
          .where(
            and(eq(invoices.pharmacyId, pharmacyId), ilike(invoices.invoiceNumber, searchPattern))
          )
          .limit(10);

        invoiceItems = invoiceRows.map((inv) => ({
          id: inv.id,
          type: 'invoice',
          title: inv.invoiceNumber,
          subtitle: `Total: Rs. ${(inv.totalPaisa / 100).toFixed(2)} • ${inv.createdAt.slice(0, 10)}`,
          meta: { totalPaisa: inv.totalPaisa, invoiceNumber: inv.invoiceNumber },
          link: `/sales-ledger?invoiceId=${inv.id}`,
        }));
      }

      // 2. Customers (Permitted if role has customer access or is owner/manager/accountant/pharmacist)
      // Cashier can only see customers if specifically searching at POS, but here cashier doesn't have CRM manage
      const canViewCustomers = ['owner', 'manager', 'accountant', 'pharmacist'].includes(role);

      let customerItems: GlobalSearchResultItem[] = [];
      if (canViewCustomers) {
        const customerRows = await db
          .select({
            id: customers.id,
            name: customers.name,
            phone: customers.phone,
          })
          .from(customers)
          .where(
            and(
              eq(customers.pharmacyId, pharmacyId),
              or(ilike(customers.name, searchPattern), ilike(customers.phone, searchPattern))
            )
          )
          .limit(10);

        customerItems = customerRows.map((c) => ({
          id: c.id,
          type: 'customer',
          title: c.name,
          subtitle: `Phone: ${c.phone}`,
          meta: { phone: c.phone },
          link: `/customers?customerId=${c.id}`,
        }));
      }

      // 3. Products (Permitted for all authenticated users)
      const productRows = await db
        .select({
          id: products.id,
          brandName: products.brandName,
          genericName: products.genericName,
          barcode: products.barcode,
          mrpPaisa: products.mrpPaisa,
        })
        .from(products)
        .where(
          and(
            eq(products.pharmacyId, pharmacyId),
            or(
              ilike(products.brandName, searchPattern),
              ilike(products.genericName, searchPattern),
              eq(products.barcode, query)
            )
          )
        )
        .limit(10);

      const productItems: GlobalSearchResultItem[] = productRows.map((p) => ({
        id: p.id,
        type: 'product',
        title: p.brandName,
        subtitle: `${p.genericName || 'Medicine'} • MRP Rs. ${(p.mrpPaisa / 100).toFixed(2)}`,
        meta: { genericName: p.genericName, barcode: p.barcode, mrpPaisa: p.mrpPaisa },
        link: `/stock-management?productId=${p.id}`,
      }));

      // 4. Suppliers (Owner, Manager, Pharmacist, Accountant only — Cashier is strictly excluded)
      const canViewSuppliers = ['owner', 'manager', 'accountant', 'pharmacist'].includes(role);

      let supplierItems: GlobalSearchResultItem[] = [];
      if (canViewSuppliers) {
        const supplierRows = await db
          .select({
            id: suppliers.id,
            name: suppliers.name,
            contactPerson: suppliers.contactPerson,
            phone: suppliers.phone,
          })
          .from(suppliers)
          .where(
            and(
              eq(suppliers.pharmacyId, pharmacyId),
              or(
                ilike(suppliers.name, searchPattern),
                ilike(suppliers.contactPerson, searchPattern),
                ilike(suppliers.phone, searchPattern)
              )
            )
          )
          .limit(10);

        supplierItems = supplierRows.map((s) => ({
          id: s.id,
          type: 'supplier',
          title: s.name,
          subtitle: `${s.contactPerson || 'Vendor'} • ${s.phone || 'No phone'}`,
          meta: { contactPerson: s.contactPerson, phone: s.phone },
          link: `/suppliers?supplierId=${s.id}`,
        }));
      }

      const response: GlobalSearchResponse = {
        query,
        results: {
          invoices: invoiceItems,
          customers: customerItems,
          products: productItems,
          suppliers: supplierItems,
        },
        totalCount:
          invoiceItems.length + customerItems.length + productItems.length + supplierItems.length,
      };

      return reply.status(200).send(response);
    }
  );
};
