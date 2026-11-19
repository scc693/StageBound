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

-- Prep tracking v3, deployed 2026-11-19
CREATE TABLE IF NOT EXISTS training_sessions (owner TEXT NOT NULL,id TEXT NOT NULL,date TEXT NOT NULL,focus TEXT NOT NULL DEFAULT '',duration INTEGER,recovery INTEGER,effort INTEGER,notes TEXT NOT NULL DEFAULT '',PRIMARY KEY(owner,id));
CREATE INDEX IF NOT EXISTS idx_training_sessions_date ON training_sessions(owner,date DESC);
CREATE TABLE IF NOT EXISTS exercise_sets (owner TEXT NOT NULL,id TEXT NOT NULL,session_id TEXT NOT NULL,exercise TEXT NOT NULL,sets INTEGER NOT NULL,reps INTEGER NOT NULL,load REAL NOT NULL,rpe REAL,notes TEXT NOT NULL DEFAULT '',PRIMARY KEY(owner,id));
CREATE INDEX IF NOT EXISTS idx_exercise_sets_session ON exercise_sets(owner,session_id);
CREATE INDEX IF NOT EXISTS idx_exercise_sets_name ON exercise_sets(owner,exercise);
CREATE TABLE IF NOT EXISTS nutrition_days (owner TEXT NOT NULL,date TEXT NOT NULL,calories INTEGER,protein REAL,carbs REAL,fat REAL,adherence INTEGER,notes TEXT NOT NULL DEFAULT '',PRIMARY KEY(owner,date));
CREATE TABLE IF NOT EXISTS prep_plan (owner TEXT NOT NULL,id TEXT NOT NULL,title TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT NOT NULL,phase TEXT NOT NULL DEFAULT 'Improvement',notes TEXT NOT NULL DEFAULT '',PRIMARY KEY(owner,id));
CREATE INDEX IF NOT EXISTS idx_prep_plan_dates ON prep_plan(owner,start_date);
CREATE TABLE IF NOT EXISTS nutrition_targets (owner TEXT PRIMARY KEY,calories INTEGER,protein REAL,carbs REAL,fat REAL,weekly_training_target INTEGER);
