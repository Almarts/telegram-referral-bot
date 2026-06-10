const { TronWeb } = require('tronweb');

// Hot wallet PK - send USDT from deposit to cold
const pk = 'e3e7ee25b9cd22256a9a83f597277a321a6a665bf784d7ebd315870e39298dcb';
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const deposit = 'TN8sYb6UPtJrECPekQqZmyrooZ4QPWHNTu';  // has 1 USDT
const cold = 'TBaKukSZYVKBLBW25oskU8pd2v7yiFb3vW';

async function main() {
  // First check USDT via triggerConstantContract
  const trx = new TronWeb({ fullHost: 'https://api.trongrid.io', privateKey: pk });
  
  // Verify balanceOf through trigger
  const dr = await trx.transactionBuilder.triggerConstantContract(
    USDT, 'balanceOf(address)', {}, [{ type: 'address', value: deposit }], deposit
  );
  if (!dr.result?.result) { console.log('balanceOf failed'); return; }
  const hex = dr.constant_result[0];
  const bal = parseInt(hex, 16) / 1e6;
  console.log('Deposit USDT:', bal);
  
  if (bal <= 0) { console.log('No USDT'); return; }
  
  // Now send from deposit - but we need deposit's PK not hot PK
  // Use the code path that the app already has: createTransfer + send directly
  // Actually the app already handles this in processSweeps - it uses the derived key from xprv
  
  // Let's just trigger sweep via the app's own logic by fixing the usdtBalance issue
  // The issue is getaccount - no trc20 - so usdtBalance returns 0
  
  // Quick fix: patch usdtBalance to use triggerConstantContract
  
  console.log('USDT confirmed on deposit:', bal);
  console.log('Need to fix usdtBalance to use triggerConstantContract');
}

main().catch(e => console.error(e));
