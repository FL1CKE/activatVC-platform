"""Test full founder → master agent → sub-agents flow."""
import httpx, time, json, sys

MASTER = "http://127.0.0.1:3100"
AGENTS = "http://127.0.0.1:8000"

print("=== FULL FLOW TEST ===\n")

# 1. Health checks
r1 = httpx.get(f"{MASTER}/ping")
print(f"Master agent: {r1.json()}")

r2 = httpx.get(f"{AGENTS}/health")
print(f"Agents platform: {r2.json()}")

# 2. Submit a new application (founder)
print("\n--- Submitting application ---")
app_data = {
    "startupName": "TestFlow AI",
    "founderEmail": "amir@testflow.ai",
    "startupType": "deep_tech",
    "startupStage": "pre-seed",
    "activityType": "SaaS / B2B-платформа",
    "description": "AI-powered workflow automation for Central Asian SMBs. We automate document processing and customer support using fine-tuned LLMs. Our MVP is live with 15 paying customers in Uzbekistan and Kazakhstan.",
    "investmentAmount": "150000",
    "investmentCurrency": "USD",
    "founders": json.dumps([
        {
            "name": "Amir Karimov",
            "email": "amir@testflow.ai",
            "country": "Uzbekistan",
            "citizenship": "Uzbekistan",
            "linkedin": "https://linkedin.com/in/amir-karimov"
        },
        {
            "name": "Daria Novak",
            "email": "daria@testflow.ai",
            "country": "Kazakhstan",
            "citizenship": "Kazakhstan",
            "linkedin": "https://linkedin.com/in/daria-novak"
        }
    ]),
    "hasRnD": "true",
}

r = httpx.post(f"{MASTER}/api/applications", data=app_data, files=[
    ("documents", ("pitch_deck.txt", b"TestFlow AI - Pitch Deck\n\nProblem: SMBs in Central Asia waste 40% of time on manual document processing.\nSolution: AI-powered automation using fine-tuned LLMs.\nMVP live with 15 paying customers.\nAsking $150K pre-seed.", "text/plain")),
    ("documents", ("financials.txt", b"Monthly Revenue: $3,200\nMRR Growth: 25% MoM\nBurn Rate: $8,000/mo\nRunway: 12 months\nTeam: 4 people", "text/plain")),
], timeout=120)
print(f"Submit status: {r.status_code}")
if r.status_code not in (200, 201):
    print(f"ERROR: {r.text[:500]}")
    sys.exit(1)

app = r.json()
app_id = app.get("id") or app.get("application", {}).get("id")
magic_token = app.get("magicToken") or app.get("magic_token") or app.get("magicLink", "")
print(f"Application ID: {app_id}")
print(f"Magic token/link: {magic_token}")

# 3. Check application status
r = httpx.get(f"{MASTER}/api/applications/{app_id}")
if r.status_code == 200:
    data = r.json()
    status = data.get("status", "?")
    gaps = data.get("gapItems", data.get("gaps", []))
    print(f"\nApplication status: {status}")
    print(f"Gap items: {len(gaps) if isinstance(gaps, list) else gaps}")
    if isinstance(gaps, list) and gaps:
        for g in gaps[:5]:
            title = g.get("title", g.get("question", "?"))
            gtype = g.get("gapType", "?")
            gstatus = g.get("status", "?")
            print(f"  [{gtype}] {gstatus}: {title[:80]}")

# 4. Try magic link portal
if magic_token:
    # The token might be a full URL or just the token
    token = magic_token.split("/")[-1] if "/" in str(magic_token) else magic_token
    r = httpx.get(f"{MASTER}/api/magic/{token}")
    print(f"\nMagic portal: {r.status_code}")
    if r.status_code == 200:
        portal = r.json()
        print(f"  Startup: {portal.get('startupName', '?')}")
        print(f"  Status: {portal.get('status', '?')}")

# 5. Check agent runs
r = httpx.get(f"{MASTER}/api/applications/{app_id}/agent-runs")
if r.status_code == 200:
    runs = r.json()
    if isinstance(runs, list):
        print(f"\nAgent runs: {len(runs)}")
        for ar in runs:
            agent = ar.get("agentName", "?")
            status = ar.get("status", "?")
            score = ar.get("score", "?")
            print(f"  {agent}: {status} (score={score})")
    elif isinstance(runs, dict):
        items = runs.get("items", runs.get("agentRuns", []))
        print(f"\nAgent runs: {len(items)}")

# 6. List all apps
r = httpx.get(f"{MASTER}/api/applications")
if r.status_code == 200:
    apps_data = r.json()
    apps_list = apps_data if isinstance(apps_data, list) else apps_data.get("items", apps_data.get("applications", []))
    print(f"\nTotal applications: {len(apps_list)}")

print("\n=== DONE ===")
print(f"\nFrontend:        http://localhost:5173")
print(f"Master API docs: http://127.0.0.1:3100/ping")
print(f"Agents platform: http://127.0.0.1:8000")
if magic_token:
    token_str = magic_token.split("/")[-1] if "/" in str(magic_token) else magic_token
    print(f"Founder portal:  http://localhost:5173/magic/{token_str}")
