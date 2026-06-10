import subprocess
curl_args = [
    'curl', '-s',
    'https://telegram-referral-bot-gules.vercel.app/api/cron/sweep',
    '-H', 'Authorization: Bearer ***]
r = subprocess.run(curl_args, capture_output=True, text=True, timeout=30)
print("Sweep:", r.stdout)
