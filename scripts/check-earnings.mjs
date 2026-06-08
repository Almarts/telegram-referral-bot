import { getDb } from '@/db/client';
import { commissionLedger, invoices, users } from '@/db/schema';
import { eq, and, sql } from 'drizzle-orm';

const db = getDb();
const myId = '607645943';

// Commission ledger
const ledger = await db
  .select()
  .from(commissionLedger)
  .where(eq(commissionLedger.beneficiaryId, myId));
console.log('Commission ledger entries:', ledger.length);
ledger.forEach((r,i) => console.log(i, ':', JSON.stringify({
  level: r.level,
  status: r.status,
  amount: r.amountUsdt,
  sourceId: r.sourceId,
  unlockAt: r.unlockAt,
})));

// My invoices
const invs = await db
  .select({ id: invoices.id, status: invoices.status, amount: invoices.amountUsdt, userId: invoices.userId, createdAt: invoices.createdAt, invoiceType: invoices.invoiceType })
  .from(invoices)
  .orderBy(sql`${invoices.createdAt} desc`)
  .limit(20);
console.log('\nLast 20 invoices:');
invs.forEach((r,i) => console.log(i, ':', JSON.stringify(r)));

// My ref code and referrals
const me = await db
  .select({ refCode: users.refCode })
  .from(users)
  .where(eq(users.id, myId))
  .then(r => r[0]);
console.log('\nMy refCode:', me?.refCode);

if (me?.refCode) {
  const refs = await db
    .select({ id: users.id, refCode: users.refCode })
    .from(users)
    .where(eq(users.parentRefCode, me.refCode));
  console.log('My referrals:', refs.length);
  for (const r of refs) {
    const invCount = await db
      .select({ count: sql`count(*)::int` })
      .from(invoices)
      .where(and(eq(invoices.userId, r.id), eq(invoices.status, 'paid')))
      .then(r => r[0].count);
    console.log(' -', r.id, 'ref:', r.refCode, 'paid invoices:', invCount);
  }
}

process.exit(0);
