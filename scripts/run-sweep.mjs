const dotenv = require("dotenv");
dotenv.config();

async function main() {
  const secret = process.env.CRON_SECRET;
  const baseUrl = "https://telegram-referral-bot-gules.vercel.app";
  
  console.log("=== SWEEP ===");
  const r1 = await fetch(`${baseUrl}/api/cron/sweep`, {
    headers: { Authorization: `Bearer ${secret}` }
  });
  console.log(`Status: ${r1.status}`);
  console.log(await r1.text());
}
main().catch(console.error);
