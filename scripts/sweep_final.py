import subprocess, base64

env = {}
with open(r'C:\Users\marts\projects\telegram-referral-bot-main\.env.local') as f:
    for line in f:
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip().strip("'\"")

secret = env.get('CRON_SECRET', '')
print('Secret len:', len(secret))

# Use env to avoid shell interpolation issues
r = subprocess.run([
    'curl', '-s',
    'https://telegram-referral-bot-gules.vercel.app/api/cron/sweep',
    '-H', secret,
], capture_output=True, text=True, timeout=30)
print(r.stdout[:1000])
