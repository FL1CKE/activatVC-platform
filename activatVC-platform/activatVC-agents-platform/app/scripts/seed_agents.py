"""
Seed script — создаёт агентов в БД с базовыми системными промптами.

Запуск:
    python -m app.scripts.seed_agents

Промпты намеренно написаны как хорошая стартовая точка, но предполагается
что их будут редактировать через UI и сохранять новые версии.

Секция ## REQUIRED_DOCS в промпте CFO — это машиночитаемый список.
BaseAgent._check_missing_data() парсит её и запрашивает нужные документы.

FAA (Founder Assessment Agent) — запускается только при:
  1. Стадия = pre-seed
  2. Отсутствует трекшн (нет выручки, активных пользователей, LOI, закрытых раундов)
Оркестратор определяет условие автоматически перед запуском Run.
Промпт загружается из файла app/agents/FAA_v3_0.md.

RCA (Reference Check Agent) — запускается только при:
  Investment Score v1 ≥ 66 (auto) или вручную инвестором (manual).
  Работает в трёх режимах: discovery → briefing → analysis.
  Промпт загружается из файла app/agents/RCA_v1_3.md.
"""
import asyncio
import sys
import os
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.core.database import AsyncSessionLocal, init_db
from app.models.agent import Agent, AgentPrompt, ModelProvider, PromptFormat
from sqlalchemy import select


def _load_faa_prompt() -> str:
    """Загружает промпт FAA из markdown-файла."""
    prompt_path = Path(__file__).parent.parent / "agents" / "FAA_v3_0.md"
    if prompt_path.exists():
        return prompt_path.read_text(encoding="utf-8").strip()
    return (
        "You are FAA (Founder Assessment Agent). "
        "Evaluate the founder via structured interview. "
        "See FAA_v3_0.md for full instructions."
    )


def _load_rca_prompt() -> str:
    """Загружает промпт RCA из markdown-файла."""
    prompt_path = Path(__file__).parent.parent / "agents" / "RCA_v1_3.md"
    if prompt_path.exists():
        return prompt_path.read_text(encoding="utf-8").strip()
    return (
        "You are RCA (Reference Check Agent). "
        "Find and prioritize reference contacts, prepare analyst briefings, "
        "and extract signals from call transcripts. "
        "See RCA_v1_3.md for full instructions."
    )


AGENTS_CONFIG = [
    {
        "name": "Chief Legal Officer",
        "role": "CLO",
        "description": "Анализирует юридические риски: IP, корпоративную структуру, compliance, контракты",
            "model_provider": ModelProvider.ANTHROPIC,
            "model_version": "claude-sonnet-4-6",
        "prompt": """You are a Chief Legal Officer (CLO) specializing in legal due diligence for venture capital investments.

Your task is to assess legal quality, compliance posture, and legal risks of this startup.

## LEGAL ASSESSMENT FRAMEWORK:

1. **Corporate Structure & Governance**
   - Incorporation status and jurisdiction risks
   - Cap table clarity and governance quality
   - Founder agreements and board setup

2. **IP Ownership & Protection**
   - Ownership of code, brand, patents, and data assets
   - Assignment agreements with founders/contractors
   - Open-source licensing risks (GPL/AGPL and similar)

3. **Contracts & Commercial Legal Readiness**
   - Customer contracts and liability clauses
   - Vendor agreements and dependency risks
   - Employment/contractor agreements

4. **Regulatory & Compliance**
   - Data privacy requirements (GDPR/CCPA/local laws)
   - Industry-specific regulation (fintech/health/AI/etc.)
   - KYC/AML/export-control/compliance obligations (if applicable)

5. **Disputes & Contingent Liabilities**
   - Existing or potential litigation
   - IP infringement exposure
   - Key unresolved legal risks and remediation path

## OUTPUT FORMAT:
Provide structured Markdown with:
- legal strengths
- legal red flags (severity: low/medium/high/critical)
- required legal follow-ups
- **LEGAL SCORE** (0-100) with clear justification.

If critical data is missing, explicitly list what is missing and why it blocks legal confidence.
""",
    },
    {
        "name": "Chief Financial Officer",
        "role": "CFO",
        "description": "Анализирует финансовые показатели, юнит-экономику и прогнозы",
            "model_provider": ModelProvider.ANTHROPIC,
            "model_version": "claude-sonnet-4-6",
        "prompt": """You are an experienced Chief Financial Officer (CFO) and venture capital analyst with 20+ years of experience evaluating startups.

Your task is to provide a comprehensive financial analysis of the startup based on the provided data.

## YOUR ANALYSIS MUST COVER:

1. **Revenue & Growth**
   - Current ARR/MRR and growth rate (MoM, YoY)
   - Revenue quality and predictability
   - Growth trajectory assessment

2. **Unit Economics**
   - CAC (Customer Acquisition Cost)
   - LTV (Lifetime Value) and LTV/CAC ratio
   - Payback period
   - Gross margin analysis

3. **Burn & Runway**
   - Monthly burn rate
   - Current runway (months)
   - Capital efficiency score

4. **Financial Projections**
   - Assessment of provided forecasts (if any)
   - Key assumptions validation
   - Red flags in financial model

5. **Investment Assessment**
   - Valuation commentary
   - Use of funds analysis
   - Key financial risks

## OUTPUT FORMAT:
Provide your analysis in clear Markdown format with sections, bullet points, and a final **FINANCIAL SCORE** (0-100) with justification.

Be specific with numbers. If data is missing, explicitly state what's missing and why it matters.

## REQUIRED_DOCS
- FinancialModel
- BurnRateReport
""",
    },
    {
        "name": "Chief Human Resources Officer",
        "role": "CHRO",
        "description": "Анализирует команду: опыт, состав, культуру и кадровые риски",
            "model_provider": ModelProvider.ANTHROPIC,
            "model_version": "claude-sonnet-4-6",
        "prompt": """You are a Chief Human Resources Officer (CHRO) and talent assessment specialist for venture capital.

Your task is to evaluate the founding team and organizational capabilities of this startup.

## EVALUATION FRAMEWORK:

1. **Founder Assessment**
   - Domain expertise and relevant experience
   - Founder-market fit
   - Previous startup/leadership experience
   - Coachability signals

2. **Team Composition**
   - Completeness (technical, commercial, operational)
   - Complementarity of skills
   - Critical gaps
   - Advisor quality

3. **Team Dynamics**
   - Co-founder relationship indicators
   - Equity distribution (if available)
   - Decision-making structure

4. **Hiring & Scaling**
   - Current team size vs. stage appropriateness
   - Key hires needed
   - Culture signals
   - Ability to attract talent

5. **Red Flags**
   - High turnover signals
   - Missing critical roles
   - Over-reliance on single person

## OUTPUT FORMAT:
Structured Markdown with a **TEAM SCORE** (0-100) and specific recommendations for team strengthening.
""",
    },
      {
            "name": "Chief Marketing & Communications Officer",
            "role": "CMO+CCO",
            "description": "Анализирует рынок, GTM стратегию, позиционирование, коммуникации и маркетинговые метрики",
            "model_provider": ModelProvider.ANTHROPIC,
            "model_version": "claude-sonnet-4-6",
        "prompt": """You are a Chief Marketing Officer (CMO) with deep expertise in B2B and B2C growth strategies.

Your task is to evaluate the market opportunity and go-to-market strategy of this startup.

## ANALYSIS FRAMEWORK:

1. **Market Opportunity**
   - TAM/SAM/SOM assessment
   - Market growth rate and drivers
   - Market timing

2. **Target Customer**
   - ICP (Ideal Customer Profile) clarity
   - Customer pain point validation
   - Willingness to pay signals

3. **Positioning & Differentiation**
   - Value proposition clarity
   - Competitive differentiation
   - Brand and messaging quality

4. **Go-to-Market Strategy**
   - Primary acquisition channels
   - Sales motion (PLG, SLG, etc.)
   - Channel efficiency signals

5. **Traction & Validation**
   - Customer acquisition evidence
   - Retention and engagement metrics
   - Product-market fit signals (NPS, churn, referrals)

6. **Marketing Metrics** (if available)
   - CAC by channel
   - Conversion rates
   - Organic vs. paid ratio

## OUTPUT FORMAT:
Markdown analysis with **MARKET SCORE** (0-100) and top 3 growth opportunities + top 3 marketing risks.
""",
    },
      {
            "name": "Chief Product & Technology Officer",
            "role": "CPO+CTO",
            "description": "Анализирует продукт и технологии: PMF, roadmap, архитектуру, масштабируемость и техриски",
            "model_provider": ModelProvider.ANTHROPIC,
            "model_version": "claude-sonnet-4-6",
        "prompt": """You are a Chief Product Officer (CPO) with experience scaling products from 0 to millions of users.

Your task is to evaluate the product strategy, maturity, and competitive positioning of this startup.

## PRODUCT EVALUATION:

1. **Product-Market Fit**
   - PMF evidence and strength
   - User engagement signals
   - Retention indicators

2. **Product Quality & Maturity**
   - Current product stage (MVP/Beta/GA)
   - Feature completeness vs. market needs
   - Technical debt signals

3. **Product Strategy**
   - Roadmap clarity and ambition
   - Build vs. buy decisions
   - Platform vs. point solution

4. **User Experience**
   - Onboarding quality
   - Core loop clarity
   - Accessibility and design maturity

5. **Differentiation**
   - Unique features and capabilities
   - Barriers to replication
   - Network effects or data moats

6. **Monetization Alignment**
   - Product-pricing fit
   - Upsell/expansion paths
   - Freemium/trial conversion logic

## OUTPUT FORMAT:
Markdown with **PRODUCT SCORE** (0-100), key product risks, and specific product recommendations.
""",
    },
    {
        "name": "Founder Assessment Agent",
        "role": "FAA",
        "description": (
            "Оценивает фаундера через структурированное интервью. "
            "Запускается ТОЛЬКО на стадии pre-seed при отсутствии трекшна. "
            "Результат (ИБФ 0–100, вердикт, JSON-сигнал) передаётся агенту CHRO."
        ),
        "model_provider": ModelProvider.ANTHROPIC,
        "model_version": "claude-sonnet-4-6",
        "prompt": _load_faa_prompt(),
        # FAA — особый агент: не запускается автоматически вместе с остальными.
        # Оркестратор проверяет условие (pre-seed + no traction) перед добавлением задачи.
        "is_active": True,
        "faa_conditional": True,  # маркер для оркестратора
    },
    {
        "name": "Reference Check Agent",
        "role": "RCA",
        "description": (
            "Верификация стартапа через внешние референсы: клиентов, партнёров, инвесторов, экспертов. "
            "Работает в трёх режимах: discovery (поиск контактов), briefing (подготовка аналитика к звонку), "
            "analysis (извлечение сигналов из транскриптов). "
            "Запускается при Investment Score v1 ≥ 66 (auto) или вручную инвестором. "
            "Сигналы RCA корректируют оценки CHRO и CMO через rca_revision."
        ),
        "model_provider": ModelProvider.ANTHROPIC,
        "model_version": "claude-sonnet-4-6",
        "prompt": _load_rca_prompt(),
        "is_active": True,
        "rca_conditional": True,  # маркер для оркестратора: запуск по score-триггеру или вручную
    },
]


async def seed():
    await init_db()
    async with AsyncSessionLocal() as db:
        created = 0
        skipped = 0

        for config in AGENTS_CONFIG:
            # Проверяем существует ли уже агент с таким role
            result = await db.execute(
                select(Agent).where(Agent.role == config["role"])
            )
            existing = result.scalar_one_or_none()

            if existing:
                print(f"  ↩ Skipping {config['role']} — already exists (id={existing.id})")
                skipped += 1
                continue

            agent = Agent(
                name=config["name"],
                role=config["role"],
                description=config["description"],
                is_active=config.get("is_active", True),
                model_provider=config["model_provider"],
                model_version=config["model_version"],
            )
            db.add(agent)
            await db.flush()

            # FAA использует Markdown-формат (промпт загружен из .md файла)
            prompt_format = PromptFormat.MARKDOWN if config["role"] in ("FAA", "RCA") else PromptFormat.TEXT

            prompt = AgentPrompt(
                agent_id=agent.id,
                version=1,
                is_active=True,
                content=config["prompt"].strip(),
                format=prompt_format,
                comment=(
                    "FAA v3.0 — loaded from FAA_v3_0.md" if config["role"] == "FAA"
                    else "RCA v1.3 — loaded from RCA_v1_3.md" if config["role"] == "RCA"
                    else "Initial prompt (seed)"
                ),
                created_by="system",
            )
            db.add(prompt)
            created += 1
            conditional_note = (
                " [CONDITIONAL: pre-seed + no traction]" if config.get("faa_conditional")
                else " [CONDITIONAL: score ≥ 66 or manual]" if config.get("rca_conditional")
                else ""
            )
            print(f"  ✓ Created agent: {config['role']} — {config['name']}{conditional_note}")

        await db.commit()
        print(f"\nDone. Created: {created}, Skipped: {skipped}")


if __name__ == "__main__":
    asyncio.run(seed())
