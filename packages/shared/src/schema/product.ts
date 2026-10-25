import { z } from 'zod';
import { ProductSchema, TaxCategorySchema, type Product, type TaxCategory } from './index';

export const CreateProductInputSchema = z.object({
  brandName: z.string().min(1, 'Brand name is required'),
  genericName: z.string().min(1, 'Generic name is required'),
  strength: z.string().min(1, 'Strength is required'),
  form: z.string().min(1, 'Dosage form is required'),
  manufacturer: z.string().min(1, 'Manufacturer is required'),
  barcode: z
    .string()
    .trim()
    .transform((val) => (val === '' ? null : val))
    .nullable()
    .optional(),
  taxCategoryId: z.string().uuid('Valid tax category is required'),
  mrpPaisa: z.number().int('MRP must be in integer paisa').min(0, 'MRP cannot be negative'),
  isControlled: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export type CreateProductInput = z.infer<typeof CreateProductInputSchema>;

export const UpdateProductInputSchema = CreateProductInputSchema.partial();
export type UpdateProductInput = z.infer<typeof UpdateProductInputSchema>;

export const ProductSortBySchema = z.enum([
  'brand_name',
  'generic_name',
  'mrp_paisa',
  'created_at',
]);
export type ProductSortBy = z.infer<typeof ProductSortBySchema>;

export const SortOrderSchema = z.enum(['asc', 'desc']);
export type SortOrder = z.infer<typeof SortOrderSchema>;

export const ProductSearchParamsSchema = z.object({
  search: z.string().optional().default(''),
  sortBy: ProductSortBySchema.optional().default('brand_name'),
  sortOrder: SortOrderSchema.optional().default('asc'),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(200).optional().default(25),
});
export type ProductSearchParams = z.input<typeof ProductSearchParamsSchema>;
export type ProductSearchParamsOutput = z.infer<typeof ProductSearchParamsSchema>;

export interface ProductWithTax extends Product {
  taxCategoryName: string;
  taxRateBp: number;
}

export interface ProductListResult {
  products: ProductWithTax[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export { ProductSchema, TaxCategorySchema };
export type { Product, TaxCategory };
