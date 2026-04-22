"""
Import .docx prompt files into agents as new prompt versions.

Usage (from agents_platform-main):
  python -m app.scripts.import_docx_prompts --prompts-dir "../prompts" --dry-run
  python -m app.scripts.import_docx_prompts --prompts-dir "../prompts" --apply
    python -m app.scripts.import_docx_prompts --prompts-dir "../prompts" --apply --master-output "../startup-automation/config/master_orchestrator_prompt_v4.md"

Default mapping:
- CFO.docx        -> CFO
- CHRO.docx       -> CHRO
- CMO + CCO.docx  -> CMO+CCO
- CPO+CTO.docx    -> CPO+CTO
- CLO.docx        -> CLO
- VentureIQ_ProcessFlow_v4.docx -> extracted as master prompt file if --master-output is provided

You can customize mapping via --map-json with structure:
{
    "CLO.docx": ["CLO"],
    "CMO + CCO.docx": ["CMO+CCO"]
}
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, UTC
from pathlib import Path

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.agent import Agent, PromptFormat
from app.schemas.agent import AgentPromptCreate
from app.services.agent_service import AgentService


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import .docx prompts into agent prompt versions")
    parser.add_argument("--prompts-dir", required=True, help="Path to folder with .docx files")
    parser.add_argument("--map-json", required=False, help="Optional JSON file to override filename->roles mapping")
    parser.add_argument(
        "--master-output",
        required=False,
        help="Optional output .md path for VentureIQ_ProcessFlow_v4.docx (master orchestrator prompt source)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without writing to DB")
    parser.add_argument("--apply", action="store_true", help="Write new prompt versions to DB")
    args = parser.parse_args()

    if args.dry_run and args.apply:
        raise ValueError("Use either --dry-run or --apply, not both")
    if not args.dry_run and not args.apply:
        args.dry_run = True

    return args


def default_mapping() -> dict[str, list[str]]:
    return {
        "CFO.docx": ["CFO"],
        "CHRO.docx": ["CHRO"],
        "CMO + CCO.docx": ["CMO+CCO"],
        "CPO+CTO.docx": ["CPO+CTO"],
        "CLO.docx": ["CLO"],
        "VentureIQ_ProcessFlow_v4.docx": [],
    }


def load_mapping(map_json: str | None) -> dict[str, list[str]]:
    mapping = default_mapping()
    if not map_json:
        return mapping

    custom = json.loads(Path(map_json).read_text(encoding="utf-8"))
    for key, value in custom.items():
        if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
            raise ValueError(f"Invalid mapping for {key}: must be list[str]")
        mapping[key] = [v.upper() for v in value]
    return mapping


def extract_docx_text(path: Path) -> str:
    import docx

    doc = docx.Document(str(path))
    paragraphs = [p.text.strip() for p in doc.paragraphs if p.text and p.text.strip()]
    return "\n".join(paragraphs)


async def import_prompts(prompts_dir: Path, mapping: dict[str, list[str]], dry_run: bool) -> int:
    created = 0
    docx_files = sorted(prompts_dir.glob("*.docx"))

    if not docx_files:
        print(f"No .docx files found in {prompts_dir}")
        return 0

    async with AsyncSessionLocal() as db:
        service = AgentService(db)

        result = await db.execute(select(Agent.role))
        existing_roles = {row[0] for row in result.all()}

        print(f"Found {len(docx_files)} .docx files")
        print(f"Existing agent roles in DB: {sorted(existing_roles)}")

        for file_path in docx_files:
            roles = mapping.get(file_path.name)
            if roles is None:
                guessed = file_path.stem.replace(" ", "").replace("+", " ").replace("_", " ").upper()
                roles = [guessed] if guessed in existing_roles else []

            text = extract_docx_text(file_path)
            if not text.strip():
                print(f"[skip] {file_path.name}: empty extracted text")
                continue

            if not roles:
                print(f"[warn] {file_path.name}: no target role mapping. Skipped.")
                continue

            for role in roles:
                role = role.upper().strip()
                if role not in existing_roles:
                    print(f"[warn] {file_path.name} -> {role}: role not found in DB. Skipped.")
                    continue

                if dry_run:
                    print(f"[dry-run] {file_path.name} -> {role} (chars={len(text)})")
                    continue

                agent = await service.get_agent_by_role(role)
                if not agent:
                    print(f"[warn] {file_path.name} -> {role}: role not found by service. Skipped.")
                    continue

                prompt = await service.create_prompt_version(
                    agent_id=agent.id,
                    data=AgentPromptCreate(
                        content=text,
                        format=PromptFormat.DOCX.value,
                        file_path=str(file_path.as_posix()),
                        comment=f"Imported from {file_path.name} at {datetime.utcnow().isoformat()}",
                    ),
                    created_by="prompt-import",
                )
                created += 1
                print(f"[ok] {file_path.name} -> {role} as prompt v{prompt.version}")

    return created


def export_master_prompt(prompts_dir: Path, output_path: Path, dry_run: bool) -> None:
    source = prompts_dir / "VentureIQ_ProcessFlow_v4.docx"
    if not source.exists():
        print("[warn] VentureIQ_ProcessFlow_v4.docx not found. Master prompt export skipped.")
        return

    text = extract_docx_text(source)
    if not text.strip():
        print("[warn] VentureIQ_ProcessFlow_v4.docx extracted empty text. Master prompt export skipped.")
        return

    content = (
        "# Master Orchestrator Prompt (V4 source)\n\n"
        f"Imported from: {source.as_posix()}\n"
        f"Imported at: {datetime.utcnow().isoformat()}\n\n"
        "---\n\n"
        f"{text}\n"
    )

    if dry_run:
        print(f"[dry-run] would export master prompt to {output_path}")
        return

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(content, encoding="utf-8")
    print(f"[ok] exported master prompt to {output_path}")


async def main() -> None:
    import asyncio

    args = parse_args()
    prompts_dir = Path(args.prompts_dir).resolve()

    if not prompts_dir.exists() or not prompts_dir.is_dir():
        raise FileNotFoundError(f"prompts dir not found: {prompts_dir}")

    mapping = load_mapping(args.map_json)
    created = await import_prompts(prompts_dir=prompts_dir, mapping=mapping, dry_run=args.dry_run)

    if args.master_output:
        export_master_prompt(
            prompts_dir=prompts_dir,
            output_path=Path(args.master_output).resolve(),
            dry_run=args.dry_run,
        )

    if args.dry_run:
        print("\nDry-run completed. Use --apply to write new prompt versions.")
    else:
        print(f"\nImport completed. Created {created} new prompt versions.")


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
