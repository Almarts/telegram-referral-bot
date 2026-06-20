
import json, urllib.request

TOKEN = "ghp_OT...N7EL"
HEADERS = {
    'Authorization': f'Bearer {TOKEN}',
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'hermes'
}

req = urllib.request.Request(
    'https://api.github.com/user',
    headers=HEADERS
)
try:
    resp = urllib.request.urlopen(req)
    data = json.loads(resp.read())
    print(f"User: {data.get('login')} | Token: OK | Scopes: {resp.headers.get('X-OAuth-Scopes')}")
except Exception as e:
    print(f'Error: {e}')
    if hasattr(e, 'read'):
        print(e.read().decode())
