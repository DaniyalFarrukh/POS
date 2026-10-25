import { initDatabase } from '../db';
import { seedDatabase } from './seed';

console.log('[Seed CLI] Initializing database...');
initDatabase();
console.log('[Seed CLI] Seeding 200 realistic pharmacy products...');
const res = seedDatabase();
console.log(`[Seed CLI] Done! Seeded ${res.seededCount} products into database.`);
process.exit(0);
