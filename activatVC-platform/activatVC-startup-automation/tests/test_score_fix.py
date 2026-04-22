"""Test: submit new application, trigger agents, verify scores arrive at master."""
import httpx
import time
import json

MASTER = "http://127.0.0.1:3100"
AGENTS = "http://127.0.0.1:8000"

# 1. Submit a new application
print("=== Step 1: Submit application ===")
form_data = {
    "founderName": "Score Test Founder",
    "founderEmail": "score_test@example.com",
    "startupName": "ScoreTest AI",
    "activityType": "SaaS / B2B-платформа",
    "website": "https://scoretest.example.com",
    "startupStage": "Pre-Seed",
    "country": "USA",
    "city": "San Francisco",
    "teamSize": "3",
    "pitch": "AI-powered analytics platform for SaaS metrics",
    "description": "We build AI analytics for SaaS companies to optimize customer retention and growth metrics.",
    "amountRequested": "500000",
    "revenue": "0",
    "mrr": "0",
    "founders": json.dumps([
        {"name": "Amir Tulegenov", "country": "Kazakhstan", "citizenship": "Kazakhstan", "profiles": ["https://linkedin.com/in/amir"]},
        {"name": "John Smith", "country": "USA", "citizenship": "USA", "profiles": []}
    ]),
}
# Minimal file
files = {
    "documents": ("pitch.txt", b"ScoreTest AI - AI analytics for SaaS. Team of 3. Pre-seed. Seeking $500k.", "text/plain"),
}

r = httpx.post(f"{MASTER}/api/applications", data=form_data, files=files, timeout=120)
print(f"  Status: {r.status_code}")
print(f"  Body: {r.text[:500]}")
app_data = r.json()
app_id = app_data.get("id") or app_data.get("application", {}).get("id")
print(f"  Application ID: {app_id}")
print(f"  Magic token: {app_data.get('magicToken', 'N/A')}")

if not app_id:
    print("FAILED: no application ID returned")
    exit(1)

# 2. Trigger agents via webhook
print("\n=== Step 2: Trigger agents ===")
r = httpx.post(
    f"{AGENTS}/api/v1/webhook/trigger",
    json={"applicationId": app_id, "event": "new_application"},
    timeout=30,
)
print(f"  Status: {r.status_code}")
trigger_data = r.json()
run_id = trigger_data.get("run_id")
print(f"  Run ID: {run_id}")

# 3. Poll agents platform until all complete
print("\n=== Step 3: Polling agent tasks ===")
for attempt in range(60):
    time.sleep(5)
    r = httpx.get(f"{AGENTS}/api/v1/runs/{run_id}", timeout=30)
    run_data = r.json()
    tasks = run_data.get("tasks", [])
    completed = sum(1 for t in tasks if t.get("status") == "completed")
    total = len(tasks)
    print(f"  [{attempt*5}s] {completed}/{total} agents done")
    if completed == total and total > 0:
        break
else:
    print("  TIMEOUT waiting for agents")

# 4. Check master agent for scores
print("\n=== Step 4: Check master agent results ===")
time.sleep(3)  # Give aggregation time to finish
r = httpx.get(f"{MASTER}/api/applications/{app_id}", timeout=30)
detail = r.json()
print(f"  Status: {detail.get('status')}")
print(f"  Investment Score: {detail.get('investmentScore')}")
print(f"  Verdict: {detail.get('verdict')}")
print(f"  Hero Phrase: {(detail.get('heroPhrase') or 'N/A')[:100]}")
print(f"  Agent Runs:")
for ar in detail.get("agentRuns", []):
    score = ar.get("score")
    agent = ar.get("agentName")
    resp_payload = ar.get("responsePayload")
    resp_len = len(json.dumps(resp_payload or {}))
    print(f"    {agent}: score={score}, responsePayload_len={resp_len}")

# Summary
inv = detail.get("investmentScore")
if inv and inv > 0:
    print(f"\n✅ SUCCESS! Investment score = {inv}, verdict = {detail.get('verdict')}")
else:
    print(f"\n❌ Investment score is {inv}, verdict={detail.get('verdict')}, status={detail.get('status')}")
    print("   Checking if scores were at least stored...")
    has_scores = any(ar.get("score") is not None for ar in detail.get("agentRuns", []))
    print(f"   Any agent has score? {has_scores}")
