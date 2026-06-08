// Test: send USDT from deposit to COLD address directly

const { TronWeb } = await import('tronweb');

const API_KEY='a844cf...f2ce';
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const DEPOSIT_PK = '38463a4075256a1e96089cb1ce81c70494958ee630c4ef79f926a493f886c8f9';
const COLD = 'TRHUJ6KtbavBx1CtuXwenYurbZHMW1zPhE';

const tronWeb = new TronWeb({
  fullHost: 'https://api.trongrid.io',
  headers: { 'TRON-PRO-API-KEY': API_KEY },
  privateKey: DEPOSIT_PK,
});

const depositAddr = tronWeb.address.fromPrivateKey(DEPOSIT_PK);
console.log('Deposit:', depositAddr);
console.log('Cold:', COLD);

// Check balances
const bal = await tronWeb.trx.getBalance(depositAddr);
console.log('TRX:', bal/1e6);

const contract = await tronWeb.contract().at(USDT);
const usdtBal = await contract.balanceOf(depositAddr).call();
console.log('USDT:', Number(usdtBal)/1e6);

// Build the transfer transaction
const usdtHex = tronWeb.address.toHex(USDT);
const depositHex = tronWeb.address.toHex(depositAddr);
const coldHex = tronWeb.address.toHex(COLD);

console.log('\nBuilding transfer of 0.01 USDT to COLD for testing...');
const tx = await tronWeb.transactionBuilder.triggerConstantContract(
  usdtHex,
  'transfer(address,uint256)',
  { feeLimit: 100_000_000 },
  [
    { type: 'address', value: COLD },
    { type: 'uint256', value: '10000' }, // 0.01 USDT
  ],
  depositHex
);

console.log('Built result:', tx.result?.result ? 'OK' : 'FAIL');

if (!tx.result?.result) {
  console.error('Build failed:', JSON.stringify(tx).slice(0, 500));
  process.exit(1);
}

// Sign
const signed = await tronWeb.trx.sign(tx.transaction, DEPOSIT_PK);
console.log('Signed, signature length:', signed.signature?.[0]?.length);

// Build raw_data + signature
const body = JSON.stringify({
  raw_data: tx.transaction.raw_data,
  signature: [signed.signature[0]],
});

// Broadcast
console.log('Broadcasting to TronGrid...');
const res = await fetch('https://api.trongrid.io/wallet/broadcasttransaction', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'TRON-PRO-API-KEY': API_KEY,
  },
  body,
});
const data = await res.json();
console.log('Broadcast result:', JSON.stringify(data, null, 2));

if (data.result) {
  console.log('\n✅ Success! txID:', data.txid);
  console.log('Check: https://tronscan.org/#/transaction/' + data.txid);
}
