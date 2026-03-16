"""Regression tests for automatic DB schema upgrades."""
from sqlalchemy import create_engine, inspect, text


def test_auto_migrate_adds_missing_tz_document_columns(tmp_path):
    from database import _auto_migrate

    db_path = tmp_path / "legacy_tz.db"
    db_url = f"sqlite:///{db_path}"
    engine = create_engine(db_url, connect_args={"check_same_thread": False})

    with engine.begin() as conn:
        conn.execute(text("""
          CREATE TABLE tz_documents (
            id VARCHAR PRIMARY KEY,
            user_email VARCHAR,
            title VARCHAR,
            goods_type VARCHAR,
            model VARCHAR,
            specs_json TEXT
          )
        """))

    _auto_migrate(engine, db_url)

    columns = {col["name"] for col in inspect(engine).get_columns("tz_documents")}
    assert "law_mode" in columns
    assert "rows_json" in columns
    assert "compliance_score" in columns
    assert "updated_at" in columns
    assert "created_at" in columns
