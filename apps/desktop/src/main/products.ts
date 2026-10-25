import type { Database as DatabaseInstance } from 'better-sqlite3';
import {
  generateUuidV7,
  type CreateProductInput,
  type UpdateProductInput,
  type ProductSearchParams,
  type ProductWithTax,
  type ProductListResult,
  type TaxCategory,
  CreateProductInputSchema,
  UpdateProductInputSchema,
  ProductSearchParamsSchema,
} from '@pos/shared';
import { getDatabase } from './db';
import { requireRole } from './auth';

export interface CsvImportSummary {
  importedCount: number;
  skippedCount: number;
  errors: { rowNumber: number; barcode?: string; reason: string }[];
}

export function getTaxCategories(rawDb?: DatabaseInstance): TaxCategory[] {
  const db = rawDb ?? getDatabase();
  const rows = db
    .prepare('SELECT id, name, rate_bp, is_exempt, created_at, updated_at FROM tax_categories ORDER BY name ASC')
    .all() as {
    id: string;
    name: string;
    rate_bp: number;
    is_exempt: number;
    created_at: string;
    updated_at: string;
  }[];

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    rateBp: r.rate_bp,
    isExempt: r.is_exempt === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/**
 * Fast paginated and sortable product query optimized for 20,000+ items using indexed columns.
 */
export function getProducts(
  params: ProductSearchParams,
  rawDb?: DatabaseInstance
): ProductListResult {
  const validated = ProductSearchParamsSchema.parse(params);
  const db = rawDb ?? getDatabase();

  const search = validated.search.trim();
  const page = Math.max(1, validated.page);
  const pageSize = Math.max(1, Math.min(200, validated.pageSize));
  const offset = (page - 1) * pageSize;

  let whereClause = '';
  const queryParams: unknown[] = [];

  if (search.length > 0) {
    whereClause = `
      WHERE (
        p.brand_name LIKE ? OR
        p.generic_name LIKE ? OR
        p.barcode LIKE ?
      )
    `;
    const wildcard = `%${search}%`;
    queryParams.push(wildcard, wildcard, `${search}%`);
  }

  // Whitelist sort columns to prevent SQL injection
  const sortColumnMap: Record<string, string> = {
    brand_name: 'p.brand_name',
    generic_name: 'p.generic_name',
    mrp_paisa: 'p.mrp_paisa',
    created_at: 'p.created_at',
  };
  const sortCol = sortColumnMap[validated.sortBy] ?? 'p.brand_name';
  const sortDir = validated.sortOrder.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

  // 1. Get total count
  const countSql = `SELECT COUNT(*) as total FROM products p ${whereClause}`;
  const countRow = db.prepare(countSql).get(...queryParams) as { total: number };
  const totalCount = countRow ? countRow.total : 0;
  const totalPages = Math.ceil(totalCount / pageSize) || 1;

  // 2. Fetch paginated records with Tax Category join
  const dataSql = `
    SELECT
      p.id, p.brand_name, p.generic_name, p.strength, p.form, p.manufacturer,
      p.barcode, p.tax_category_id, p.mrp_paisa, p.is_controlled, p.is_active,
      p.created_at, p.updated_at,
      tc.name as tax_category_name,
      tc.rate_bp as tax_rate_bp
    FROM products p
    INNER JOIN tax_categories tc ON p.tax_category_id = tc.id
    ${whereClause}
    ORDER BY ${sortCol} ${sortDir}
    LIMIT ? OFFSET ?
  `;

  const rows = db.prepare(dataSql).all(...queryParams, pageSize, offset) as {
    id: string;
    brand_name: string;
    generic_name: string;
    strength: string;
    form: string;
    manufacturer: string;
    barcode: string | null;
    tax_category_id: string;
    mrp_paisa: number;
    is_controlled: number;
    is_active: number;
    created_at: string;
    updated_at: string;
    tax_category_name: string;
    tax_rate_bp: number;
  }[];

  const products: ProductWithTax[] = rows.map((r) => ({
    id: r.id,
    brandName: r.brand_name,
    genericName: r.generic_name,
    strength: r.strength,
    form: r.form,
    manufacturer: r.manufacturer,
    barcode: r.barcode,
    taxCategoryId: r.tax_category_id,
    mrpPaisa: r.mrp_paisa,
    isControlled: r.is_controlled === 1,
    isActive: r.is_active === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    taxCategoryName: r.tax_category_name,
    taxRateBp: r.tax_rate_bp,
  }));

  return {
    products,
    totalCount,
    page,
    pageSize,
    totalPages,
  };
}

export function getProduct(id: string, rawDb?: DatabaseInstance): ProductWithTax | null {
  const db = rawDb ?? getDatabase();
  const row = db
    .prepare(`
      SELECT
        p.id, p.brand_name, p.generic_name, p.strength, p.form, p.manufacturer,
        p.barcode, p.tax_category_id, p.mrp_paisa, p.is_controlled, p.is_active,
        p.created_at, p.updated_at,
        tc.name as tax_category_name,
        tc.rate_bp as tax_rate_bp
      FROM products p
      INNER JOIN tax_categories tc ON p.tax_category_id = tc.id
      WHERE p.id = ?
    `)
    .get(id) as
    | {
        id: string;
        brand_name: string;
        generic_name: string;
        strength: string;
        form: string;
        manufacturer: string;
        barcode: string | null;
        tax_category_id: string;
        mrp_paisa: number;
        is_controlled: number;
        is_active: number;
        created_at: string;
        updated_at: string;
        tax_category_name: string;
        tax_rate_bp: number;
      }
    | undefined;

  if (!row) return null;

  return {
    id: row.id,
    brandName: row.brand_name,
    genericName: row.generic_name,
    strength: row.strength,
    form: row.form,
    manufacturer: row.manufacturer,
    barcode: row.barcode,
    taxCategoryId: row.tax_category_id,
    mrpPaisa: row.mrp_paisa,
    isControlled: row.is_controlled === 1,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    taxCategoryName: row.tax_category_name,
    taxRateBp: row.tax_rate_bp,
  };
}

export function createProduct(
  input: CreateProductInput,
  rawDb?: DatabaseInstance
): ProductWithTax {
  const data = CreateProductInputSchema.parse(input);
  const db = rawDb ?? getDatabase();

  // Check unique barcode if barcode provided
  if (data.barcode) {
    const existing = db
      .prepare('SELECT id FROM products WHERE barcode = ?')
      .get(data.barcode) as { id: string } | undefined;
    if (existing) {
      throw new Error(`A product with barcode '${data.barcode}' already exists.`);
    }
  }

  const id = generateUuidV7();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO products (
      id, brand_name, generic_name, strength, form, manufacturer,
      barcode, tax_category_id, mrp_paisa, is_controlled, is_active,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.brandName,
    data.genericName,
    data.strength,
    data.form,
    data.manufacturer,
    data.barcode ?? null,
    data.taxCategoryId,
    data.mrpPaisa,
    data.isControlled ? 1 : 0,
    data.isActive ? 1 : 0,
    now,
    now
  );

  const created = getProduct(id, db);
  if (!created) throw new Error('Failed to retrieve newly created product.');
  return created;
}

export function updateProduct(
  id: string,
  input: UpdateProductInput,
  rawDb?: DatabaseInstance
): ProductWithTax {
  const data = UpdateProductInputSchema.parse(input);
  const db = rawDb ?? getDatabase();

  const current = getProduct(id, db);
  if (!current) throw new Error(`Product with ID '${id}' not found.`);

  // Check barcode collision if barcode being modified
  if (data.barcode && data.barcode !== current.barcode) {
    const existing = db
      .prepare('SELECT id FROM products WHERE barcode = ? AND id != ?')
      .get(data.barcode, id) as { id: string } | undefined;
    if (existing) {
      throw new Error(`A product with barcode '${data.barcode}' already exists.`);
    }
  }

  const now = new Date().toISOString();

  db.prepare(`
    UPDATE products SET
      brand_name = COALESCE(?, brand_name),
      generic_name = COALESCE(?, generic_name),
      strength = COALESCE(?, strength),
      form = COALESCE(?, form),
      manufacturer = COALESCE(?, manufacturer),
      barcode = COALESCE(?, barcode),
      tax_category_id = COALESCE(?, tax_category_id),
      mrp_paisa = COALESCE(?, mrp_paisa),
      is_controlled = COALESCE(?, is_controlled),
      is_active = COALESCE(?, is_active),
      updated_at = ?
    WHERE id = ?
  `).run(
    data.brandName ?? null,
    data.genericName ?? null,
    data.strength ?? null,
    data.form ?? null,
    data.manufacturer ?? null,
    data.barcode !== undefined ? data.barcode : null,
    data.taxCategoryId ?? null,
    data.mrpPaisa ?? null,
    data.isControlled !== undefined ? (data.isControlled ? 1 : 0) : null,
    data.isActive !== undefined ? (data.isActive ? 1 : 0) : null,
    now,
    id
  );

  const updated = getProduct(id, db);
  if (!updated) throw new Error('Failed to retrieve updated product.');
  return updated;
}

/**
 * Bulk imports products from CSV in a single transaction (Rule 5).
 * Detects and skips barcode duplicates against existing DB records.
 */
export function importProductsCsv(
  items: CreateProductInput[],
  rawDb?: DatabaseInstance
): CsvImportSummary {
  const db = rawDb ?? getDatabase();
  const now = new Date().toISOString();

  // Find all existing barcodes to skip collisions
  const existingRows = db.prepare('SELECT barcode FROM products WHERE barcode IS NOT NULL').all() as {
    barcode: string;
  }[];
  const existingBarcodes = new Set(existingRows.map((r) => r.barcode));

  const insertStmt = db.prepare(`
    INSERT INTO products (
      id, brand_name, generic_name, strength, form, manufacturer,
      barcode, tax_category_id, mrp_paisa, is_controlled, is_active,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);

  let importedCount = 0;
  let skippedCount = 0;
  const errors: { rowNumber: number; barcode?: string; reason: string }[] = [];

  // Rule 5: Writes touching multiple rows happen in ONE transaction
  const importTx = db.transaction(() => {
    items.forEach((item, idx) => {
      const rowNumber = idx + 2;

      if (item.barcode && existingBarcodes.has(item.barcode)) {
        skippedCount++;
        errors.push({
          rowNumber,
          barcode: item.barcode,
          reason: `Barcode '${item.barcode}' already exists in database`,
        });
        return;
      }

      insertStmt.run(
        generateUuidV7(),
        item.brandName,
        item.genericName,
        item.strength,
        item.form,
        item.manufacturer,
        item.barcode ?? null,
        item.taxCategoryId,
        item.mrpPaisa,
        item.isControlled ? 1 : 0,
        now,
        now
      );

      if (item.barcode) {
        existingBarcodes.add(item.barcode);
      }
      importedCount++;
    });
  });

  importTx();

  return {
    importedCount,
    skippedCount,
    errors,
  };
}

// Role-guarded IPC wrapper functions
export const roleGuardedCreateProduct = requireRole(
  ['pharmacist', 'owner'],
  async (_session, input: CreateProductInput) => createProduct(input)
);

export const roleGuardedUpdateProduct = requireRole(
  ['pharmacist', 'owner'],
  async (_session, id: string, input: UpdateProductInput) => updateProduct(id, input)
);

export const roleGuardedImportCsv = requireRole(
  ['pharmacist', 'owner'],
  async (_session, rows: CreateProductInput[]) => importProductsCsv(rows)
);
