
const { BIP32Factory } = require('bip32');
const { TronWeb } = require('tronweb');
const ecc = require('tiny-secp256k1');
const bip32 = BIP32Factory(ecc);
const root = bip32.fromBase58("xprv9zYYzzUMrGjJTXMKEhG56ayTmr42ELAqTZyBphiUye7tJWX7jcoVEHNcSur2152UEms8AxJX1Vj9sV9MrgqCjAin3Md8iV2KBHGyuBZ1zZ6");

for (let i = 99; i <= 102; i++) {
  const child = root.derivePath("m/44'/195'/0'/0/" + i);
  const pkBuf = child.privateKey;
  const pkHex = Buffer.from(pkBuf).toString('hex');
  const tw = new TronWeb({ fullHost: 'https://api.trongrid.io' });
  const addr = tw.address.fromPrivateKey(pkHex);
  console.log(`Index ${i}: ${addr}  PK: ${pkHex}`);
}
