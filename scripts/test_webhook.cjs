const https = require('https');

const payload = JSON.stringify({
  update_id: 9999999,
  message: {
    message_id: 200,
    from: { id: 607645943, is_bot: false, first_name: 'Alex', language_code: 'ru' },
    chat: { id: 607645943, first_name: 'Alex', type: 'private' },
    date: Math.floor(Date.now()/1000),
    text: '/buy',
    entities: [{ offset: 0, length: 4, type: 'bot_command' }]
  }
});

const opts = {
  hostname: 'telegram-referral-bot-gules.vercel.app',
  path: '/api/tg/webhook',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
};

const req = https.request(opts, (res) => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', d);
  });
});
req.end(payload);
