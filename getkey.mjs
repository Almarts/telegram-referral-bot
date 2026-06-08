import { HDKey } from "@scure/bip32";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha256";
import { hexToBytes } from "@noble/hashes/utils";
import { base58check } from "@scure/base";

const base58 = base58check(sha256);

function tronAddressFromPublicKey(pubkey) {
  const uncompressed = pubkey.length === 65 ? pubkey : secp256k1.ProjectivePoint.fromHex(pubkey).toRawBytes(false);
  const hash = keccak_256(uncompressed.subarray(1));
  const payload = hash.subarray(hash.length - 20);
  const prefixed = new Uint8Array(21);
  prefixed.set(new Uint8Array([0x41]), 0);
  prefixed.set(payload, 1);
  return base58.encode(prefixed);
}

const xprv = "xprv9zYYzzUMrGjJTXMKEhG56ayTmr42ELAqTZyBphiUye7tJWX7jcoVEHNcSur2152UEms8AxJX1Vj9sV9MrgqCjAin3Md8iV2KBHGyuBZ1zZ6";
const hdkey = HDKey.fromExtendedKey(xprv);

// derivIndex = 2 for the $10 address
const child = hdkey.derive("m/44'/195'/0'/0/2");
const address = tronAddressFromPublicKey(child.publicKey);
const pk = Buffer.from(child.privateKey).toString("hex");

console.log("Address: " + address);
console.log("Private Key: " + pk);
