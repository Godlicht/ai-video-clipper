from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  source_filename TEXT NOT NULL,
  source_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  duration_seconds REAL,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_user_created
  ON projects(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  reason TEXT NOT NULL,
  start_seconds REAL NOT NULL,
  end_seconds REAL NOT NULL,
  score INTEGER NOT NULL,
  transcript TEXT NOT NULL DEFAULT '',
  selected INTEGER NOT NULL DEFAULT 0,
  render_config TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  clip_id TEXT REFERENCES clips(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  output_path TEXT,
  error_message TEXT,
  render_config TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS pending_file_deletions (
  project_id TEXT PRIMARY KEY,
  source_path TEXT NOT NULL,
  quarantine_path TEXT NOT NULL,
  created_at TEXT NOT NULL
);
"""


class Database:
    def __init__(self, path: Path | str):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._memory_connection: sqlite3.Connection | None = None
        if self.path == ":memory:":
            self._memory_connection = self._connect()
        self.initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        connection = self._memory_connection or self._connect()
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            if self._memory_connection is None:
                connection.close()

    def initialize(self) -> None:
        with self.connection() as connection:
            if self.path != ":memory:":
                connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(SCHEMA)
            columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(pending_file_deletions)").fetchall()
            }
            if "project_id" not in columns:
                legacy_paths = [
                    row["path"]
                    for row in connection.execute(
                        "SELECT path FROM pending_file_deletions"
                    ).fetchall()
                ]
                connection.execute("DROP TABLE pending_file_deletions")
                connection.execute(
                    """
                    CREATE TABLE pending_file_deletions (
                      project_id TEXT PRIMARY KEY,
                      source_path TEXT NOT NULL,
                      quarantine_path TEXT NOT NULL,
                      created_at TEXT NOT NULL
                    )
                    """
                )
                for legacy_path in legacy_paths:
                    try:
                        Path(legacy_path).unlink(missing_ok=True)
                    except OSError:
                        # The legacy schema represented files whose DB rows were
                        # already deleted. A failed cleanup can be retried manually.
                        pass

    def close(self) -> None:
        if self._memory_connection:
            self._memory_connection.close()
            self._memory_connection = None
