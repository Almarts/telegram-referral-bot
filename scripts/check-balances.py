import requests, json, hashlib

def b58_to_hex(s):
    """Properly convert TRON base58 address to hex (41 + 20 bytes)"""
    alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    num = 0
    for c in s:
        num = num * 58 + alphabet.index(c)
    h = hex(num)[2:]
    # Base58 decode gives: version(1) + hash(20) + checksum(4) = 25 bytes = 50 hex chars
    # We need: 41 + hash(20) = 21 bytes = 42 hex chars
    if len(h) % 2:
        h = '0' + h
    # Remove checksum (last 8 hex chars / 4 bytes)
    # The version is already 41 in base58, but in decoded form it's first byte
    return h[:42]  # 21 bytes

# Test conversion
addr = 'TN8sYb6UPt5M4zAJo94Q5sCn8HhYGw9Dqk'
hex_addr = b58_to_hex(addr)
print(f'addr: {addr}')
print(f'hex:  {hex_addr}')

# Check via getaccount
r = requests.post('https://api.trongrid.io/wallet/getaccount', json={'address': hex_addr})
d = r.json()
trx = d.get('balance', 0) / 1e6
print(f'TRX via getaccount: {trx}')

# Check via getaccountresource (shows account exists)
r2 = requests.post('https://api.trongrid.io/wallet/getaccountresource', json={'address': hex_addr})
d2 = r2.json()
print(f'Account resource: {json.dumps(d2, indent=2)[:300]}')

# Check hot balance (should be ~6 TRX after sending 18)
hot = 'TMc4zof2CJkv4G3LV8CmifjtK5ZmvbdB9P'
hot_hex = b58_to_hex(hot)
r3 = requests.post('https://api.trongrid.io/wallet/getaccount', json={'address': hot_hex})
d3 = r3.json()
hot_trx = d3.get('balance', 0) / 1e6
print(f'\nHot TRX: {hot_trx}')

# Check if tx is confirmed
txid = '44371e44058130851d6785f940a264e9e011fb7c64dbf2da6f46b1701ae86374'
r4 = requests.post('https://api.trongrid.io/wallet/gettransactionbyid', json={'value': txid})
d4 = r4.json()
ret = d4.get('ret', [{}])[0].get('contractRet', '?')
fee = d4.get('ret', [{}])[0].get('fee', 0)
print(f'Tx result: {ret}, fee: {fee}')
