"""One-time script: hard-delete CRO agent (id=3) from the database."""
import psycopg2

DB_URL = "postgresql://admin:adminpassword@localhost:5433/agents_platform"

conn = psycopg2.connect(DB_URL)
conn.autocommit = False
cur = conn.cursor()

try:
    # Check tables
    cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")
    tables = [r[0] for r in cur.fetchall()]
    print("Tables:", tables)

    # Check rows referencing agent_id=3
    for t in ['agent_tasks', 'agent_prompts', 'agent_api_key_history']:
        if t in tables:
            cur.execute(f"SELECT count(*) FROM {t} WHERE agent_id=3")
            count = cur.fetchone()[0]
            print(f"  {t}: {count} rows with agent_id=3")

    # NULL out the prompt_version_id FK first, then delete in order
    cur.execute("UPDATE agent_tasks SET prompt_version_id=NULL WHERE agent_id=3")
    print(f"  Nulled prompt_version_id on {cur.rowcount} agent_tasks")
    # Delete child records first, then agent
    for t in ['agent_tasks', 'agent_api_key_history', 'agent_prompts']:
        if t in tables:
            cur.execute(f"DELETE FROM {t} WHERE agent_id=3")
            print(f"  Deleted {cur.rowcount} rows from {t}")

    cur.execute("DELETE FROM agents WHERE id=3")
    print(f"Deleted {cur.rowcount} rows from agents (CRO)")

    conn.commit()
    print("Done - CRO agent permanently removed from DB.")
except Exception as e:
    conn.rollback()
    print(f"ERROR: {e}")
    raise
finally:
    cur.close()
    conn.close()
