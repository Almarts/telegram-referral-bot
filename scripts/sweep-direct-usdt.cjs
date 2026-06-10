const { BIP32Factory } = require('bip32');
const { TronWeb } = require('tronweb');
const ecc = require('tiny-secp256k1');

const bip32 = BIP32Factory(ecc);
const toCold = 'TBaKukSZYVKBLBW25oskU8pd2v7yiFb3vW';
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

async function main() {
  const xprv = process.env.MASTER_KEY_XPRV;
  if (!xprv) { console.log('NO XPRV ENV'); process.exit(1); }
  
  const root = bip32.fromBase58(xprv);
  const child = root.derivePath("m/44'/195'/0'/0/8");
  const depositPk = child.privateKey.toString('hex');
  
  const trx = new TronWeb({
    fullHost: 'https://api.trongrid.io',
    privateKey: depositPk,
  });

  const depAddr = trx.address.fromPrivateKey(depositPk);
  console.log('Deposit addr:', depAddr);
  
  const contract = await trx.contract().at(USDT);
  const usdtBal = await contract.balanceOf(depAddr).call();
  console.log('USDT:', usdtBal.toString());
  
  if (Number(usdtBal) <= 0) {
    console.log('No USDT, stopping');
    return;
  }
  
  const tx = await contract.transfer(toCold, usdtBal).send({
    feeLimit: 18_000_000,
    shouldPollResponse: true,
  });
  console.log('TX:', tx);
}

main().catch(e => console.error('FAIL:', e.message || e));
