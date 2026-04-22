"""Test webhook integration between master agent and agents platform."""
import httpx, time, json, sys

MASTER = "http://127.0.0.1:3100"
AGENTS = "http://127.0.0.1:8000"
APP_ID = "6e1c4889-07f1-4b14-9238-32f43a7792d3"

print("=== WEBHOOK INTEGRATION TEST ===\n")

# 1. Verify data endpoint works (what agents will fetch)
print("--- Testing data fetch endpoint ---")
r = httpx.get(f"{MASTER}/api/webhooks/startups/{APP_ID}/data")
print(f"Master /data: {r.status_code}")
if r.status_code == 200:
    data = r.json()
    app_info = data.get("application", {})
    docs = data.get("documents", [])
    print(f"  Startup: {app_info.get('startupName', '?')}")
    print(f"  Documents: {len(docs)}")
    for d in docs:
        print(f"    - {d.get('originalName', '?')}: {d.get('fileUrl', '?')[:60]}")
else:
    print(f"  ERROR: {r.text[:300]}")

# 2. Trigger webhook
print("\n--- Triggering agents via webhook ---")
r = httpx.post(f"{AGENTS}/api/v1/webhook/trigger", json={
    "applicationId": APP_ID,
    "event": "new_application",
}, timeout=30)
print(f"Webhook response: {r.status_code}")
if r.status_code == 202:
    resp = r.json()
    run_id = resp.get("run_id")
    print(f"  Run ID: {run_id}")
    
    # 3. Poll until complete
    print("\n--- Polling agent analysis ---")
    t0 = time.time()
    while True:
        time.sleep(10)
        elapsed = time.time() - t0
        r = httpx.get(f"{AGENTS}/api/v1/runs/{run_id}")
        run_data = r.json()
        status = run_data["status"]
        tasks = run_data.get("tasks", [])
        completed = sum(1 for t in tasks if t["status"] == "completed")
        total = len(tasks)
        
        agent_statuses = [f"{t.get('agent_role','?')}={t['status']}" for t in tasks]
        print(f"  [{elapsed:5.0f}s] {status:12s} {completed}/{total} ({', '.join(agent_statuses)})")
        
        if status in ("completed", "failed", "waiting_data"):
            break
        if elapsed > 600:
            print("  TIMEOUT")
            break
    
    # 4. Show results
    elapsed = time.time() - t0
    print(f"\n=== RESULT: {status} in {elapsed:.1f}s ===")
    for t in tasks:
        role = t.get("agent_role", "?")
        s = t["status"]
        report_len = len(t.get("report_content") or "")
        tokens = t.get("tokens_used") or 0
        err = t.get("error_message") or ""
        print(f"  {role:12s}  {s:12s}  report={report_len:6d}ch  tokens={tokens:5d}  err={err[:60]}")
else:
    print(f"  ERROR: {r.text[:500]}")

# 5. Check master agent side
print("\n--- Master agent status ---")
r = httpx.get(f"{MASTER}/api/applications/{APP_ID}/agent-runs")
if r.status_code == 200:
    runs = r.json()
    runs_list = runs if isinstance(runs, list) else runs.get("items", [])
    print(f"Agent runs recorded: {len(runs_list)}")
    for ar in runs_list:
        print(f"  {ar.get('agentName','?')}: {ar.get('status','?')} score={ar.get('score','?')}")

print("\n=== DONE ===")
