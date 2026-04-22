import asyncio
import logging
from sqlalchemy import select, update
from app.core.database import async_session_maker
from app.models.agent import Agent, AgentPrompt

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

CANONICAL_ROLES = ["CMO+CCO", "CLO", "CFO", "CPO+CTO", "CHRO"]

async def cleanup_stale_agents(delete_prompts: bool = False):
    """
    Deactivates any agent from the database whose role is not in the canonical list.
    Optionally deletes their orphaned prompt versions.
    """
    async with async_session_maker() as session:
        # Find active agents not in canonical roles
        result = await session.execute(
            select(Agent).where(
                Agent.is_active == True,  # noqa: E712
                Agent.role.not_in(CANONICAL_ROLES),
            )
        )
        stale_agents = result.scalars().all()
        
        if not stale_agents:
            logger.info("No stale agents found. Canonical roles only.")
            return

        stale_ids = [agent.id for agent in set(stale_agents)]
        stale_roles = [agent.role for agent in set(stale_agents)]
            
        logger.info(f"Found {len(stale_ids)} stale agents: {', '.join(stale_roles)}")
        
        # Deactivate them
        await session.execute(
            update(Agent)
            .where(Agent.id.in_(stale_ids))
            .values(is_active=False) # Requires is_active field
        )
        logger.info(f"Deactivated agents: {stale_ids}")
        
        if delete_prompts:
            from sqlalchemy import delete
            await session.execute(
                delete(AgentPrompt)
                .where(AgentPrompt.agent_id.in_(stale_ids))
            )
            logger.info(f"Deleted orphaned prompts for agents: {stale_ids}")
            
        await session.commit()
        logger.info("Cleanup complete.")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Clean up stale agent roles from DB.")
    parser.add_argument("--delete-prompts", action="store_true", help="Also delete their orphan prompts")
    args = parser.parse_args()
    
    asyncio.run(cleanup_stale_agents(args.delete_prompts))
