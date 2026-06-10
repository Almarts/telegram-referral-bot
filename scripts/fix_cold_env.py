#!/usr/bin/env python3
import subprocess, json, os

token = os.environ.get("VERCEL_TOKEN", "<set VERCEL_TOKEN env>")
new_val = "TXKx4zMsfDt11Mfgb2wZSuQDpobuqJj3nC"
auth = "Authorization: Bearer " + token
ct = "Content-Type: application/json"
base = "https://api.vercel.com/v1/projects/telegram-referral-bot/env"

r = subprocess.run(["curl", "-s", "-H", auth, "-H", ct, base], capture_output=True, text=True, timeout=15)
envs = json.loads(r.stdout)

for e in envs if isinstance(envs, list) else envs.get("envs", []):
    if e["key"] == "TRON_COLD_WALLET_ADDRESS":
        eid = e["id"]
        print("Found:", eid)
        r2 = subprocess.run(["curl", "-s", "-X", "DELETE", base + "/" + eid, "-H", auth], capture_output=True, text=True, timeout=15)
        print("Delete:", r2.stdout[:200])

r3 = subprocess.run(["curl", "-s", "-X", "POST", base,
    "-H", auth, "-H", ct,
    "-d", '{"key":"TRON_COLD_WALLET_ADDRESS","value":"' + new_val + '","target":["production"],"type":"encrypted"}'],
    capture_output=True, text=True, timeout=15)
print("Add:", r3.stdout[:300])
