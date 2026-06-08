// Direct TRC20 USDT send test via raw transaction construction
// No polling, just broadcast and get txid

const { TronWeb } = await import('tronweb');
const { secp256k1 } = await import('@noble/curves/secp256k1');
const { keccak_256 } = await import('@noble/hashes/sha3');
const { bytesToHex, hexToBytes } = await import('@noble/hashes/utils');
import('node:buffer');

const API_KEY='a844cffc-c750-41da-9aee-578adc95f2ce';
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const DEPOSIT_PK = '38463a4075256a1e96089cb1ce81c70494958ee630c4ef79f926a493f886c8f9';
const COLD = 'TMc4zof2CJkv4G3LV8CmifjtK5ZmvbdB9P'; // HOT wallet for test

const tronWeb = new TronWeb({
  fullHost: 'https://api.trongrid.io',
  headers: { 'TRON-PRO-API-KEY': API_KEY },
  privateKey: DEPOSIT_PK,
});

async function main() {
  try {
    const depositAddr = tronWeb.address.fromPrivateKey(DEPOSIT_PK);
    console.log('Deposit address:', depositAddr);

    const bal = await tronWeb.trx.getBalance(depositAddr);
    console.log('TRX balance:', bal / 1e6);

    const contract = await tronWeb.contract().at(USDT);
    const usdtBal = await contract.balanceOf(depositAddr).call();
    console.log('USDT balance:', Number(usdtBal) / 1e6);

    // Build the transfer transaction using transactionBuilder
    const depositHex = tronWeb.address.toHex(depositAddr);
    const usdtHex = tronWeb.address.toHex(USDT);

    console.log('\n--- Building USDT transfer (0.01 USDT to COLD) ---');
    
    const tx = await tronWeb.transactionBuilder.triggerConstantContract(
      usdtHex,
      'transfer(address,uint256)',
      { feeLimit: 300_000_000 }, // 300 TRX max fee
      [
        { type: 'address', value: COLD },
        { type: 'uint256', value: '10000' }, // 0.01 USDT
      ],
      depositHex
    );

    console.log('Transaction built:', {
      result: tx.result,
      txID: tx.transaction?.txID,
      raw_data_hex: tx.transaction?.raw_data_hex?.slice(0, 50) + '...',
    });

    if (!tx.result?.result) {
      console.error('triggerConstantContract failed:', JSON.stringify(tx));
      return;
    }

    // Sign the transaction
    const signedTx = await tronWeb.trx.sign(tx.transaction);
    console.log('Signed txID:', signedTx.txID);

    // Broadcast via raw API
    console.log('\n--- Broadcasting ---');
    const res = await fetch('https://api.trongrid.io/wallet/broadcasttransaction', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'TRON-PRO-API-KEY': API_KEY,
      },
      body: JSON.stringify({
        raw_data: signedTx.raw_data,
        raw_data_hex: signedTx.raw_data_hex,
        signature: signedTx.signature,
      }),
    });
    const data = await res.json();
    console.log('Broadcast result:', JSON.stringify(data, null, 2));

    if (data.result) {
      console.log('\n✅ SUCCESS! txID:', data.txid);
      console.log('Check: https://tronscan.org/#/transaction/' + data.txid);
    } else {
      console.log('\n❌ FAILED:', data.Error || data.message || JSON.stringify(data));
    }

  } catch (e) {
    if (e.response?.data?.message) {
      const msg = Buffer.from(e.response.data.message, 'hex').toString();
      console.error('Error response:', msg);
    }
    console.error('Full error:', e);
    if (e.stack) console.error(e.stack.slice(0, 1000));
  }
}

await main();
