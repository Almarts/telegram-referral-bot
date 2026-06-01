const fs = require('fs');
const TOKEN = fs.readFileSync(__dirname + '/bot_token.txt', 'utf8').trim();
const https = require('https');

const payload = JSON.stringify({chat_id: 607645943, text: '/buy'});
const opts = {
  hostname: 'api.telegram.org',
  path: '/bot' + TOKEN + '/sendMessage',
  method: 'POST',
  headers: {'Content-Type': 'application/json'}
};

const req = https.request(opts, (res) => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    const r = JSON.parse(d);
    console.log('ok:', r.ok);
    console.log('result:', JSON.stringify(r.result || r.description).slice(0, 500));
  });
});
req.end(payload);
