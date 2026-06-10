const { TronWeb } = require('tronweb');
const pk = 'e3e7ee25b9cd22256a9a83f597277a321a6a665bf784d7ebd315870e39298dcb';
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

  const result = await trx.trx.sendTransaction(to, amount * 1e6);
  console.log('Result:', JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch(e => {
  console.error('FAIL:', e.message || e);
  process.exit(1);
});
