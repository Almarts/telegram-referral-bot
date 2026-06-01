#!/usr/bin/env python3
"""Generate TRON BIP39 wallet — pure Python, no C extensions needed."""
import hashlib
import hmac
import secrets
import struct

# === Secp256k1 arithmetic (pure Python using Jacobian coordinates) ===

# secp256k1 curve parameters
P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
Gx = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798
Gy = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8

def modinv(a, m):
    return pow(a, m - 2, m)

def point_add(p1, p2):
    if p1 is None:
        return p2
    if p2 is None:
        return p1
    x1, y1 = p1
    x2, y2 = p2
    if x1 == x2:
        if y1 == y2:
            # Point doubling
            lam = (3 * x1 * x1 * modinv(2 * y1, P)) % P
        else:
            return None
    else:
        lam = ((y2 - y1) * modinv(x2 - x1, P)) % P
    x3 = (lam * lam - x1 - x2) % P
    y3 = (lam * (x1 - x3) - y1) % P
    return (x3, y3)

def point_mul(k, point):
    result = None
    addend = point
    while k:
        if k & 1:
            result = point_add(result, addend)
        addend = point_add(addend, addend)
        k >>= 1
    return result

def bytes_to_int(b):
    return int.from_bytes(b, 'big')

def int_to_bytes(i, length=32):
    return i.to_bytes(length, 'big')

def sha256(data):
    return hashlib.sha256(data).digest()

def ripemd160(data):
    h = hashlib.new('ripemd160')
    h.update(data)
    return h.digest()

def hmac_sha512(key, data):
    return hmac.new(key, data, hashlib.sha512).digest()

# === BIP39 ===

BIP39_WORDLIST = []
with open(__file__.replace('generate-tron-xprv.py', 'bip39_english.txt'), 'r') as f:
    BIP39_WORDLIST = [line.strip() for line in f if line.strip()]

if not BIP39_WORDLIST:
    # Fallback: just use first 2048 words
    BIP39_WORDLIST = [f"word{i}" for i in range(2048)]

def generate_mnemonic(bits=256):
    entropy = secrets.token_bytes(bits // 8)
    checksum_bits = bits // 32
    entropy_hash = sha256(entropy)
    checksum = entropy_hash[0] >> (8 - checksum_bits)
    
    # Combine entropy + checksum
    bits_str = ''.join(format(b, '08b') for b in entropy)
    bits_str += format(checksum, f'0{checksum_bits}b')
    
    # Split into 11-bit chunks
    words = []
    for i in range(0, len(bits_str), 11):
        idx = int(bits_str[i:i+11], 2)
        words.append(BIP39_WORDLIST[idx])
    return ' '.join(words)

def mnemonic_to_seed(mnemonic, passphrase=''):
    # PBKDF2 with 2048 rounds
    mnemonic_bytes = mnemonic.encode('utf-8')
    salt = ('mnemonic' + passphrase).encode('utf-8')
    return hashlib.pbkdf2_hmac('sha512', mnemonic_bytes, salt, 2048, dklen=64)

# === BIP32 ===

def bip32_derive_xprv(seed, path):
    # master key
    I = hmac_sha512(b'Bitcoin seed', seed)
    master_priv = int_to_bytes(bytes_to_int(I[:32]) % N, 32)
    master_chain = I[32:]
    
    # parse path
    nodes = path.split('/')
    priv = master_priv
    chain = master_chain
    
    for node in nodes[1:]:  # skip 'm'
        if node.endswith("'"):
            index = int(node[:-1]) + 0x80000000
        else:
            index = int(node)
        
        # CKDpriv
        if index >= 0x80000000:
            data = b'\x00' + priv + struct.pack('>I', index)
        else:
            # Get public key
            pk_int = bytes_to_int(priv)
            pub_point = point_mul(pk_int, (Gx, Gy))
            pub_ser = b'\x03' + int_to_bytes(pub_point[0], 32) if pub_point[1] % 2 else b'\x02' + int_to_bytes(pub_point[0], 32)
            data = pub_ser + struct.pack('>I', index)
        
        I2 = hmac_sha512(chain, data)
        priv = int_to_bytes((bytes_to_int(I2[:32]) + bytes_to_int(priv)) % N, 32)
        chain = I2[32:]
    
    # Build xprv
    priv_int = bytes_to_int(priv)
    pub_point = point_mul(priv_int, (Gx, Gy))
    pub_ser = b'\x03' + int_to_bytes(pub_point[0], 32) if pub_point[1] % 2 else b'\x02' + int_to_bytes(pub_point[0], 32)
    
    return priv, chain, pub_ser, pub_point

# === Base58Check ===

BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

def base58check_encode(payload):
    checksum = sha256(sha256(payload))[:4]
    data = payload + checksum
    
    # Count leading zeros
    leading = 0
    for b in data:
        if b == 0:
            leading += 1
        else:
            break
    
    num = int.from_bytes(data, 'big')
    result = ''
    while num > 0:
        result = BASE58_ALPHABET[num % 58] + result
        num //= 58
    
    return '1' * leading + result

def xprv_to_base58(priv, chain, pub_ser, depth=4, fingerprint=b'\x00\x00\x00\x00', child_num=b'\x00\x00\x00\x00'):
    """Convert to xprv base58 string"""
    version = b'\x04\x88\xad\xe4'  # mainnet xprv
    payload = version + bytes([depth]) + fingerprint + child_num + chain + b'\x00' + priv
    return base58check_encode(payload)

# === TRON address ===

def keccak256(data):
    # keccak-256 (NOT sha3-256 — different padding)
    # Use pysha3 if available
    try:
        import hashlib
        # Try sha3 library
        pass
    except:
        pass
    
    # Pure Python keccak-256 implementation
    return _keccak256(data)

# Pure Python Keccak-256 (FIPS-202 with specific parameters for SHA3)
# Actually we need Keccak (original), not SHA3. Let's use a minimal implementation.
# For simplicity, use hashlib.sha3_256 for now and compute the correct address.
# Note: sha3_256 != keccak256 (different padding). But for TRON address derivation,
# many libraries use keccak. We'll use the standard approach.

import io

# Minimal Keccak-256 implementation
KECCAK_ROUNDS = 24
KECCAK_RC = [
    0x0000000000000001, 0x0000000000008082, 0x800000000000808A,
    0x8000000080008000, 0x000000000000808B, 0x0000000080000001,
    0x8000000080008081, 0x8000000000008009, 0x000000000000008A,
    0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
    0x000000008000808B, 0x800000000000008B, 0x8000000000008089,
    0x8000000000008003, 0x8000000000008002, 0x8000000000000080,
    0x000000000000800A, 0x800000008000000A, 0x8000000080008081,
    0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
]

def rotl64(x, n):
    return ((x << n) | (x >> (64 - n))) & 0xFFFFFFFFFFFFFFFF

def keccak_f1600(state):
    """Keccak-f[1600] permutation"""
    for rnd in range(KECCAK_ROUNDS):
        # θ step
        C = [state[x] ^ state[x+5] ^ state[x+10] ^ state[x+15] ^ state[x+20] for x in range(5)]
        D = [C[(x+4)%5] ^ rotl64(C[(x+1)%5], 1) for x in range(5)]
        for x in range(5, 25, 5):
            for y in range(5):
                state[x+y] ^= D[y]
        
        # ρ and π steps
        B = [0] * 25
        x, y = 1, 0
        for t in range(24):
            B[y*5+x] = rotl64(state[x*5+y], ((t+1)*(t+2)//2) % 64)
            x, y = y, (2*x + 3*y) % 5
        for i in range(25):
            state[i] = B[i]
        
        # χ step
        for y in range(5):
            for x in range(5):
                i = y*5+x
                state[i] ^= (~state[(y*5+(x+1)%5)] & state[(y*5+(x+2)%5)])
        
        # ι step
        state[0] ^= KECCAK_RC[rnd]
    
    return state

def _keccak256(data):
    """Keccak-256 (not SHA3-256)"""
    # rate = 1088 bits = 136 bytes for 256-bit output
    rate = 136
    
    # Padding — Keccak uses 10*1 padding
    # Append '1', then '0'*k, then '1'
    # For byte-oriented: 0x01, then 0x00 bytes, then 0x80
    block_size = rate
    data = bytearray(data)
    data.append(0x01)
    # Pad with zeros until block_size - 1
    while len(data) % block_size != (block_size - 1):
        data.append(0x00)
    data.append(0x80)
    
    # Initialize state
    state = [0] * 25
    
    # Absorb
    for i in range(0, len(data), block_size):
        block = data[i:i+block_size]
        for j in range(len(block)):
            state[j // 8] ^= block[j] << (8 * (j % 8))
        state = keccak_f1600(state)
    
    # Squeeze (32 bytes = 256 bits)
    result = bytearray()
    while len(result) < 32:
        for j in range(min(block_size, 32 - len(result))):
            result.append((state[j // 8] >> (8 * (j % 8))) & 0xFF)
        if len(result) < 32:
            state = keccak_f1600(state)
    
    return bytes(result)


def tron_address_from_private_key(pk_bytes):
    """Derive TRON address (T...) from private key bytes"""
    priv_int = bytes_to_int(pk_bytes)
    pub_point = point_mul(priv_int, (Gx, Gy))
    
    # Uncompressed public key: 04 + x (32 bytes) + y (32 bytes)
    pub_bytes = b'\x04' + int_to_bytes(pub_point[0], 32) + int_to_bytes(pub_point[1], 32)
    
    # Keccak256 of pubkey (without 0x04 prefix)
    h = _keccak256(pub_bytes[1:])
    
    # TRON address: 0x41 + last 20 bytes of hash
    addr_hex = b'\x41' + h[-20:]
    return base58check_encode(addr_hex)


# ==================== MAIN ====================

# Load BIP39 wordlist
wordlist_path = __file__.replace('generate-tron-xprv.py', 'bip39_english.txt')
try:
    with open(wordlist_path) as f:
        BIP39_WORDLIST = [l.strip() for l in f if l.strip()]
except:
    # Generate inline wordlist — just for demo
    BIP39_WORDLIST = [f"word{i:04d}" for i in range(2048)]

# Generate 24-word mnemonic
entropy = secrets.token_bytes(32)
checksum_bits = 8
ehash = sha256(entropy)
checksum = ehash[0] >> (8 - checksum_bits)

bits_str = ''.join(format(b, '08b') for b in entropy)
bits_str += format(checksum, f'0{checksum_bits}b')

words = []
for i in range(0, len(bits_str), 11):
    idx = int(bits_str[i:i+11], 2)
    words.append(BIP39_WORDLIST[idx])
mnemonic = ' '.join(words)

print()
print('═' * 50)
print('🔐  SEED PHRASE (BIP39, 24 words)')
print('   ⚠️  WRITE THIS DOWN. KEEP IT SECRET.')
print('═' * 50)
print(mnemonic)
print('═' * 50)
print()

# Seed → BIP32
seed = mnemonic_to_seed(mnemonic)
path = "m/44'/195'/0'/0"
priv, chain, pub_ser, pub_point = bip32_derive_xprv(seed, path)

xprv = xprv_to_base58(priv, chain, pub_ser)
print('📋  TRON_XPRV (extended private key for deposit addresses):')
print(xprv)
print()

print('📌  Первые 3 депозитных адреса (для проверки):')
for i in range(3):
    cp, _, _, _ = bip32_derive_xprv(seed, f"{path}/{i}")
    addr = tron_address_from_private_key(cp)
    print(f'   [{i}] {addr}')
print()

print('🔥  HOT WALLET (для автоматических выплат):')
hot_pk, _, _, _ = bip32_derive_xprv(seed, f"{path}/1000")
hot_addr = tron_address_from_private_key(hot_pk)
print(f'   Адрес: {hot_addr}')
print(f'   Приватный ключ: {hot_pk.hex()}')
print()

print('❄️  ХОЛОДНЫЙ КОШЕЛЁК (для накоплений / MAIN COLD WALLET):')
cold_pk, _, _, _ = bip32_derive_xprv(seed, f"{path}/9999")
cold_addr = tron_address_from_private_key(cold_pk)
print(f'   Адрес: {cold_addr}')
print(f'   Приватный ключ: {cold_pk.hex()}')
print()
print('⚠️  Импортируй холодный кошелёк в TronLink (приватный ключ выше)')
print('═' * 50)
print()
