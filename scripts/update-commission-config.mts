import 'dotenv/config';
import { getDb } from '../db/client.js';
import { commissionConfig } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const db = getDb();

const result = await db
  .update(commissionConfig)
  .set({
    l1Tiers: [{ min: 0, bps: 3000 }, { min: 10, bps: 5000 }],
    l2Bps: 1000,
  })
  .where(eq(commissionConfig.id, 1))
  .returning();

console.log('Updated:', JSON.stringify(result[0], null, 2));
process.exit(0);
