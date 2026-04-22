"""Clean test: submit new application, trigger once, verify scores + aggregation."""
import httpx
import time
import json

MASTER = "http://127.0.0.1:3100"
AGENTS = "http://127.0.0.1:8000"

print("=== Step 1: Submit fresh application ===")
form_data = {
    "founderName": "Demo Founder",
    "founderEmail": "demo@example.com",
    "startupName": "DemoFlow AI",
    "activityType": "SaaS / B2B-платформа",
    "website": "https://demoflow.example.com",
    "startupStage": "Pre-Seed",
    "description": "AI-powered analytics platform for SaaS metrics. We use ML to predict churn and optimize customer LTV.",
    "amountRequested": "500000",
    "revenue": "0",
    "mrr": "0",
    "founders": json.dumps([
        {"name": "Amir Tulegenov", "country": "Kazakhstan", "citizenship": "Kazakhstan", "profiles": ["https://linkedin.com/in/amir"]},
        {"name": "John Smith", "country": "USA", "citizenship": "USA", "profiles": []}
    ]),
}
files = {
    "documents": ("pitch_deck.pdf", b"DemoFlow AI - AI SaaS analytics. Pre-seed. $500k raise. Team of 3 from KZ and US. Product in private beta.", "application/pdf"),
}

r = httpx.post(f"{MASTER}/api/applications", data=form_data, files=files, timeout=120)
print(f"  Status: {r.status_code}")
app_data = r.json()
app_obj = app_data.get("application", {})
app_id = app_obj.get("id")
print(f"  Application ID: {app_id}")
print(f"  Magic token: {app_data.get('magicToken', 'N/A')}")

if not app_id:
    print(f"FAILED: {r.text[:300]}")
    exit(1)

# 2. Trigger agents exactly once
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

# 3. Poll agents
print("\n=== Step 3: Polling agent tasks ===")
for attempt in range(60):
    time.sleep(5)
    r = httpx.get(f"{AGENTS}/api/v1/runs/{run_id}", timeout=30)
    run_data = r.json()
    tasks = run_data.get("tasks", [])
    completed = sum(1 for t in tasks if t.get("status") == "completed")
    total = len(tasks)
    elapsed = attempt * 5
    print(f"  [{elapsed}s] {completed}/{total} agents done")
    if completed == total and total > 0:
        break
else:
    print("  TIMEOUT waiting for agents")

# 4. Wait a moment for aggregation then check
print("\n=== Step 4: Check master agent results ===")
time.sleep(5)
r = httpx.get(f"{MASTER}/api/applications/{app_id}", timeout=30)
detail = r.json()
print(f"  Status: {detail.get('status')}")
print(f"  Investment Score: {detail.get('investmentScore')}")
print(f"  Verdict: {detail.get('verdict')}")
print(f"  Hero Phrase: {(detail.get('heroPhrase') or 'N/A')[:120]}")
print(f"  Agent Runs ({len(detail.get('agentRuns', []))}):")
for ar in detail.get("agentRuns", []):
    score = ar.get("score")
    agent = ar.get("agentName")
    rp = ar.get("responsePayload")
    rp_len = len(json.dumps(rp or {}))
    print(f"    {agent}: score={score}, responsePayload_len={rp_len}")

inv = detail.get("investmentScore")
verdict = detail.get("verdict")
if inv is not None and inv > 0:
    print(f"\n{'='*50}")
    print(f"SUCCESS! Investment score = {inv}, verdict = {verdict}")
    print(f"{'='*50}")
else:
    print(f"\nInvestment score is {inv}, verdict={verdict}")
    # Additional diagnostics
    print("\nDiagnostics:")
    for ar in detail.get("agentRuns", []):
        print(f"  {ar.get('agentName')}: round={ar.get('round')}, status={ar.get('status')}")
