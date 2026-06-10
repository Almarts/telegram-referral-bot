import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";
import { createHash } from "crypto";

function sha256(x: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(x).digest());
}

function b58Check(payload: Uint8Array): string {
  const checksum = sha256(sha256(payload)).slice(0, 4);
  const c = new Uint8Array(payload.length + 4);
  c.set(payload);
  c.set(checksum, payload.length);
  // @ts-ignore
  const { base58 } = require("@scure/base");
  return base58.base58.encode(c);
}

const pk = "a5b727b3f62796958cbdd21171531208e08ebcb237d1c0a66b60ce7790661c5d";
const pub = secp256k1.getPublicKey(pk, false);
const hash = keccak_256(pub.subarray(1));
const payload = new Uint8Array(21);
payload.set([0x41], 0);
payload.set(hash.subarray(hash.length - 20), 1);
console.log("Address:", b58Check(payload));
console.log("Hex:", bytesToHex(payload));
