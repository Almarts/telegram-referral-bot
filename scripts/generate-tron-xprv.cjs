/**
 * Generate BIP39 seed → TRON keys
 * CommonJS version for compatibility
 */
const bip39 = require('bip39');
const { BIP32Factory } = require('bip32');
const ecc = require('tiny-secp256k1');
const bip32 = BIP32Factory(ecc);
const keccak256 = require('keccak256');
const crypto = require('crypto');

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function sha256d(buf) {
  return crypto.createHash('sha256').update(crypto.createHash('sha256').update(buf).digest()).digest();
}

function base58CheckEncode(hexStr) {
  const data = Buffer.from(hexStr, 'hex');
  const checksum = sha256d(data).subarray(0, 4);
  const bytes = Buffer.concat([data, checksum]);
  
  let num = BigInt('0x' + bytes.toString('hex'));
  let result = '';
  while (num > 0n) {
    result = ALPHABET[num % 58n] + result;
    num /= 58n;
  }
  
  // leading zero bytes → '1'
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) result = '1' + result;
    else break;
  }
  return result;
}

function tronAddressFromPrivateKey(pkHex) {
  const pkBuf = Buffer.from(pkHex, 'hex');
  // Uncompressed public key (65 bytes: 04 + x + y)
  const pubKey = ecc.pointFromScalar(pkBuf, false);
  // Strip 04 prefix, keccak256, take last 20 bytes
  const hash = keccak256(pubKey.subarray(1));
  const addressHex = '41' + hash.subarray(-20).toString('hex');
  return base58CheckEncode(addressHex);
}

// ========== MAIN ==========

const mnemonic = bip39.generateMnemonic(256);
console.log('');
console.log('══════════════════════════════════════════════');
console.log('🔐  SEED PHRASE (BIP39, 24 words)');
console.log('   ⚠️  WRITE THIS DOWN. KEEP IT SECRET.');
console.log('══════════════════════════════════════════════');
console.log(mnemonic);
console.log('══════════════════════════════════════════════');
console.log('');

const seed = bip39.mnemonicToSeedSync(mnemonic);
const root = bip32.fromSeed(seed);
const path = "m/44'/195'/0'/0";
const xprvNode = root.derivePath(path);
const xprv = xprvNode.toBase58();

console.log('📋  TRON_XPRV (extended private key for deposit addresses):');
console.log(xprv);
console.log('');

console.log('📌  Первые 3 депозитных адреса (для проверки):');
for (let i = 0; i < 3; i++) {
  const child = root.derivePath(`${path}/${i}`);
  const pk = child.privateKey.toString('hex');
  const addr = tronAddressFromPrivateKey(pk);
  console.log(`   [${i}] ${addr}`);
}
console.log('');

// Hot wallet (index 1000)
console.log('🔥  HOT WALLET (для автоматических выплат):');
const hotNode = root.derivePath(`${path}/1000`);
const hotPK = hotNode.privateKey.toString('hex');
const hotAddr = tronAddressFromPrivateKey(hotPK);
console.log(`   Адрес: ${hotAddr}`);
console.log(`   Приватный ключ: ${hotPK}`);
console.log('');

// Cold wallet (index 9999) — MAIN COLD
console.log('❄️  ХОЛОДНЫЙ КОШЕЛЁК (для накоплений / MAIN COLD WALLET):');
const coldNode = root.derivePath(`${path}/9999`);
const coldPK = coldNode.privateKey.toString('hex');
const coldAddr = tronAddressFromPrivateKey(coldPK);
console.log(`   Адрес: ${coldAddr}`);
console.log(`   Приватный ключ: ${coldPK}`);
console.log('');
console.log(`⚠️  Импортируй холодный кошелёк в TronLink (приватный ключ)`);
console.log('══════════════════════════════════════════════');
console.log('');
