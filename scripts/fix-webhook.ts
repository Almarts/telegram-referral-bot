import "dotenv/config";

async function main() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN!;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET!;

  const WEBHOOK_URL = "https://telegram-referral-bot-gules.vercel.app/api/tg/webhook";
  
  console.log(`Setting webhook URL: ${WEBHOOK_URL}`);
  console.log(`With secret_token: ${secret.substring(0, 8)}...`);

  // Set webhook
  const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: WEBHOOK_URL,
      secret_token: secret,
      max_connections: 40,
    }),
  });
  const data = await res.json();
  console.log("Result:", JSON.stringify(data, null, 2));

  // Verify
  const infoRes = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
  const info = await infoRes.json();
  console.log("\nWebhook info:", JSON.stringify(info, null, 2));
}

main().catch(console.error);
