import subprocess
r = subprocess.run(
    ['curl', '-s', 'https://telegram-referral-bot-gules.vercel.app/api/cron/payout-queue',
     '-H', 'Authorization: Bearer ***    capture_output=True, text=True, timeout=30)
print(r.stdout)
