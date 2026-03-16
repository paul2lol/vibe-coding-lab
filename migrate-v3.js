// V3 migration: feed images, URLs, and hearts
const { Client } = require('pg');

const SQL = `
-- Add image and link URL columns to feed
ALTER TABLE feed ADD COLUMN IF NOT EXISTS image_url text NOT NULL DEFAULT '';
ALTER TABLE feed ADD COLUMN IF NOT EXISTS link_url text NOT NULL DEFAULT '';

-- Hearts table (one heart per user per feed post)
CREATE TABLE IF NOT EXISTS feed_hearts (
  feed_id    uuid NOT NULL REFERENCES feed(feed_id) ON DELETE CASCADE,
  user_name  text NOT NULL REFERENCES users(name),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (feed_id, user_name)
);

CREATE INDEX IF NOT EXISTS idx_feed_hearts_feed ON feed_hearts (feed_id);
`;

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres.dnhzcxypawdwoascsgde:Anthillcreations1@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres'
  });
  try {
    await client.connect();
    console.log('Connected');
    await client.query(SQL);
    console.log('V3 migration complete');

    // Create storage bucket for feed images
    console.log('Schema updated: feed has image_url + link_url, feed_hearts table created');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
