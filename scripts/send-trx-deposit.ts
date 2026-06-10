import TronWeb from 'tronweb';

const pk = process.env.WALLET_PRIVATE_KEY_HOT!;
const from = 'TMc4zof2CJkv4G3LV8CmifjtK5ZmvbdB9P';
const to = 'TN8sYb6UPtJrECPekQqZmyrooZ4QPWHNTu';
const amount = 18;

async function main() {
  const trx = new TronWeb({
    fullHost: 'https://api.trongrid.io',
    privateKey: pk,
  });

  const bal = await trx.trx.getBalance(from);
  console.log('Hot balance:', bal / 1e6, 'TRX');

  if (bal < amount * 1e6 + 1e5) {
    console.log('❌ NOT ENOUGH');
    process.exit(1);
  }

  const tradeobj = await trx.transactionBuilder.sendTrx(to, amount * 1e6, from);
  const signedtxn = await trx.trx.sign(tradeobj);
  const receipt = await trx.trx.broadcast(signedtxn);

  console.log('✅ TX:', receipt.txid || JSON.stringify(receipt));

  await new Promise(r => setTimeout(r, 5000));
  const axios = require('axios');
  const resp = await axios.get(`https://api.trongrid.io/v1/accounts/${to}`);
  const bal2 = parseInt(resp.data?.data?.[0]?.balance || '0');
  console.log('Dest balance:', bal2 / 1e6, 'TRX');
}

main().catch(e => {
  console.error('❌', e.message || e);
  process.exit(1);
});
