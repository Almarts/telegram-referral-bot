CRON_SECRET=***0d2a7e***f4a">/dev/null
source /c/Users/marts/projects/telegram-referral-bot-main/.env.local
curl -s "https://telegram-referral-bot-gules.vercel.app/api/cron/payout-queue" \
  -H "Authorization: Bearer $CRON_SECRET"