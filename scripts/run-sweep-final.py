import subprocess

with open(r'C:\Users\marts\projects\telegram-referral-bot-main\.env.local', encoding='utf-8') as f:
    content = f.read()

secret = None
for line in content.split('\n'):
    line = line.strip()
    if line.startswith('CRON_SECRET=***        secret = line.split('=', 1)[1].strip().strip("'\"")

url = 'https://telegram-referral-bot-gules.vercel.app/api/cron/sweep'
r = subprocess.run(['curl', '-s', url, '-H', f'Authorization: Bearer {secret}'], capture_output=True, text=True, timeout=30)
print(r.stdout[:1000])
