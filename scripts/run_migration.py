import psycopg2

DB_URL = "postgresql://postgres:***@zephyr.proxy.rlwy.net:23235/railway"
conn = psycopg2.connect(DB_URL)
conn.autocommit = True
cur = conn.cursor()

with open("scripts/recreate_db.sql", "r") as f:
    sql = f.read()

statements = [s.strip() for s in sql.split(";") if s.strip()]
for stmt in statements:
    try:
        cur.execute(stmt + ";")
        print(f"OK: {stmt[:60]}...")
    except Exception as e:
        print(f"ERROR on: {stmt[:60]}... -> {e}")
        conn.rollback()
        raise

cur.close()
conn.close()
print("\nDatabase recreated successfully!")
