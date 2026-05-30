import "dotenv/config";

async function main() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN!;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET!;
  
  console.log(`Token: ${botToken.substring(0, 12)}...${botToken.substring(botToken.length-5)}`);
  console.log(`Secret: ${secret.substring(0, 8)}...`);

  // Get webhook status
  const infoRes = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
  const info = await infoRes.json();
  console.log("\nWebhook info:", JSON.stringify(info, null, 2));

  // Re-set webhook to refresh
  const setRes = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: "https://telegram-referral-bot-gules.vercel.app/api/tg/webhook",
      secret_token: secret,
    }),
  });
  const setData = await setRes.json();
  console.log("\nSet webhook:", JSON.stringify(setData));

  // Send test message
  const sendRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: 607645943,
      text: "Бот перезапущен! ✅ Напиши /start",
    }),
  });
  const sendData = await sendRes.json();
  console.log("\nSend test:", JSON.stringify(sendData));
}

main().catch(console.error);
