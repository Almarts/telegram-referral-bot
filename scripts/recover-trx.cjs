const { TronWeb } = require("tronweb");

const apiKey = "a844cffc-c750-41da-9aee-578adc95f2ce";

async function main() {
  // Wrong deposit address where 18 TRX went
  const wrongAddr = "TN8sYb6UPt5M4zAJo94Q5sCn8HhYGw9Dqk";
  
  // We don't have the private key for this address
  // It was derived from xprv, but different xprv than Vercel
  // So we need the owner to sweep it back
  
  console.log(`Wrong deposit: ${wrongAddr}`);
  console.log("18 TRX stuck there, no private key on my machine");
  
  // Check if Vercel can access it (maybe it uses same xprv pattern?)
  console.log("DerivIndex of wrong addr = ? (not from any invoice)");
  
  // Let's check what address derives from xprv at index 8
  const { HDKey } = require("@scure/bip32");
  const xprv = "xprv9zYYzzUMrGjJTXMKEhG56ayTmr42ELAqTZyBphiUye7tJWX7jcoVEHNcSur2152UEms8AxJX1Vj9sV9MrgqCjAin3Md8iV2KBHGyuBZ1zZ6";
  const { secp256k1 } = require("@noble/curves/secp256k1");
  const { keccak_256 } = require("@noble/hashes/sha3");
  const { sha256 } = require("@noble/hashes/sha256");
  const { hexToBytes, bytesToHex } = require("@noble/hashes/utils");
  const { base58check } = require("@scure/base");
  
  for (let i = 0; i < 10; i++) {
    const child = HDKey.fromExtendedKey(xprv).derive(`m/44'/195'/0'/0/${i}`);
    if (!child.privateKey) continue;
    const pkHex = bytesToHex(child.privateKey);
    const pub = secp256k1.getPublicKey(child.privateKey, false);
    const hash = keccak_256(pub.slice(1));
    const addrBytes = new Uint8Array([0x41, ...hash.slice(-20)]);
    try {
      const addr = base58check(sha256).encode(addrBytes);
      if (addr === wrongAddr) {
        console.log(`\nFOUND! derivIndex=${i} PK=${pkHex.slice(0,16)}...`);
        console.log(`Address: ${addr}`);
        
        // Restore 18 TRX back to hot
        const tw = new TronWeb({
          fullHost: "https://api.trongrid.io",
          headers: { "TRON-PRO-API-KEY": apiKey },
          privateKey: pkHex,
        });
        
        const bal = await tw.trx.getBalance(addr);
        console.log(`Balance: ${bal / 1e6} TRX`);
        
        if (bal >= 18_000_000) {
          const hotAddr = tw.address.fromPrivateKey("e3e7ee25b9cd22256a9a83f597277a321a6a665bf784d7ebd315870e39298dcb");
          console.log(`Sending ${(bal-1_000_000)/1e6} TRX back to hot ${hotAddr}...`);
          
          const fromHex = base58check(sha256).encode(addrBytes);
          const toHex = tw.address.toHex(hotAddr);
          const createRes = await fetch("https://api.trongrid.io/wallet/createtransaction", {
            method: "POST",
            headers: { "Content-Type": "application/json", "TRON-PRO-API-KEY": apiKey },
            body: JSON.stringify({ owner_address: tw.address.toHex(addr), to_address: toHex, amount: Number(bal) - 1_000_000 }),
          });
          const tx = await createRes.json();
          if (tx.raw_data) {
            const signed = await tw.trx.sign(tx, pkHex);
            const res = await fetch("https://api.trongrid.io/wallet/broadcasttransaction", {
              method: "POST",
              headers: { "Content-Type": "application/json", "TRON-PRO-API-KEY": apiKey },
              body: JSON.stringify({ raw_data: tx.raw_data, signature: signed.signature }),
            });
            const r = await res.json();
            console.log("Return tx:", JSON.stringify(r, null, 2));
          } else {
            console.error("Cannot create tx:", tx);
          }
        }
        return;
      }
    } catch(e) {}
  }
  console.log("\nNot found in any derivIndex with local xprv");
}

main().catch(e => console.error("ERR:", e.message || e));
