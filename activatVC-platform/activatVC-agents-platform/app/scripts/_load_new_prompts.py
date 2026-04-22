"""Load new prompt versions from AI agents prompts/ folder."""
import requests
from pathlib import Path

PROMPTS_DIR = Path(r"d:\Programming\Activat VC\AI agents prompts")

MAPPING = {
    "CFO_v7.md":    2,   # CFO
    "CLO_v7.md":    1,   # CLO
    "CHRO_v7.md":   4,   # CHRO
    "CMO_CCO_v8.md": 5,  # CMO+CCO
    "CPO_CTO_v6.md": 6,  # CPO+CTO
}

for fname, agent_id in MAPPING.items():
    fpath = PROMPTS_DIR / fname
    if not fpath.exists():
        print(f"NOT FOUND: {fname}")
        continue
    content = fpath.read_text(encoding="utf-8")
    r = requests.post(
        f"http://localhost:8000/api/v1/agents/{agent_id}/prompts",
        json={"content": content, "format": "text", "comment": f"Imported from {fname}"},
    )
    d = r.json()
    print(f"{fname} -> agent {agent_id}: v{d.get('version', '?')} status={r.status_code}")

print("Done.")
