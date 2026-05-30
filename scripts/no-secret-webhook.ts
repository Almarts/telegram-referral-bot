import "dotenv/config";

async function main() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN!;
  
  console.log(`Setting webhook WITHOUT secret_token...`);
  
  // Set webhook without secret_token
  const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: "https://telegram-referral-bot-gules.vercel.app/api/tg/webhook",
      max_connections: 40,
    }),
  });
  const data = await res.json();
  console.log("Result:", JSON.stringify(data));

  const infoRes = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
  const info = await infoRes.json();
  console.log("Info:", JSON.stringify(info));
}

main().catch(console.error);
