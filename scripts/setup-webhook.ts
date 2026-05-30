import "dotenv/config";

const WEBHOOK_URL = "https://telegram-referral-bot-gules.vercel.app/api/tg/webhook";

async function main() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  
  if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN not set");
  if (!secret) throw new Error("TELEGRAM_WEBHOOK_SECRET not set");

  console.log(`Token: ${botToken.substring(0, 12)}...${botToken.substring(botToken.length-5)}`);
  console.log(`Webhook URL: ${WEBHOOK_URL}`);

  // Set webhook
  const setRes = await fetch(
    `https://api.telegram.org/bot${botToken}/setWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: WEBHOOK_URL,
        secret_token: secret,
      }),
    }
  );
  const setData = await setRes.json();
  console.log("setWebhook:", JSON.stringify(setData));

  // Check webhook info
  const infoRes = await fetch(
    `https://api.telegram.org/bot${botToken}/getWebhookInfo`
  );
  const infoData = await infoRes.json();
  console.log("getWebhookInfo:", JSON.stringify(infoData));
}

main().catch(console.error);
