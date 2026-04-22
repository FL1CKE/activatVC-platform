"""
Load Russian prompts from startup-automation/storage/prompts/*.txt
into agents_platform integration_agents.db (table agent_prompts).

Each run:
1. Deactivates all current versions for the agent
2. Inserts a new version with is_active=1
"""
import sqlite3
import os
import datetime

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKSPACE_DIR = os.path.dirname(BASE_DIR)

PROMPTS_DIR = os.path.join(WORKSPACE_DIR, 'startup-automation', 'storage', 'prompts')
DB_PATH = os.path.join(BASE_DIR, 'integration_agents.db')

ROLE_TO_FILE = {
    'CLO':     'CLO.txt',
    'CFO':     'CFO.txt',
    'CHRO':    'CHRO.txt',
    'CMO+CCO': 'CMO+CCO.txt',
    'CPO+CTO': 'CPO+CTO.txt',
}


def main() -> None:
    if not os.path.isfile(DB_PATH):
        print(f'ERROR: DB not found at {DB_PATH}')
        return

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    cur.execute('SELECT id, role FROM agents')
    agents = {row[1]: row[0] for row in cur.fetchall()}
    print(f'Agents in DB: {list(agents.keys())}')

    ok = 0
    for role, fname in ROLE_TO_FILE.items():
        agent_id = agents.get(role)
        if not agent_id:
            print(f'SKIP {role} — not found in agents table')
            continue

        fpath = os.path.join(PROMPTS_DIR, fname)
        if not os.path.isfile(fpath):
            print(f'SKIP {role} — file not found: {fpath}')
            continue

        with open(fpath, encoding='utf-8') as f:
            content = f.read()

        cur.execute(
            'SELECT COALESCE(MAX(version), 0) FROM agent_prompts WHERE agent_id=?',
            (agent_id,),
        )
        max_ver = cur.fetchone()[0]
        new_ver = max_ver + 1

        cur.execute(
            'UPDATE agent_prompts SET is_active=0 WHERE agent_id=?',
            (agent_id,),
        )
        cur.execute(
            '''INSERT INTO agent_prompts
               (agent_id, version, is_active, content, format, comment, created_at, created_by)
               VALUES (?, ?, 1, ?, 'text', 'Loaded from startup-automation/storage/prompts', ?, 'load_russian_prompts.py')''',
            (agent_id, new_ver, content, datetime.datetime.utcnow().isoformat()),
        )
        print(f'OK  {role:10s}  v{new_ver}  ({len(content)} chars)')
        ok += 1

    conn.commit()
    conn.close()
    print(f'\nDone: {ok}/{len(ROLE_TO_FILE)} agents updated.')


if __name__ == '__main__':
    main()
