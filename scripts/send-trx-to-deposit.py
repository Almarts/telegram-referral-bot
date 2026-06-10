#!/usr/bin/env python3
import subprocess, json, sys, hashlib

with open(r'C:\Users\marts\projects\telegram-referral-bot-main\.env.local', encoding='utf-8') as f:
    content = f.read()

pk = None
api = None
for line in content.split('\n'):
    line = line.strip()
    if line.startswith('TRON_HOT_WALLET_PK='):
        pk = line.split('=', 1)[1].strip().strip("'\"")
    if line.startswith('TRONGRID_API_KEY='):
        api = line.split('=', 1)[1].strip().strip("'\"")

from_addr = 'TMc4zof2CJkv4G3LV8CmifjtK5ZmvbdB9P'
to_addr = 'TN8sYb6UPtJrECPekQqZmyrooZ4QPWHNTu'
amount_sun = 18 * 1_000_000

H = ['-H', 'Content-Type: application/json']

payload = json.dumps({'to_address': to_addr, 'owner_address': from_addr, 'amount': amount_sun, 'visible': True})
r = subprocess.run(['curl', '-s', '-X', 'POST', 'https://api.trongrid.io/wallet/createtransaction'] + H + ['-d', payload], capture_output=True, text=True, timeout=15)
tx = json.loads(r.stdout)
if 'Error' in tx:
    print("Create error:", tx['Error'])
    sys.exit(1)

txid = tx['txID']
raw_hex = tx['raw_data_hex']
print("Tx created:", txid)

raw = bytes.fromhex(raw_hex)
h = hashlib.sha256(raw).digest()
print("Hash:", h.hex())

from ecdsa import SigningKey, SECP256k1
sk = SigningKey.from_string(bytes.fromhex(pk), curve=SECP256k1)
sig = sk.sign(h, hashfunc=hashlib.sha256)
print("Signature r||s:", len(sig), "bytes ->", sig.hex()[:40]+"...")

# Need to find v (recovery id). Since ecdsa gives deterministic k,
# we can try both v=0x1b and v=0x1c (27 and 28)
sig_r = sig[:32]
sig_s = sig[32:]

for v in [0x1b, 0x1c]:
    sig_tron = sig_r + sig_s + bytes([v])
    sig_hex = sig_tron.hex()
    
    tx_signed = dict(tx)
    tx_signed['signature'] = [sig_hex]
    
    r_b = subprocess.run(['curl', '-s', '-X', 'POST', 'https://api.trongrid.io/wallet/broadcasttransaction'] + H + ['-d', json.dumps(tx_signed)], capture_output=True, text=True, timeout=15)
    res = json.loads(r_b.stdout)
    code = res.get('code', '')
    result = res.get('result', '')
    
    print(f"v={hex(v)}: code={code} result={result}")
    if result is True or result == 'SUCCESS' or code == 'SUCCESS' or code == '0':
        print(f"\n🎉 SUCCESS! v={hex(v)}")
        print(f"https://tronscan.org/#/transaction/{txid}")
        sys.exit(0)

print("\n❌ All broadcast attempts failed")
