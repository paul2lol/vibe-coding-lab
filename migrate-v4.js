// V4 migration: Single RPC function for bootstrap (eliminates 8 queries → 1)
const { Client } = require('pg');

const SQL = `
-- Bootstrap RPC: returns ALL data needed by the frontend in a single database call.
-- This replaces 8 separate PostgREST queries with 1, reducing connection pool usage by 8x.
CREATE OR REPLACE FUNCTION bootstrap_data(
  p_session_date text,
  p_viewer text DEFAULT '',
  p_role text DEFAULT ''
)
RETURNS json
LANGUAGE plpgsql
AS $$
BEGIN
  -- Upsert presence inline (replaces heartbeat endpoint)
  IF p_viewer IS NOT NULL AND p_viewer != '' THEN
    INSERT INTO presence (name, role, session_date, last_seen_at)
    VALUES (p_viewer, COALESCE(p_role, ''), p_session_date, now())
    ON CONFLICT (name, session_date)
    DO UPDATE SET last_seen_at = now(), role = EXCLUDED.role;
  END IF;

  RETURN json_build_object(
    'meta', (
      SELECT COALESCE(json_object_agg(m.key, m.value), '{}'::json)
      FROM meta m
    ),
    'users', (
      SELECT COALESCE(json_agg(row_to_json(u)), '[]'::json)
      FROM users u
    ),
    'projects', (
      SELECT COALESCE(json_agg(row_to_json(p)), '[]'::json)
      FROM projects p
      WHERE p.session_date = p_session_date
    ),
    'project_presenters', (
      SELECT COALESCE(json_agg(row_to_json(pp)), '[]'::json)
      FROM project_presenters pp
    ),
    'votes', (
      SELECT COALESCE(json_agg(row_to_json(v)), '[]'::json)
      FROM votes v
      WHERE v.session_date = p_session_date
    ),
    'feed', (
      SELECT COALESCE(json_agg(row_to_json(f)), '[]'::json)
      FROM (
        SELECT * FROM feed
        WHERE session_date = p_session_date
        ORDER BY created_at DESC
        LIMIT 50
      ) f
    ),
    'comments', (
      SELECT COALESCE(json_agg(row_to_json(c)), '[]'::json)
      FROM comments c
      WHERE c.session_date = p_session_date
    ),
    'presence', (
      SELECT COALESCE(json_agg(row_to_json(pr)), '[]'::json)
      FROM presence pr
      WHERE pr.session_date = p_session_date
        AND pr.last_seen_at >= now() - interval '2 minutes'
    ),
    'leaderboard', (
      SELECT COALESCE(json_agg(row_to_json(l)), '[]'::json)
      FROM leaderboard l
      WHERE l.session_date = p_session_date
    ),
    'feed_hearts', (
      SELECT COALESCE(json_agg(row_to_json(fh)), '[]'::json)
      FROM feed_hearts fh
    )
  );
END;
$$;
`;

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres.dnhzcxypawdwoascsgde:Anthillcreations1@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres'
  });
  try {
    await client.connect();
    console.log('Connected');
    await client.query(SQL);
    console.log('V4 migration complete — bootstrap_data() RPC function created');
    console.log('This reduces bootstrap from 8 DB connections to 1');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
