from pathlib import Path

from psycopg_pool import ConnectionPool

from server.app.config import load_settings


MIGRATION_PATH = Path(__file__).resolve().parents[1] / "migrations" / "001_initial.sql"


def main() -> None:
    settings = load_settings()
    with ConnectionPool(conninfo=settings.database_url, min_size=1, max_size=1) as pool:
        with pool.connection() as connection:
            connection.execute(MIGRATION_PATH.read_bytes(), prepare=False)
            connection.execute("SELECT 1")
    print("Database migration completed.")


if __name__ == "__main__":
    main()
