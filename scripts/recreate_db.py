"""Recreate PostgreSQL database from SQL schema file.
Uses Python 3.14 (which has psycopg2 installed) via subprocess.
Reads DB URL from .env file."""
import subprocess, sys, os, re

WORKDIR = r"C:\Users\marts\projects\telegram-referral-bot-main"
PYTHON = r"C:\Users\marts\AppData\Local\Programs\Python\Python314\python.exe"
SQL_FILE = r"C:\Users\marts\projects\telegram-referral-bot-main\scripts\recreate_db.sql"
ENV_FILE = r"C:\Users\marts\projects\telegram-referral-bot-main\.env"

# Read .env to get DATABASE_URL
env_vars = {}
with open(ENV_FILE, "r", encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, val = line.split("=", 1)
            env_vars[key.strip()] = val.strip()

db_url = env_vars.get("DATABASE_URL", "")
if not db_url or "***" in db_url:
    print("ERROR: DATABASE_URL not found or has masked password!")
    sys.exit(1)

# Read SQL
with open(SQL_FILE, "r") as f:
    sql_content = f.read()

# Build a Python script that runs via Python 3.14
script = (
    "import psycopg2\n"
    + f'conn = psycopg2.connect("{db_url}")\n'
    + "conn.autocommit = True\n"
    + "cur = conn.cursor()\n"
    + 'sql = """' + sql_content + '"""\n'
    + "statements = [s.strip() for s in sql.split(';') if s.strip()]\n"
    + "for stmt in statements:\n"
    + "    try:\n"
    + "        cur.execute(stmt + ';')\n"
    + "        print(f'OK: {stmt[:60]}...')\n"
    + "    except Exception as e:\n"
    + "        print(f'ERROR on: {stmt[:60]}... -> {e}')\n"
    + "        conn.rollback()\n"
    + "        raise\n"
    + "cur.close()\n"
    + "conn.close()\n"
    + "print('\\nDatabase recreated successfully!')\n"
)

os.environ["PGPASSWORD"] = db_url.split(":***")[1].split("@")[0] if ":***" in db_url else ""

result = subprocess.run(
    [PYTHON, "-c", script],
    capture_output=True,
    timeout=30,
    cwd=WORKDIR
)

out = result.stdout.decode("utf-8", errors="replace")
err = result.stderr.decode("utf-8", errors="replace")

if out:
    print(out)
if err:
    print("STDERR:", err)

if result.returncode != 0:
    print(f"Exit code: {result.returncode}")
    sys.exit(1)
