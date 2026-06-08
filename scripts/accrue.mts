import 'dotenv/config';
import { accrueCommissions } from '../lib/commissions.js';

const invoiceId = '6eb4de20-f078-4cd8-8a01-090c59e0f29c';
console.log('Calling accrueCommissions for', invoiceId);
try {
  await accrueCommissions(invoiceId);
  console.log('Done!');
} catch (e) {
  console.error('Error:', e);
}
process.exit(0);
