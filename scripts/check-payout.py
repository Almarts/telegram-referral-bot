import subprocess

with open(r'C:\Users\marts\projects\telegram-referral-bot-main\.env.local') as f:
    content = f.read()

secret = None
for line in content.split('\n'):
    line = line.strip()
    if line.startswith('CRON_SECRET='):
        secret = line.split('=', 1)[1].strip().strip("'\"")

auth = 'Authorization: Bearer ***    r = subprocess.run([
        'curl', '-s',
        'https://telegram-referral-bot-gules.vercel.app/api/cron/payout-queue',
        '-H', auth,
    ], capture_output=True, text=True, timeout=30)
    print(r.stdout[:2000])
