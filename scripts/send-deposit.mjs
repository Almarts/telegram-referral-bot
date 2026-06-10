import { TronWeb } from 'tronweb/index.js';

const pk = process.env.TRON_HOT_WALLET_PK;
const from = 'TMc4zof2CJkv4G3LV8CmifjtK5ZmvbdB9P';
const to = 'TN8sYb6UPtJrECPekQqZmyrooZ4QPWHNTu';
const amount = 18;

async function main() {
  const trx = new TronWeb({
    fullHost: 'https://api.trongrid.io',
    privateKey: pk,
  });

  const bal = await trx.trx.getBalance(from);
  console.log('Balance:', bal / 1e6, 'TRX');
  if (bal < amount * 1e6 + 1e5) {
    console.log('NOT ENOUGH');
    process.exit(1);
  }

  const tradeobj = await trx.transactionBuilder.sendTrx(to, amount * 1e6, from);
  const signed = await trx.trx.sign(tradeobj);
  console.log('Signed, broadcasting...');
  const receipt = await trx.trx.broadcast(signed);
  console.log('Done:', JSON.stringify(receipt));
}

main().catch(e => {
  console.error('FAIL:', e.message || e);
  process.exit(1);
});
