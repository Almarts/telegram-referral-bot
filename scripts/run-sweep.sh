#!/bin/bash
# Run sweep via curl
source .env.local
curl -s "https://telegram-referral-bot-gules.vercel.app/api/cron/sweep" \
  -H "Authorization: Bearer ${CRON_SECRET}" 2>&1
