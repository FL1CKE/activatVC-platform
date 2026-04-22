"""
AgentService — вся логика работы с агентами и промптами.

Почему отдельный сервис а не логика прямо в роутах?
Роуты меняются (версионирование API), бизнес-логика — реже.
Сервис можно вызвать из роута, из seed скрипта, из теста — одинаково.
"""
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from app.models.agent import Agent, AgentPrompt, AgentApiKey, PromptFormat
from app.schemas.agent import AgentCreate, AgentUpdate, AgentPromptCreate, AgentApiKeyRotate
import logging

logger = logging.getLogger(__name__)


class AgentService:

    def __init__(self, db: AsyncSession):
        self.db = db

    # ─── Agents ────────────────────────────────────────────────────────────────

    async def list_agents(self, active_only: bool = False) -> list[Agent]:
        q = select(Agent)
        if active_only:
            q = q.where(Agent.is_active == True)  # noqa: E712
        result = await self.db.execute(q.order_by(Agent.id))
        return result.scalars().all()

    async def get_agent(self, agent_id: int) -> Agent | None:
        result = await self.db.execute(select(Agent).where(Agent.id == agent_id))
        return result.scalar_one_or_none()

    async def get_agent_by_role(self, role: str) -> Agent | None:
        result = await self.db.execute(select(Agent).where(Agent.role == role))
        return result.scalar_one_or_none()

    async def create_agent(self, data: AgentCreate) -> Agent:
        # Проверяем уникальность role
        existing = await self.get_agent_by_role(data.role)
        if existing:
            raise ValueError(f"Agent with role '{data.role}' already exists (id={existing.id})")

        agent = Agent(
            name=data.name,
            role=data.role.upper(),
            description=data.description,
            is_active=data.is_active,
            model_provider=data.model_provider,
            model_version=data.model_version,
            api_key_encrypted=data.api_key,  # TODO: шифрование
        )
        self.db.add(agent)
        await self.db.flush()

        # Создаём первую версию API ключа в истории, если ключ передан
        if data.api_key:
            await self._rotate_api_key_internal(
                agent=agent,
                api_key=data.api_key,
                comment="Initial API key",
                created_by="api",
            )

        # Создаём начальный промпт если передан
        if data.initial_prompt:
            prompt = AgentPrompt(
                agent_id=agent.id,
                version=1,
                is_active=True,
                content=data.initial_prompt,
                format=PromptFormat.TEXT,
                comment="Initial prompt",
                created_by="api",
            )
            self.db.add(prompt)

        await self.db.commit()
        await self.db.refresh(agent)
        logger.info(f"Created agent: {agent.role} (id={agent.id})")
        return agent

    async def update_agent(self, agent_id: int, data: AgentUpdate) -> Agent:
        agent = await self.get_agent(agent_id)
        if not agent:
            raise ValueError(f"Agent {agent_id} not found")

        update_data = data.model_dump(exclude_none=True)

        api_key = update_data.pop("api_key", None)
        if api_key:
            await self._rotate_api_key_internal(
                agent=agent,
                api_key=api_key,
                comment="Updated via agent settings",
                created_by="api",
            )

        for field, value in update_data.items():
            setattr(agent, field, value)

        await self.db.commit()
        await self.db.refresh(agent)
        return agent

    def _mask_api_key(self, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) <= 8:
            return "*" * max(len(cleaned), 4)
        return f"{cleaned[:4]}...{cleaned[-4:]}"

    async def _rotate_api_key_internal(
        self,
        agent: Agent,
        api_key: str,
        comment: str | None,
        created_by: str,
    ) -> AgentApiKey:
        # Деактивируем предыдущую активную версию ключа
        await self.db.execute(
            update(AgentApiKey)
            .where(AgentApiKey.agent_id == agent.id, AgentApiKey.is_active == True)  # noqa: E712
            .values(is_active=False)
        )

        result = await self.db.execute(
            select(AgentApiKey)
            .where(AgentApiKey.agent_id == agent.id)
            .order_by(AgentApiKey.version.desc())
        )
        latest = result.scalars().first()
        next_version = (latest.version + 1) if latest else 1

        key_history = AgentApiKey(
            agent_id=agent.id,
            version=next_version,
            is_active=True,
            key_masked=self._mask_api_key(api_key),
            api_key_encrypted=api_key,  # TODO: шифрование
            comment=comment,
            created_by=created_by,
        )
        self.db.add(key_history)
        agent.api_key_encrypted = api_key
        await self.db.flush()
        return key_history

    async def rotate_api_key(
        self,
        agent_id: int,
        data: AgentApiKeyRotate,
        created_by: str = "api",
    ) -> AgentApiKey:
        agent = await self.get_agent(agent_id)
        if not agent:
            raise ValueError(f"Agent {agent_id} not found")

        key_history = await self._rotate_api_key_internal(
            agent=agent,
            api_key=data.api_key,
            comment=data.comment,
            created_by=created_by,
        )
        await self.db.commit()
        await self.db.refresh(key_history)
        return key_history

    async def list_api_keys(self, agent_id: int, limit: int = 5) -> list[AgentApiKey]:
        await self._ensure_agent_exists(agent_id)
        result = await self.db.execute(
            select(AgentApiKey)
            .where(AgentApiKey.agent_id == agent_id)
            .order_by(AgentApiKey.version.desc())
            .limit(limit)
        )
        return result.scalars().all()

    async def rollback_api_key(self, agent_id: int, version: int) -> AgentApiKey:
        agent = await self.get_agent(agent_id)
        if not agent:
            raise ValueError(f"Agent {agent_id} not found")

        result = await self.db.execute(
            select(AgentApiKey).where(
                AgentApiKey.agent_id == agent_id,
                AgentApiKey.version == version,
            )
        )
        target = result.scalar_one_or_none()
        if not target:
            raise ValueError(f"API key version {version} not found for agent {agent_id}")

        return await self.rotate_api_key(
            agent_id=agent_id,
            data=AgentApiKeyRotate(
                api_key=target.api_key_encrypted,
                comment=f"Rollback API key to v{version}",
            ),
            created_by="rollback",
        )

    async def _ensure_agent_exists(self, agent_id: int) -> None:
        if not await self.get_agent(agent_id):
            raise ValueError(f"Agent {agent_id} not found")

    # ─── Prompts & versioning ──────────────────────────────────────────────────

    async def list_prompts(self, agent_id: int) -> list[AgentPrompt]:
        result = await self.db.execute(
            select(AgentPrompt)
            .where(AgentPrompt.agent_id == agent_id)
            .order_by(AgentPrompt.version.desc())
        )
        return result.scalars().all()

    async def create_prompt_version(
        self,
        agent_id: int,
        data: AgentPromptCreate,
        created_by: str = "api",
    ) -> AgentPrompt:
        """
        Создаёт новую версию промпта и делает её активной.
        Старая версия деактивируется автоматически.

        Почему не UPDATE а INSERT новой записи?
        История промптов — это аудит-лог. Нужна возможность посмотреть
        что именно отправлялось агенту в каждом конкретном запуске.
        Это важно при отладке "почему агент дал такой ответ 2 недели назад".
        """
        agent = await self.get_agent(agent_id)
        if not agent:
            raise ValueError(f"Agent {agent_id} not found")

        # Деактивируем все текущие активные промпты этого агента
        await self.db.execute(
            update(AgentPrompt)
            .where(AgentPrompt.agent_id == agent_id, AgentPrompt.is_active == True)  # noqa: E712
            .values(is_active=False)
        )

        # Определяем следующий номер версии
        result = await self.db.execute(
            select(AgentPrompt)
            .where(AgentPrompt.agent_id == agent_id)
            .order_by(AgentPrompt.version.desc())
        )
        latest = result.scalars().first()
        next_version = (latest.version + 1) if latest else 1

        new_prompt = AgentPrompt(
            agent_id=agent_id,
            version=next_version,
            is_active=True,
            content=data.content,
            format=data.format,
            file_path=data.file_path,
            comment=data.comment,
            created_by=created_by,
        )
        self.db.add(new_prompt)
        await self.db.commit()
        await self.db.refresh(new_prompt)

        logger.info(f"Agent {agent_id}: created prompt v{next_version}")
        return new_prompt

    async def rollback_prompt(self, agent_id: int, version: int) -> AgentPrompt:
        """
        Откат промпта до указанной версии.
        Не удаляет текущую версию — создаёт новую копию старой.
        Это сохраняет полную историю.
        """
        result = await self.db.execute(
            select(AgentPrompt).where(
                AgentPrompt.agent_id == agent_id,
                AgentPrompt.version == version,
            )
        )
        target = result.scalar_one_or_none()
        if not target:
            raise ValueError(f"Prompt version {version} not found for agent {agent_id}")

        # Создаём новую версию с содержимым старой
        return await self.create_prompt_version(
            agent_id=agent_id,
            data=AgentPromptCreate(
                content=target.content,
                format=target.format,
                file_path=target.file_path,
                comment=f"Rollback to v{version}",
            ),
            created_by="rollback",
        )

    async def get_active_prompt(self, agent_id: int) -> AgentPrompt | None:
        result = await self.db.execute(
            select(AgentPrompt).where(
                AgentPrompt.agent_id == agent_id,
                AgentPrompt.is_active == True,  # noqa: E712
            )
        )
        return result.scalar_one_or_none()
