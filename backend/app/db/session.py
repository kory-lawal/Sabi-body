"""Database engine and request-scoped sessions.

Neon closes idle connections and may scale to zero, so the pool pre-pings and
recycles connections. Use Neon's *pooled* connection string (host contains
"-pooler") in production; SSL is required by the URL (sslmode=require).
"""
import logging
from collections.abc import Iterator

from fastapi import HTTPException, status
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError, SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings

logger = logging.getLogger("sabibody.db")

_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def configure(database_url: str | None = None) -> None:
    """(Re)create the engine. Tests call this with a local Postgres URL."""
    global _engine, _SessionLocal
    url = database_url if database_url is not None else settings.DATABASE_URL
    if _engine is not None:
        _engine.dispose()
    if not url:
        _engine = None
        _SessionLocal = None
        return
    _engine = create_engine(
        url,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=5,
        pool_recycle=300,
        pool_timeout=10,
        connect_args={"connect_timeout": 10} if url.startswith("postgresql") else {},
    )
    _SessionLocal = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False)


def get_engine() -> Engine | None:
    return _engine


def database_unavailable(detail: str = "Accounts are temporarily unavailable. Please try again shortly.") -> HTTPException:
    return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail={"code": "database_unavailable", "message": detail})


def new_session() -> Session:
    if _SessionLocal is None:
        raise database_unavailable("Accounts are not configured on this server yet.")
    return _SessionLocal()


def get_db() -> Iterator[Session]:
    db = new_session()
    try:
        yield db
    except OperationalError as exc:
        db.rollback()
        logger.error("Database connection error: %s", exc.__class__.__name__)
        raise database_unavailable() from exc
    except SQLAlchemyError:
        db.rollback()
        raise
    finally:
        db.close()


configure()
