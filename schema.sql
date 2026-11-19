-- Stagebound D1 schema v1. Applied to stagebound-db on 2026-11-19.
-- Each record is scoped to a verified Cloudflare Access email address.
CREATE TABLE IF NOT EXISTS checkins (
  owner TEXT NOT NULL, id TEXT NOT NULL, date TEXT NOT NULL,
  weight TEXT, bf TEXT, training TEXT, nutrition TEXT, cardio TEXT,
  posing TEXT, notes TEXT, PRIMARY KEY(owner,id)
);
CREATE INDEX IF NOT EXISTS idx_checkins_owner_date ON checkins(owner,date DESC);
CREATE TABLE IF NOT EXISTS competitions (
  owner TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL,
  date TEXT, location TEXT, division TEXT, status TEXT NOT NULL
  DEFAULT 'Unknown' CHECK(status IN ('Confirmed','Estimated','Unknown')),
  url TEXT, notes TEXT, PRIMARY KEY(owner,id)
);
CREATE TABLE IF NOT EXISTS tasks (
  owner TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL, due TEXT,
  done INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0,1)),
  PRIMARY KEY(owner,id)
);
CREATE TABLE IF NOT EXISTS preferences (
  owner TEXT PRIMARY KEY, goal TEXT NOT NULL DEFAULT 'Bodybuilding + Classic Physique',
  goal_weight TEXT NOT NULL DEFAULT ''
);

-- Physique records v2, deployed on 2026-11-19.
CREATE TABLE IF NOT EXISTS measurements (owner TEXT NOT NULL,id TEXT NOT NULL,date TEXT NOT NULL,waist REAL,chest REAL,shoulders REAL,arm_left REAL,arm_right REAL,thigh_left REAL,thigh_right REAL,hips REAL,neck REAL,notes TEXT,PRIMARY KEY(owner,id));
CREATE INDEX IF NOT EXISTS idx_measurements_owner_date ON measurements(owner,date DESC);
CREATE TABLE IF NOT EXISTS progress_photos (owner TEXT NOT NULL,id TEXT NOT NULL,date TEXT NOT NULL,pose TEXT NOT NULL,object_key TEXT NOT NULL,content_type TEXT NOT NULL,bytes INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(owner,id));
CREATE INDEX IF NOT EXISTS idx_photos_owner_date ON progress_photos(owner,date DESC);
