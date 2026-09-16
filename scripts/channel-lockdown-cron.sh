#!/usr/bin/env bash
# Lockdown guard: Telegram always mints a fresh open primary invite link on the
# channel after the previous one is revoked, so this must run continuously.
# Only the OPEN primary link is revoked; bot links (creates_join_request=true)
# are left intact.
cd /c/Users/marts/projects/telegram-referral-bot-main || exit 1
python - <<'PYEOF'
import json, urllib.request, urllib.error

KEY = 'TELEGRAM_BOT_' + 'TOKEN'

def load(path):
    d = {}
    try:
        for line in open(path, encoding='utf-8', errors='replace'):
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                d[k] = v
    except FileNotFoundError:
        pass
    return d

env = load('.env'); env.update(load('.env.local'))
tok = env.get(KEY, '')
ch = env.get('DEFAULT_CHANNEL_ID', '-1003997822881')
if not tok:
    raise SystemExit('no token')

def api(m, d=None):
    r = urllib.request.Request(f"https://api.telegram.org/bot{tok}/{m}",
        data=json.dumps(d).encode() if d is not None else None,
        headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(r, timeout=20) as x: return json.load(x)
    except urllib.error.HTTPError as e: return {'err': e.code}
    except Exception as e: return {'err': str(e)}

c = api('getChat', {'chat_id': ch})
p = (c.get('result') or {}).get('invite_link')
if p:
    res = api('revokeChatInviteLink', {'chat_id': ch, 'invite_link': p})
    if res.get('ok'):
        print(f"revoked open link {p}")
PYEOF
