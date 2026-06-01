/**
 * Generate BIP39 seed → TRON keys and addresses
 * Uses only crypto math — no TronWeb needed for address derivation
 */

import { generateMnemonic, mnemonicToSeedSync } from 'bip39';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';

const bip32 = BIP32Factory(ecc);

// ---------- TRON address from public key (Keccak-256) ----------
import { createHash } from 'crypto';

function sha256(msg) {
  return createHash('sha256').update(msg).digest();
}
function keccak256(msg) {
  // Node 22 has no built-in Keccak. Install keccak or do it inline.
  // We'll compute address from privateKey directly via simple method
  return null;
}

// Alternative: derive address by generating private key and computing
// TRON address = 0x41 + last20(keccak256(publicKey))
// But Keccak is needed and Node's SHA3-256 != Keccak-256.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const keccak256Pkg = require('keccak256');

// Generate 24-word seed phrase
const mnemonic = generateMnemonic(256);
console.log('');
console.log('══════════════════════════════════════════════');
console.log('🔐  SEED PHRASE (BIP39, 24 words)');
console.log('   ⚠️  WRITE THIS DOWN. KEEP IT SECRET.');
console.log('══════════════════════════════════════════════');
console.log(mnemonic);
console.log('══════════════════════════════════════════════');
console.log('');

const seed = mnemonicToSeedSync(mnemonic);
const root = bip32.fromSeed(seed);
const path = "m/44'/195'/0'/0";
const xprvNode = root.derivePath(path);
const xprv = xprvNode.toBase58();

console.log('📋  TRON_XPRV (extended private key for deposit addresses):');
console.log(xprv);
console.log('');

// Helper: derive TRON address from private key hex
function tronAddressFromPrivateKey(pkHex) {
  const node = bip32.fromPrivateKey(Buffer.from(pkHex, 'hex'), Buffer.alloc(32));
  const pubKey = node.publicKey; // compressed, but TRON uses uncompressed
  const pubKeyUncompressed = node.privateKey.toString('hex').length > 0 ? 
    // Get uncompressed public key
    Buffer.from('04' + (function(){
      const secp = require('tiny-secp256k1');
      const pubUncomp = secp.pointMultiply(Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex'), BigInt('0x' + pkHex));
      // Actually just do it properly:
      // Uncompressed key = 04 + x + y
      const p = secp.pointFromScalar(Buffer.from(pkHex, 'hex'));
      return p.toString('hex');
    })()) : null;
  return null;
}

// Let's use a completely different approach: install ethers and compute via their keccak
console.log('📌  Computing addresses...');
console.log('');

// Use keccak256 package
const keccak = require('keccak256');

// secp256k1 to get public key
const secp256k1 = require('tiny-secp256k1');

for (let i = 0; i < 3; i++) {
  const child = root.derivePath(`${path}/${i}`);
  const pk = child.privateKey.toString('hex');
  // Get uncompressed public key (65 bytes: 04 + x + y)
  const pubKey = secp256k1.pointFromScalar(Buffer.from(pk, 'hex'), false);
  // Strip 0x04 prefix, keccak256, take last 20 bytes
  const pubKeyWithoutPrefix = pubKey.subarray(1);
  const hash = keccak(pubKeyWithoutPrefix);
  const addressHex = '41' + hash.subarray(-20).toString('hex');
  // Base58 encode with checksum
  // TRON address format
  const address = base58CheckEncode(addressHex);
  console.log(`   [${i}] ${address}`);
}
console.log('');

// Hot wallet (index 1000)
console.log('🔥  HOT WALLET (для автоматических выплат):');
const hotNode = root.derivePath(`${path}/1000`);
const hotPK = hotNode.privateKey.toString('hex');
const hotPub = secp256k1.pointFromScalar(Buffer.from(hotPK, 'hex'), false);
const hotHash = keccak(hotPub.subarray(1));
const hotAddr = base58CheckEncode('41' + hotHash.subarray(-20).toString('hex'));
console.log(`   Адрес: ${hotAddr}`);
console.log(`   Приватный ключ: ${hotPK}`);
console.log('');

// Cold wallet (index 9999) — MAIN COLD
console.log('❄️  ХОЛОДНЫЙ КОШЕЛЁК (для накоплений / MAIN COLD WALLET):');
const coldNode = root.derivePath(`${path}/9999`);
const coldPK = coldNode.privateKey.toString('hex');
const coldPub = secp256k1.pointFromScalar(Buffer.from(coldPK, 'hex'), false);
const coldHash = keccak(coldPub.subarray(1));
const coldAddr = base58CheckEncode('41' + coldHash.subarray(-20).toString('hex'));
console.log(`   Адрес: ${coldAddr}`);
console.log(`   Приватный ключ: ${coldPK}`);
console.log('');
console.log(`⚠️  Импортируй холодный кошелёк в TronLink (приватный ключ выше)`);
console.log('══════════════════════════════════════════════');
console.log('');

// ---------- Base58Check for TRON addresses ----------
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58CheckEncode(hexStr) {
  const data = Buffer.from(hexStr, 'hex');
  const checksum = sha256(sha256(data)).subarray(0, 4);
  const bytes = Buffer.concat([data, checksum]);
  
  // Count leading zeros
  let zeros = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) zeros++;
    else break;
  }
  
  // Encode
  let num = BigInt('0x' + bytes.toString('hex'));
  let result = '';
  while (num > 0n) {
    result = ALPHABET[num % 58n] + result;
    num /= 58n;
  }
  
  // Add leading '1's for leading zero bytes
  for (let i = 0; i < zeros; i++) {
    result = '1' + result;
  }
  
  return result;
}
