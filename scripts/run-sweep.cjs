import "dotenv/config";

const secret = process.env.CRON_SECRET!;
const baseUrl = "https://telegram-referral-bot-gules.vercel.app";

const r1 = await fetch(`${baseUrl}/api/cron/sweep`, {
  headers: { Authorization: `Bearer ${secret}` }
});
console.log(`SWEEP status: ${r1.status}`);
console.log(await r1.text());
