// One-time migration script — run with: node migrate.js
const { Client } = require('pg');

const SQL = `
-- 1. Users
CREATE TABLE IF NOT EXISTS users (
  name       text PRIMARY KEY,
  role       text NOT NULL DEFAULT '',
  enabled    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO users (name, role) VALUES
  ('Aditya','Tech'),('Amit','Tech'),('Vara','Tech'),('Kartik','Tech'),
  ('Vivek','Tech'),('Suraj','Tech'),('Ankit','Tech'),('Divya','QA'),
  ('Sandeep','Design'),('Paul','PM'),('Suneet','PM'),('Sudheer','PM'),
  ('Shivam','PM'),('Diksha','PjM'),('Shreedevi','Curriculum')
ON CONFLICT (name) DO NOTHING;

-- 2. Projects
CREATE TABLE IF NOT EXISTS projects (
  project_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_date   date NOT NULL,
  presenter_name text NOT NULL REFERENCES users(name),
  project_title  text NOT NULL,
  category       text NOT NULL DEFAULT 'General',
  description    text NOT NULL DEFAULT '',
  active_demo_day boolean NOT NULL DEFAULT false,
  queue_order    integer,
  status         text NOT NULL DEFAULT 'ready',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_presenter_session
  ON projects (presenter_name, session_date);
CREATE INDEX IF NOT EXISTS idx_projects_session_date ON projects (session_date);
CREATE INDEX IF NOT EXISTS idx_projects_queue ON projects (session_date, queue_order);

-- 3. Votes
CREATE TABLE IF NOT EXISTS votes (
  vote_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_date   date NOT NULL,
  presenter_name text NOT NULL REFERENCES users(name),
  voter_name     text NOT NULL REFERENCES users(name),
  stars          smallint NOT NULL CHECK (stars >= 1 AND stars <= 5),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_date, presenter_name, voter_name)
);

CREATE INDEX IF NOT EXISTS idx_votes_session ON votes (session_date);

-- 4. Feed
CREATE TABLE IF NOT EXISTS feed (
  feed_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_date   date NOT NULL,
  author_name    text NOT NULL REFERENCES users(name),
  author_project text NOT NULL DEFAULT '',
  message        text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feed_session ON feed (session_date);
CREATE INDEX IF NOT EXISTS idx_feed_created ON feed (session_date, created_at DESC);

-- 5. Comments
CREATE TABLE IF NOT EXISTS comments (
  comment_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_id      uuid NOT NULL REFERENCES feed(feed_id) ON DELETE CASCADE,
  session_date date NOT NULL,
  author_name  text NOT NULL REFERENCES users(name),
  message      text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comments_feed ON comments (feed_id);
CREATE INDEX IF NOT EXISTS idx_comments_session ON comments (session_date);

-- 6. Meta (key-value store)
CREATE TABLE IF NOT EXISTS meta (
  key        text PRIMARY KEY,
  value      text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO meta (key, value) VALUES
  ('sessionDate', ''),
  ('currentProjectId', ''),
  ('currentPresenterName', ''),
  ('currentProjectTitle', ''),
  ('lastAnnouncement', ''),
  ('votingOpen', 'false'),
  ('votingEndsAt', ''),
  ('demoEndsAt', '')
ON CONFLICT (key) DO NOTHING;

-- 7. Presence
CREATE TABLE IF NOT EXISTS presence (
  name         text NOT NULL REFERENCES users(name),
  role         text NOT NULL DEFAULT '',
  session_date date NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (name, session_date)
);

CREATE INDEX IF NOT EXISTS idx_presence_session ON presence (session_date);
CREATE INDEX IF NOT EXISTS idx_presence_online ON presence (session_date, last_seen_at);

-- 8. Leaderboard view
CREATE OR REPLACE VIEW leaderboard AS
SELECT
  v.session_date,
  v.presenter_name,
  p.project_title,
  round(avg(v.stars)::numeric, 2) AS avg_stars,
  count(*)::int AS votes_count
FROM votes v
JOIN projects p
  ON p.presenter_name = v.presenter_name
  AND p.session_date = v.session_date
  AND p.active_demo_day = true
GROUP BY v.session_date, v.presenter_name, p.project_title
ORDER BY avg(v.stars) DESC, count(*) DESC, v.presenter_name ASC;
`;

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres.dnhzcxypawdwoascsgde:Anthillcreations1@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres'
  });
  try {
    await client.connect();
    console.log('Connected to Supabase Postgres');
    await client.query(SQL);
    console.log('Schema created successfully');

    // Verify
    const res = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name");
    console.log('Tables:', res.rows.map(r => r.table_name).join(', '));

    const users = await client.query('SELECT count(*) FROM users');
    console.log('Users seeded:', users.rows[0].count);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
