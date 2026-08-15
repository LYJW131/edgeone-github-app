PRAGMA foreign_keys = ON;

CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  hook_id TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL,
  installation_id INTEGER NOT NULL,
  repository_id INTEGER NOT NULL,
  repository_owner TEXT NOT NULL,
  repository_name TEXT NOT NULL,
  edgeone_project_id TEXT NOT NULL,
  branch TEXT NOT NULL,
  environment TEXT NOT NULL,
  checks_enabled INTEGER NOT NULL DEFAULT 1 CHECK (checks_enabled IN (0, 1)),
  deployments_enabled INTEGER NOT NULL DEFAULT 1 CHECK (deployments_enabled IN (0, 1)),
  created_by_user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (installation_id, repository_id, edgeone_project_id)
);

CREATE INDEX connections_installation_idx ON connections (installation_id);
CREATE INDEX connections_repository_idx ON connections (repository_id);

CREATE TABLE setup_sessions (
  token_hash TEXT PRIMARY KEY,
  github_user_id INTEGER NOT NULL,
  github_login TEXT NOT NULL,
  installation_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX setup_sessions_expiry_idx ON setup_sessions (expires_at);

CREATE TABLE deployment_states (
  connection_id TEXT NOT NULL,
  edgeone_deployment_id TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  check_run_id INTEGER,
  github_deployment_id INTEGER,
  last_event_type TEXT NOT NULL,
  processing_event_type TEXT,
  processing_started_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (connection_id, edgeone_deployment_id),
  FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
);
