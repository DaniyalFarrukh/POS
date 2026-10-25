import type { Database as DatabaseInstance } from 'better-sqlite3';
import { generateUuidV7 } from '@pos/shared';
import { getDatabase } from '../db';

interface SeedTemplate {
  brandName: string;
  genericName: string;
  strength: string;
  form: string;
  manufacturer: string;
  mrpPaisa: number;
  isControlled: boolean;
}

const BASE_MEDICINES: SeedTemplate[] = [
  // Analgesics & Antipyretics
  { brandName: 'Panadol', genericName: 'Paracetamol', strength: '500mg', form: 'tablet', manufacturer: 'GSK', mrpPaisa: 3500, isControlled: false },
  { brandName: 'Panadol Extra', genericName: 'Paracetamol + Caffeine', strength: '500mg/65mg', form: 'tablet', manufacturer: 'GSK', mrpPaisa: 4500, isControlled: false },
  { brandName: 'Panadol CF', genericName: 'Paracetamol + Pseudoephedrine', strength: '500mg/30mg', form: 'tablet', manufacturer: 'GSK', mrpPaisa: 5000, isControlled: false },
  { brandName: 'Disprin', genericName: 'Aspirin', strength: '300mg', form: 'tablet', manufacturer: 'Reckitt', mrpPaisa: 2500, isControlled: false },
  { brandName: 'Brufen', genericName: 'Ibuprofen', strength: '400mg', form: 'tablet', manufacturer: 'Abbott', mrpPaisa: 6000, isControlled: false },
  { brandName: 'Brufen DS', genericName: 'Ibuprofen', strength: '100mg/5ml', form: 'suspension', manufacturer: 'Abbott', mrpPaisa: 12000, isControlled: false },
  { brandName: 'Ponstan', genericName: 'Mefenamic Acid', strength: '500mg', form: 'tablet', manufacturer: 'Pfizer', mrpPaisa: 7500, isControlled: false },
  { brandName: 'Voltaren', genericName: 'Diclofenac Sodium', strength: '50mg', form: 'tablet', manufacturer: 'Novartis', mrpPaisa: 14000, isControlled: false },
  { brandName: 'Voltaren Emulgel', genericName: 'Diclofenac Diethylamine', strength: '1%', form: 'gel', manufacturer: 'Novartis', mrpPaisa: 25000, isControlled: false },
  { brandName: 'Brexin', genericName: 'Piroxicam-beta-cyclodextrin', strength: '20mg', form: 'tablet', manufacturer: 'Chiesi', mrpPaisa: 22000, isControlled: false },
  { brandName: 'Ansaid', genericName: 'Flurbiprofen', strength: '100mg', form: 'tablet', manufacturer: 'Pfizer', mrpPaisa: 18000, isControlled: false },
  { brandName: 'Nuberol Forte', genericName: 'Paracetamol + Orphenadrine', strength: '650mg/50mg', form: 'tablet', manufacturer: 'Searle', mrpPaisa: 15500, isControlled: false },
  { brandName: 'Tramal', genericName: 'Tramadol HCl', strength: '50mg', form: 'capsule', manufacturer: 'Searle', mrpPaisa: 32000, isControlled: true },

  // Antibiotics & Anti-infectives
  { brandName: 'Augmentin', genericName: 'Amoxicillin + Clavulanic Acid', strength: '625mg', form: 'tablet', manufacturer: 'GSK', mrpPaisa: 45000, isControlled: false },
  { brandName: 'Augmentin 1g', genericName: 'Amoxicillin + Clavulanic Acid', strength: '1000mg', form: 'tablet', manufacturer: 'GSK', mrpPaisa: 65000, isControlled: false },
  { brandName: 'Augmentin DS', genericName: 'Amoxicillin + Clavulanate', strength: '312.5mg/5ml', form: 'suspension', manufacturer: 'GSK', mrpPaisa: 28000, isControlled: false },
  { brandName: 'Amoxil', genericName: 'Amoxicillin', strength: '500mg', form: 'capsule', manufacturer: 'GSK', mrpPaisa: 22000, isControlled: false },
  { brandName: 'Amoxil Drops', genericName: 'Amoxicillin', strength: '100mg/ml', form: 'drops', manufacturer: 'GSK', mrpPaisa: 11000, isControlled: false },
  { brandName: 'Ciproxin', genericName: 'Ciprofloxacin', strength: '500mg', form: 'tablet', manufacturer: 'Bayer', mrpPaisa: 35000, isControlled: false },
  { brandName: 'Ciproxin Infusion', genericName: 'Ciprofloxacin', strength: '200mg/100ml', form: 'infusion', manufacturer: 'Bayer', mrpPaisa: 48000, isControlled: false },
  { brandName: 'Klaricid', genericName: 'Clarithromycin', strength: '500mg', form: 'tablet', manufacturer: 'Abbott', mrpPaisa: 75000, isControlled: false },
  { brandName: 'Klaricid Suspension', genericName: 'Clarithromycin', strength: '125mg/5ml', form: 'suspension', manufacturer: 'Abbott', mrpPaisa: 38000, isControlled: false },
  { brandName: 'Leflox', genericName: 'Levofloxacin', strength: '500mg', form: 'tablet', manufacturer: 'Getz Pharma', mrpPaisa: 38000, isControlled: false },
  { brandName: 'Leflox 250mg', genericName: 'Levofloxacin', strength: '250mg', form: 'tablet', manufacturer: 'Getz Pharma', mrpPaisa: 22000, isControlled: false },
  { brandName: 'Moxiget', genericName: 'Moxifloxacin', strength: '400mg', form: 'tablet', manufacturer: 'Getz Pharma', mrpPaisa: 52000, isControlled: false },
  { brandName: 'Flagyl', genericName: 'Metronidazole', strength: '400mg', form: 'tablet', manufacturer: 'Sanofi', mrpPaisa: 8000, isControlled: false },
  { brandName: 'Flagyl Suspension', genericName: 'Metronidazole Benzoate', strength: '200mg/5ml', form: 'suspension', manufacturer: 'Sanofi', mrpPaisa: 12000, isControlled: false },
  { brandName: 'Azomax', genericName: 'Azithromycin', strength: '500mg', form: 'tablet', manufacturer: 'Bosch', mrpPaisa: 42000, isControlled: false },
  { brandName: 'Azomax Suspension', genericName: 'Azithromycin', strength: '200mg/5ml', form: 'suspension', manufacturer: 'Bosch', mrpPaisa: 26000, isControlled: false },
  { brandName: 'Velosef', genericName: 'Cephradine', strength: '500mg', form: 'capsule', manufacturer: 'GSK', mrpPaisa: 30000, isControlled: false },
  { brandName: 'Velosef Injection', genericName: 'Cephradine', strength: '1g', form: 'injection', manufacturer: 'GSK', mrpPaisa: 28000, isControlled: false },
  { brandName: 'Ceclor', genericName: 'Cefaclor', strength: '250mg/5ml', form: 'suspension', manufacturer: 'Pharmatec', mrpPaisa: 46000, isControlled: false },
  { brandName: 'Rocephin', genericName: 'Ceftriaxone', strength: '1g', form: 'injection', manufacturer: 'Roche', mrpPaisa: 85000, isControlled: false },

  // Gastrointestinal & Antacids
  { brandName: 'Risek', genericName: 'Omeprazole', strength: '20mg', form: 'capsule', manufacturer: 'Getz Pharma', mrpPaisa: 28000, isControlled: false },
  { brandName: 'Risek 40mg', genericName: 'Omeprazole', strength: '40mg', form: 'capsule', manufacturer: 'Getz Pharma', mrpPaisa: 48000, isControlled: false },
  { brandName: 'Risek Insta', genericName: 'Omeprazole + Sodium Bicarbonate', strength: '20mg', form: 'sachet', manufacturer: 'Getz Pharma', mrpPaisa: 35000, isControlled: false },
  { brandName: 'Nexum', genericName: 'Esomeprazole', strength: '40mg', form: 'tablet', manufacturer: 'Getz Pharma', mrpPaisa: 52000, isControlled: false },
  { brandName: 'Nexum 20mg', genericName: 'Esomeprazole', strength: '20mg', form: 'tablet', manufacturer: 'Getz Pharma', mrpPaisa: 32000, isControlled: false },
  { brandName: 'Gaviscon', genericName: 'Sodium Alginate + Potassium Bicarb', strength: '120ml', form: 'syrup', manufacturer: 'Reckitt', mrpPaisa: 18000, isControlled: false },
  { brandName: 'Gaviscon Double Action', genericName: 'Sodium Alginate Complex', strength: '150ml', form: 'syrup', manufacturer: 'Reckitt', mrpPaisa: 24000, isControlled: false },
  { brandName: 'Motilium', genericName: 'Domperidone', strength: '10mg', form: 'tablet', manufacturer: 'Janssen', mrpPaisa: 11000, isControlled: false },
  { brandName: 'Motilium Suspension', genericName: 'Domperidone', strength: '5mg/5ml', form: 'suspension', manufacturer: 'Janssen', mrpPaisa: 14000, isControlled: false },
  { brandName: 'Gravinate', genericName: 'Dimenhydrinate', strength: '50mg', form: 'tablet', manufacturer: 'Searle', mrpPaisa: 6000, isControlled: false },
  { brandName: 'Hydryllin', genericName: 'Diphenhydramine + Aminophylline', strength: '120ml', form: 'syrup', manufacturer: 'Searle', mrpPaisa: 13000, isControlled: false },
  { brandName: 'Duspatalin', genericName: 'Mebeverine HCl', strength: '135mg', form: 'tablet', manufacturer: 'Abbott', mrpPaisa: 38000, isControlled: false },

  // Allergy, Cold & Respiratory
  { brandName: 'Arinac', genericName: 'Ibuprofen + Pseudoephedrine', strength: '200mg/30mg', form: 'tablet', manufacturer: 'Abbott', mrpPaisa: 9500, isControlled: false },
  { brandName: 'Arinac Forte', genericName: 'Ibuprofen + Pseudoephedrine', strength: '400mg/60mg', form: 'tablet', manufacturer: 'Abbott', mrpPaisa: 16000, isControlled: false },
  { brandName: 'Zyrtec', genericName: 'Cetirizine HCl', strength: '10mg', form: 'tablet', manufacturer: 'GSK', mrpPaisa: 14000, isControlled: false },
  { brandName: 'Softin', genericName: 'Loratadine', strength: '10mg', form: 'tablet', manufacturer: 'Searle', mrpPaisa: 16500, isControlled: false },
  { brandName: 'Rigix', genericName: 'Cetirizine HCl', strength: '10mg', form: 'tablet', manufacturer: 'AGP', mrpPaisa: 12000, isControlled: false },
  { brandName: 'Kestine', genericName: 'Ebastine', strength: '20mg', form: 'tablet', manufacturer: 'Searle', mrpPaisa: 34000, isControlled: false },
  { brandName: 'Ventolin', genericName: 'Salbutamol', strength: '100mcg', form: 'inhaler', manufacturer: 'GSK', mrpPaisa: 42000, isControlled: false },
  { brandName: 'Ventolin Syrup', genericName: 'Salbutamol', strength: '2mg/5ml', form: 'syrup', manufacturer: 'GSK', mrpPaisa: 11000, isControlled: false },
  { brandName: 'Sancos', genericName: 'Pholcodine + Pseudoephedrine', strength: '120ml', form: 'syrup', manufacturer: 'Novartis', mrpPaisa: 17500, isControlled: false },
  { brandName: 'Pulmonol', genericName: 'Herbal Antitussive Compound', strength: '120ml', form: 'syrup', manufacturer: 'Ccl', mrpPaisa: 14000, isControlled: false },

  // Cardiovascular & Metabolism
  { brandName: 'Loprin', genericName: 'Low Dose Aspirin', strength: '75mg', form: 'tablet', manufacturer: 'Highnoon', mrpPaisa: 6500, isControlled: false },
  { brandName: 'Concor', genericName: 'Bisoprolol Fumarate', strength: '5mg', form: 'tablet', manufacturer: 'Merck', mrpPaisa: 42000, isControlled: false },
  { brandName: 'Concor 2.5mg', genericName: 'Bisoprolol Fumarate', strength: '2.5mg', form: 'tablet', manufacturer: 'Merck', mrpPaisa: 28000, isControlled: false },
  { brandName: 'Tenormin', genericName: 'Atenolol', strength: '50mg', form: 'tablet', manufacturer: 'AstraZeneca', mrpPaisa: 36000, isControlled: false },
  { brandName: 'Lipitor', genericName: 'Atorvastatin', strength: '20mg', form: 'tablet', manufacturer: 'Pfizer', mrpPaisa: 98000, isControlled: false },
  { brandName: 'Atorva', genericName: 'Atorvastatin', strength: '10mg', form: 'tablet', manufacturer: 'Getz Pharma', mrpPaisa: 45000, isControlled: false },
  { brandName: 'Glucophage', genericName: 'Metformin HCl', strength: '500mg', form: 'tablet', manufacturer: 'Merck', mrpPaisa: 15000, isControlled: false },
  { brandName: 'Glucophage 1g', genericName: 'Metformin HCl', strength: '1000mg', form: 'tablet', manufacturer: 'Merck', mrpPaisa: 26000, isControlled: false },
  { brandName: 'Getryl', genericName: 'Glimepiride', strength: '2mg', form: 'tablet', manufacturer: 'Getz Pharma', mrpPaisa: 24000, isControlled: false },
  { brandName: 'Getryl 4mg', genericName: 'Glimepiride', strength: '4mg', form: 'tablet', manufacturer: 'Getz Pharma', mrpPaisa: 38000, isControlled: false },

  // Vitamins & Supplements
  { brandName: 'Surbex Z', genericName: 'Zinc + Vitamin B-Complex + C + E', strength: 'Standard', form: 'tablet', manufacturer: 'Abbott', mrpPaisa: 32000, isControlled: false },
  { brandName: 'Cac 1000 Plus', genericName: 'Calcium Carbonate + Vit C, D3, B6', strength: '1000mg', form: 'tablet', manufacturer: 'GSK', mrpPaisa: 36000, isControlled: false },
  { brandName: 'Sangobion', genericName: 'Ferrous Gluconate + Vit C & B12', strength: 'Standard', form: 'capsule', manufacturer: 'Merck', mrpPaisa: 28000, isControlled: false },
  { brandName: 'Neurobion', genericName: 'Vitamin B1 + B6 + B12', strength: 'Standard', form: 'tablet', manufacturer: 'Merck', mrpPaisa: 22000, isControlled: false },
  { brandName: 'Evion', genericName: 'Vitamin E', strength: '400mg', form: 'capsule', manufacturer: 'Merck', mrpPaisa: 34000, isControlled: false },

  // Controlled Drugs (Strictly flagged isControlled: true per task requirements)
  { brandName: 'Xanax', genericName: 'Alprazolam', strength: '0.5mg', form: 'tablet', manufacturer: 'Pfizer', mrpPaisa: 28000, isControlled: true },
  { brandName: 'Xanax 1mg', genericName: 'Alprazolam', strength: '1mg', form: 'tablet', manufacturer: 'Pfizer', mrpPaisa: 46000, isControlled: true },
  { brandName: 'Lexotanil', genericName: 'Bromazepam', strength: '3mg', form: 'tablet', manufacturer: 'Roche', mrpPaisa: 32000, isControlled: true },
  { brandName: 'Rivotril', genericName: 'Clonazepam', strength: '2mg', form: 'tablet', manufacturer: 'Roche', mrpPaisa: 38000, isControlled: true },
  { brandName: 'Valium', genericName: 'Diazepam', strength: '5mg', form: 'tablet', manufacturer: 'Roche', mrpPaisa: 24000, isControlled: true },
  { brandName: 'Dormicum', genericName: 'Midazolam', strength: '7.5mg', form: 'tablet', manufacturer: 'Roche', mrpPaisa: 42000, isControlled: true },
];

export function generateSeedProducts(count: number = 200): SeedTemplate[] {
  const result: SeedTemplate[] = [];
  const baseLen = BASE_MEDICINES.length;

  for (let i = 0; i < count; i++) {
    const base = BASE_MEDICINES[i % baseLen]!;
    const suffix = i >= baseLen ? ` (Batch ${Math.floor(i / baseLen) + 1})` : '';

    result.push({
      brandName: `${base.brandName}${suffix}`,
      genericName: base.genericName,
      strength: base.strength,
      form: base.form,
      manufacturer: base.manufacturer,
      mrpPaisa: base.mrpPaisa + (i % 5) * 500, // slight realistic price variation
      isControlled: base.isControlled,
    });
  }

  return result;
}

export function seedDatabase(rawDb?: DatabaseInstance): { seededCount: number; defaultTaxCategoryId: string } {
  const db = rawDb ?? getDatabase();
  const now = new Date().toISOString();

  // 1. Ensure standard tax categories exist
  let taxRow = db.prepare('SELECT id FROM tax_categories LIMIT 1').get() as { id: string } | undefined;
  if (!taxRow) {
    const taxId = generateUuidV7();
    db.prepare(`
      INSERT INTO tax_categories (id, name, rate_bp, is_exempt, created_at, updated_at)
      VALUES (?, 'Standard GST (18%)', 1800, 0, ?, ?)
    `).run(taxId, now, now);

    db.prepare(`
      INSERT INTO tax_categories (id, name, rate_bp, is_exempt, created_at, updated_at)
      VALUES (?, 'Exempt Life Saving Drugs', 0, 1, ?, ?)
    `).run(generateUuidV7(), now, now);

    taxRow = { id: taxId };
  }

  const defaultTaxCategoryId = taxRow.id;

  // 2. Seed suppliers if empty
  const supplierCountRow = db.prepare('SELECT COUNT(*) as count FROM suppliers').get() as {
    count: number;
  };
  if (supplierCountRow.count === 0) {
    const insertSupplier = db.prepare(`
      INSERT INTO suppliers (id, name, contact_person, phone, email, address, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const standardSuppliers = [
      {
        name: 'Muller & Phipps Pakistan (Pvt) Ltd',
        contactPerson: 'Tariq Mehmood',
        phone: '021-35681122',
        email: 'orders@mulphico.pk',
        address: 'Plot 24, Korangi Industrial Area, Karachi',
      },
      {
        name: 'Searle Distributors Pakistan',
        contactPerson: 'Farhan Ahmed',
        phone: '042-35882200',
        email: 'dist@searlecompany.com',
        address: '14-B, Gulberg II, Lahore',
      },
      {
        name: 'GSK Consumer Healthcare Distribution',
        contactPerson: 'Asim Khan',
        phone: '021-111475725',
        email: 'gsk.supply@gsk.com',
        address: 'Dockyard Road, West Wharf, Karachi',
      },
      {
        name: 'Ali Gohar & Company (Pvt) Ltd',
        contactPerson: 'Bilal Sheikh',
        phone: '051-5471188',
        email: 'info@aligohar.com',
        address: 'I-9/2 Industrial Area, Islamabad/Rawalpindi',
      },
      {
        name: 'Premier Agencies Pharma Distribution',
        contactPerson: 'Imran Raza',
        phone: '041-8549922',
        email: 'orders@premieragencies.pk',
        address: 'Satyana Road, Peoples Colony, Faisalabad',
      },
    ];

    const seedSuppliersTx = db.transaction(() => {
      for (const s of standardSuppliers) {
        insertSupplier.run(
          generateUuidV7(),
          s.name,
          s.contactPerson,
          s.phone,
          s.email,
          s.address,
          now,
          now
        );
      }
    });
    seedSuppliersTx();
  }

  // 3. Check existing count of products
  const countRow = db.prepare('SELECT COUNT(*) as count FROM products').get() as { count: number };
  if (countRow.count >= 200) {
    return { seededCount: 0, defaultTaxCategoryId };
  }

  const needed = 200 - countRow.count;
  const items = generateSeedProducts(needed);

  // Rule 5: Writes touching multiple rows happen in ONE transaction
  const insertProductStmt = db.prepare(`
    INSERT INTO products (
      id, brand_name, generic_name, strength, form, manufacturer,
      barcode, tax_category_id, mrp_paisa, is_controlled, is_active,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);

  const seedTx = db.transaction(() => {
    let barcodeSeq = 896400010000 + countRow.count;
    for (const item of items) {
      barcodeSeq++;
      insertProductStmt.run(
        generateUuidV7(),
        item.brandName,
        item.genericName,
        item.strength,
        item.form,
        item.manufacturer,
        String(barcodeSeq),
        defaultTaxCategoryId,
        item.mrpPaisa,
        item.isControlled ? 1 : 0,
        now,
        now
      );
    }
  });

  seedTx();
  return { seededCount: items.length, defaultTaxCategoryId };
}
