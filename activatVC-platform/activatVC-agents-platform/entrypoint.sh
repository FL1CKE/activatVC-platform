#!/bin/sh
set -e

echo "⏳ Waiting for PostgreSQL..."

until python -c "
import socket, os, sys, re
url = os.environ.get('DATABASE_URL','')
try:
    m = re.match(r'postgresql(?:\+asyncpg)?://[^@]+@([^:/]+):(\d+)/', url)
    if not m:
        raise Exception('Cannot parse DATABASE_URL: ' + url)
    host, port = m.group(1), int(m.group(2))
    s = socket.create_connection((host, port), timeout=3)
    s.close()
    sys.exit(0)
except Exception as e:
    print(f'  not ready: {e}')
    sys.exit(1)
" 2>/dev/null; do
    sleep 2
done

echo "✅ PostgreSQL ready"
echo "🔄 Running migrations..."
alembic upgrade head

echo "🌱 Seeding agents..."
python -m app.scripts.seed_agents

echo "🚀 Starting on :8000"
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1 --log-level info
