// V2 migration: multi-presenter support + vote-per-project
const { Client } = require('pg');

const SQL = `
-- 1. Allow a person to present multiple projects (drop unique on presenter+session)
DROP INDEX IF EXISTS idx_projects_presenter_session;

-- 2. Junction table: multiple persons can present the same project
CREATE TABLE IF NOT EXISTS project_presenters (
  project_id     uuid NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  presenter_name text NOT NULL REFERENCES users(name),
  PRIMARY KEY (project_id, presenter_name)
);

CREATE INDEX IF NOT EXISTS idx_pp_presenter ON project_presenters (presenter_name);

-- 3. Backfill: seed project_presenters from existing projects
INSERT INTO project_presenters (project_id, presenter_name)
SELECT project_id, presenter_name FROM projects
ON CONFLICT DO NOTHING;

-- 4. Add project_id to votes (votes target a project, not a person)
ALTER TABLE votes ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(project_id);

-- Backfill project_id on existing votes by matching presenter+session
UPDATE votes v
SET project_id = p.project_id
FROM projects p
WHERE v.presenter_name = p.presenter_name
  AND v.session_date = p.session_date
  AND v.project_id IS NULL;

-- 5. Replace old unique constraint with project-based one
--    "Same person cannot vote twice for the same project"
ALTER TABLE votes DROP CONSTRAINT IF EXISTS votes_session_date_presenter_name_voter_name_key;
ALTER TABLE votes ADD CONSTRAINT votes_session_project_voter_unique
  UNIQUE (session_date, project_id, voter_name);

-- 6. Recreate leaderboard view: credits ALL presenters of a project
CREATE OR REPLACE VIEW leaderboard AS
SELECT
  v.session_date,
  pp.presenter_name,
  p.project_title,
  round(avg(v.stars)::numeric, 2) AS avg_stars,
  count(*)::int AS votes_count
FROM votes v
JOIN projects p ON p.project_id = v.project_id AND p.active_demo_day = true
JOIN project_presenters pp ON pp.project_id = v.project_id
GROUP BY v.session_date, pp.presenter_name, p.project_title
ORDER BY avg(v.stars) DESC, count(*) DESC, pp.presenter_name ASC;
`;

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres.dnhzcxypawdwoascsgde:Anthillcreations1@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres'
  });
  try {
    await client.connect();
    console.log('Connected');
    await client.query(SQL);
    console.log('V2 migration complete');

    // Verify
    const res = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name");
    console.log('Tables:', res.rows.map(r => r.table_name).join(', '));

    const pp = await client.query('SELECT count(*) FROM project_presenters');
    console.log('Project presenters rows:', pp.rows[0].count);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
