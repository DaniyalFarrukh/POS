import { z } from 'zod';

export const PrescriptionItemInputSchema = z.object({
  id: z.string().uuid().optional(),
  productId: z.string().uuid('Product ID must be a valid UUID'),
  dosageInstructions: z.string().min(1, 'Dosage instructions are required'),
  quantityPrescribed: z.number().int().min(1, 'Quantity prescribed must be >= 1'),
  daysSupply: z.number().int().min(1, 'Days supply must be >= 1').default(30),
  isControlled: z.boolean().default(false),
  notes: z.string().nullable().optional(),
});
export type PrescriptionItemInput = z.infer<typeof PrescriptionItemInputSchema>;

export const CreatePrescriptionInputSchema = z.object({
  customerId: z.string().uuid().nullable().optional(),
  patientName: z.string().min(1, 'Patient name is required').max(200),
  patientPhone: z.string().nullable().optional(),
  patientAge: z.number().int().min(0).max(150).nullable().optional(),
  patientGender: z.enum(['male', 'female', 'other']).nullable().optional(),
  doctorName: z.string().max(200).nullable().optional(),
  doctorRegistrationNumber: z.string().max(100).nullable().optional(),
  doctorClinic: z.string().max(255).nullable().optional(),
  prescriptionDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Prescription date must be YYYY-MM-DD format'),
  diagnosis: z.string().nullable().optional(),
  repeatCount: z.number().int().min(0).default(0),
  refillIntervalDays: z.number().int().min(1).default(30),
  isControlledDrug: z.boolean().default(false),
  invoiceId: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  items: z
    .array(PrescriptionItemInputSchema)
    .min(1, 'Prescription must contain at least 1 prescribed medicine'),
});
export type CreatePrescriptionInput = z.infer<typeof CreatePrescriptionInputSchema>;

export const UpdatePrescriptionInputSchema = z.object({
  patientName: z.string().min(1).max(200).optional(),
  patientPhone: z.string().nullable().optional(),
  patientAge: z.number().int().min(0).max(150).nullable().optional(),
  patientGender: z.enum(['male', 'female', 'other']).nullable().optional(),
  doctorName: z.string().max(200).nullable().optional(),
  doctorRegistrationNumber: z.string().max(100).nullable().optional(),
  doctorClinic: z.string().max(255).nullable().optional(),
  diagnosis: z.string().nullable().optional(),
  repeatCount: z.number().int().min(0).optional(),
  refillIntervalDays: z.number().int().min(1).optional(),
  isControlledDrug: z.boolean().optional(),
  status: z.enum(['active', 'fulfilled', 'cancelled', 'expired']).optional(),
  notes: z.string().nullable().optional(),
});
export type UpdatePrescriptionInput = z.infer<typeof UpdatePrescriptionInputSchema>;

export const DispensePrescriptionInputSchema = z.object({
  invoiceId: z.string().uuid('Valid invoice ID is required'),
  notes: z.string().nullable().optional(),
});
export type DispensePrescriptionInput = z.infer<typeof DispensePrescriptionInputSchema>;

export const RefillReminderQuerySchema = z.object({
  daysAhead: z.coerce.number().int().min(1).max(90).default(7),
  isControlled: z.enum(['true', 'false']).optional(),
});
export type RefillReminderQuery = z.infer<typeof RefillReminderQuerySchema>;
