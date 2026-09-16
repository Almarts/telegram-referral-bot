#!/usr/bin/env bash
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

def api(m, data=None):
    url = f"https://api.telegram.org/bot{tok}/{m}"
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return {'http_error': e.code, 'body': e.read().decode()[:300]}

# Revoke the two public unlimited primary links we know about.
for link in [
    "https://t.me/+cXqZi4f9Ra1iOTYy",
    "https://t.me/+g58yX4FvMuE2NGFi",
]:
    res = api('revokeChatInviteLink', {'chat_id': ch, 'invite_link': link})
    print(link, '->', json.dumps(res)[:220])

print()
print('=== getChat after (invite_link field) ===')
c = api('getChat', {'chat_id': ch})
if c.get('ok'):
    print('primary invite_link now:', c['result'].get('invite_link'))
else:
    print(json.dumps(c)[:300])
PYEOF
