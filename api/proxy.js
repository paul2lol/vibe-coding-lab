const supabase = require('./_supabase');
const { rowsToCamel, rowToCamel } = require('./_mappers');

module.exports = async function handler(req, res) {
  try {
    const action = req.query.action || (req.body && req.body.action) || '';
    const body = req.body || {};

    if (req.method === 'GET') {
      if (action === 'bootstrap') {
        return res.json(await bootstrap(req.query.viewer || '', req.query.role || ''));
      }
      return res.status(400).json({ ok: false, error: 'Unknown GET action.' });
    }

    if (req.method === 'POST') {
      switch (action) {
        case 'saveProject':
          return res.json(await saveProject(body));
        case 'saveFeed':
          return res.json(await saveFeed(body));
        case 'saveComment':
          return res.json(await saveComment(body));
        case 'vote':
          return res.json(await vote(body));
        case 'updateQueue':
          return res.json(await updateQueue(body));
        case 'setCurrentPresenter':
          return res.json(await setCurrentPresenter(body));
        case 'setAnnouncement':
          return res.json(await setAnnouncement(body));
        case 'updateMeta':
          return res.json(await updateMeta(body));
        case 'uploadFeedImage':
          return res.json(await uploadFeedImage(body));
        case 'heartFeed':
          return res.json(await heartFeed(body));
        case 'addPresenter':
          return res.json(await addPresenter(body));
        case 'removePresenter':
          return res.json(await removePresenter(body));
        case 'deleteProject':
          return res.json(await deleteProject(body));
        case 'newSession':
          return res.json(await newSession(body));
        case 'migrateSession':
          return res.json(await migrateSession(body));
        case 'getLeaderboard':
          return res.json(await getLeaderboard(body));
        default:
          return res.status(400).json({ ok: false, error: 'Unknown POST action.' });
      }
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message || 'Server error.' });
  }
};

// --- Helpers ---

function required(value, msg) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(msg);
  }
  return String(value).trim();
}

function nowIST() {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  return ist;
}

function getDefaultSessionDate() {
  const now = nowIST();
  const day = now.getUTCDay();
  if (day === 1) return formatDate(now);
  const daysUntilMonday = day === 0 ? 1 : 8 - day;
  const target = new Date(now);
  target.setUTCDate(now.getUTCDate() + daysUntilMonday);
  return formatDate(target);
}

function formatDate(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function upsertMeta(entries) {
  const now = new Date().toISOString();
  const rows = Object.entries(entries).map(([key, value]) => ({
    key,
    value: String(value ?? ''),
    updated_at: now,
  }));
  const { error } = await supabase.from('meta').upsert(rows, { onConflict: 'key' });
  if (error) throw error;
}

// --- Action handlers ---

// Bootstrap is the ONLY action that reads from the meta table.
// All other actions receive sessionDate from the client (set during bootstrap).
// This eliminates the getSessionDate() query that was hitting meta on every request.
// Bootstrap also handles presence (heartbeat) inline — no separate heartbeat endpoint.
async function bootstrap(viewer, role) {
  // 1. Single meta query — the ONLY meta read in the entire app
  const metaRes = await supabase.from('meta').select('*');
  const meta = {};
  (metaRes.data || []).forEach((row) => { meta[row.key] = row.value; });

  const sessionDate = meta.sessionDate || getDefaultSessionDate();

  // 2. Upsert presence inline (replaces separate heartbeat endpoint)
  // This is a fire-and-forget write — don't await it before returning data
  const presencePromise = viewer
    ? supabase.from('presence').upsert({
        name: viewer,
        role: role || '',
        session_date: sessionDate,
        last_seen_at: new Date().toISOString(),
      }, { onConflict: 'name,session_date' }).then(() => {})
    : Promise.resolve();

  // 3. All data queries in a single parallel batch (7 queries)
  const [usersRes, projectsRes, ppRes, votesRes, feedRes, presenceRes, leaderboardRes] = await Promise.all([
    supabase.from('users').select('*'),
    supabase.from('projects').select('*').eq('session_date', sessionDate),
    supabase.from('project_presenters').select('*'),
    supabase.from('votes').select('*').eq('session_date', sessionDate),
    supabase.from('feed').select('*').eq('session_date', sessionDate).order('created_at', { ascending: false }).limit(50),
    supabase.from('presence').select('*').eq('session_date', sessionDate).gte('last_seen_at', new Date(Date.now() - 2 * 60 * 1000).toISOString()),
    supabase.from('leaderboard').select('*').eq('session_date', sessionDate),
  ]);

  // 4. Conditional: comments + hearts only if feed exists (saves 2 queries when feed is empty)
  let commentsRes = { data: [] };
  let heartsRes = { data: [] };
  if (feedRes.data && feedRes.data.length > 0) {
    [commentsRes, heartsRes] = await Promise.all([
      supabase.from('comments').select('*').eq('session_date', sessionDate).order('created_at', { ascending: true }),
      supabase.from('feed_hearts').select('*'),
    ]);
  }

  // Wait for presence write to complete (non-blocking above)
  await presencePromise;

  // Build presenter map
  const presentersByProject = {};
  (ppRes.data || []).forEach((row) => {
    if (!presentersByProject[row.project_id]) presentersByProject[row.project_id] = [];
    presentersByProject[row.project_id].push(row.presenter_name);
  });

  const projects = rowsToCamel(projectsRes.data).map((p) => ({
    ...p,
    presenters: presentersByProject[p.projectId] || [p.presenterName],
  }));
  const activeProjects = projects.filter((p) => p.activeDemoDay === true);

  // Build heart map
  const heartsByFeed = {};
  (heartsRes.data || []).forEach((row) => {
    if (!heartsByFeed[row.feed_id]) heartsByFeed[row.feed_id] = [];
    heartsByFeed[row.feed_id].push(row.user_name);
  });

  const feed = rowsToCamel(feedRes.data).map((post) => ({
    ...post,
    heartCount: (heartsByFeed[post.feedId] || []).length,
    heartedBy: heartsByFeed[post.feedId] || [],
  }));

  return {
    ok: true,
    viewer: viewer || '',
    sessionDate,
    team: rowsToCamel(usersRes.data),
    projects,
    activeProjects,
    votes: rowsToCamel(votesRes.data),
    feed,
    comments: rowsToCamel(commentsRes.data),
    meta,
    leaderboard: rowsToCamel(leaderboardRes.data),
    onlineUsers: rowsToCamel(presenceRes.data),
  };
}

async function saveProject(body) {
  const presenterName = required(body.presenterName, 'presenterName is required.');
  const sessionDate = required(body.sessionDate, 'sessionDate is required.');
  const now = new Date().toISOString();

  let existing = null;
  if (body.projectId) {
    const { data } = await supabase
      .from('projects')
      .select('project_id, queue_order, created_at')
      .eq('project_id', body.projectId)
      .maybeSingle();
    existing = data;
  }

  const row = {
    session_date: sessionDate,
    presenter_name: presenterName,
    project_title: required(body.projectTitle, 'projectTitle is required.'),
    category: body.category || 'General',
    description: required(body.description, 'description is required.'),
    active_demo_day: String(body.activeDemoDay) === 'true',
    status: 'ready',
    updated_at: now,
  };

  let projectId;

  if (existing) {
    projectId = existing.project_id;
    const { error } = await supabase
      .from('projects')
      .update(row)
      .eq('project_id', projectId);
    if (error) throw error;
  } else {
    const { data: maxRow } = await supabase
      .from('projects')
      .select('queue_order')
      .eq('session_date', sessionDate)
      .order('queue_order', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    row.queue_order = (maxRow?.queue_order || 0) + 1;
    row.created_at = now;

    const { data: inserted, error } = await supabase.from('projects').insert(row).select('project_id').single();
    if (error) throw error;
    projectId = inserted.project_id;
  }

  await supabase.from('project_presenters').upsert({
    project_id: projectId,
    presenter_name: presenterName,
  }, { onConflict: 'project_id,presenter_name' });

  return { ok: true };
}

async function saveFeed(body) {
  const { error } = await supabase.from('feed').insert({
    session_date: required(body.sessionDate, 'sessionDate is required.'),
    author_name: required(body.authorName, 'authorName is required.'),
    author_project: body.authorProject || '',
    message: required(body.message, 'message is required.'),
    image_url: body.imageUrl || '',
    link_url: body.linkUrl || '',
  });
  if (error) throw error;
  return { ok: true };
}

async function uploadFeedImage(body) {
  const imageData = required(body.imageData, 'imageData is required.');
  const fileName = `feed/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;

  const buffer = Buffer.from(imageData.replace(/^data:image\/\w+;base64,/, ''), 'base64');

  const { error } = await supabase.storage
    .from('feed-images')
    .upload(fileName, buffer, { contentType: 'image/png', upsert: false });
  if (error) throw error;

  const { data: urlData } = supabase.storage.from('feed-images').getPublicUrl(fileName);
  return { ok: true, imageUrl: urlData.publicUrl };
}

async function heartFeed(body) {
  const feedId = required(body.feedId, 'feedId is required.');
  const userName = required(body.userName, 'userName is required.');

  const { data: existing } = await supabase
    .from('feed_hearts')
    .select('feed_id')
    .eq('feed_id', feedId)
    .eq('user_name', userName)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('feed_hearts')
      .delete()
      .eq('feed_id', feedId)
      .eq('user_name', userName);
    if (error) throw error;
    return { ok: true, hearted: false };
  } else {
    const { error } = await supabase
      .from('feed_hearts')
      .insert({ feed_id: feedId, user_name: userName });
    if (error) throw error;
    return { ok: true, hearted: true };
  }
}

async function saveComment(body) {
  const { error } = await supabase.from('comments').insert({
    feed_id: required(body.feedId, 'feedId is required.'),
    session_date: required(body.sessionDate, 'sessionDate is required.'),
    author_name: required(body.authorName, 'authorName is required.'),
    message: required(body.message, 'message is required.'),
  });
  if (error) throw error;
  return { ok: true };
}

async function vote(body) {
  const sessionDate = required(body.sessionDate, 'sessionDate is required.');
  const presenterName = required(body.presenterName, 'presenterName is required.');
  const voterName = required(body.voterName, 'voterName is required.');
  const projectId = required(body.projectId, 'projectId is required.');
  const stars = Math.max(1, Math.min(5, Number(body.stars || 1)));
  const now = new Date().toISOString();

  // Server-side voting gate — single meta read (only when someone votes, not every poll)
  const { data: votingMeta } = await supabase
    .from('meta')
    .select('value')
    .eq('key', 'votingOpen')
    .single();

  if (!votingMeta || votingMeta.value !== 'true') {
    throw new Error('Voting is closed. Stars cannot be changed after voting stops.');
  }

  // Check: same person cannot vote twice for the same project on the same day
  const { data: existing } = await supabase
    .from('votes')
    .select('vote_id')
    .eq('session_date', sessionDate)
    .eq('project_id', projectId)
    .eq('voter_name', voterName)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('votes')
      .update({ stars, updated_at: now })
      .eq('vote_id', existing.vote_id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('votes').insert({
      session_date: sessionDate,
      presenter_name: presenterName,
      voter_name: voterName,
      project_id: projectId,
      stars,
    });
    if (error) throw error;
  }

  return { ok: true };
}

async function updateQueue(body) {
  const projectIds = body.projectIds || [];
  if (!projectIds.length) return { ok: true };

  const now = new Date().toISOString();
  const updates = projectIds.map((id, i) =>
    supabase
      .from('projects')
      .update({ queue_order: i + 1, updated_at: now })
      .eq('project_id', id)
  );
  await Promise.all(updates);
  return { ok: true };
}

async function setCurrentPresenter(body) {
  const sessionDate = required(body.sessionDate, 'sessionDate is required.');
  await upsertMeta({
    sessionDate,
    currentProjectId: required(body.projectId, 'projectId is required.'),
    currentPresenterName: required(body.presenterName, 'presenterName is required.'),
    currentProjectTitle: required(body.projectTitle, 'projectTitle is required.'),
    lastAnnouncement: body.presenterName + ' is presenting ' + body.projectTitle + '.',
    votingOpen: false,
    votingEndsAt: '',
  });
  return { ok: true };
}

async function setAnnouncement(body) {
  await upsertMeta({ lastAnnouncement: body.lastAnnouncement || '' });
  if (body.sessionDate) await upsertMeta({ sessionDate: body.sessionDate });
  return { ok: true };
}

async function updateMeta(body) {
  const updates = body.updates || {};
  if (body.sessionDate) updates.sessionDate = body.sessionDate;
  await upsertMeta(updates);
  return { ok: true };
}

async function addPresenter(body) {
  const projectId = required(body.projectId, 'projectId is required.');
  const presenterName = required(body.presenterName, 'presenterName is required.');

  const { error } = await supabase.from('project_presenters').upsert({
    project_id: projectId,
    presenter_name: presenterName,
  }, { onConflict: 'project_id,presenter_name' });
  if (error) throw error;
  return { ok: true };
}

async function removePresenter(body) {
  const projectId = required(body.projectId, 'projectId is required.');
  const presenterName = required(body.presenterName, 'presenterName is required.');

  const { data: project } = await supabase
    .from('projects')
    .select('presenter_name')
    .eq('project_id', projectId)
    .single();

  if (project && project.presenter_name === presenterName) {
    throw new Error('Cannot remove the original project creator.');
  }

  const { error } = await supabase
    .from('project_presenters')
    .delete()
    .eq('project_id', projectId)
    .eq('presenter_name', presenterName);
  if (error) throw error;
  return { ok: true };
}

async function deleteProject(body) {
  const projectId = required(body.projectId, 'projectId is required.');
  const userName = required(body.userName, 'userName is required.');

  const { data: project } = await supabase
    .from('projects')
    .select('presenter_name')
    .eq('project_id', projectId)
    .single();

  if (!project) throw new Error('Project not found.');
  if (project.presenter_name !== userName && !body.isAdmin) {
    throw new Error('Only the project creator or an admin can delete a project.');
  }

  await supabase.from('project_presenters').delete().eq('project_id', projectId);
  await supabase.from('votes').delete().eq('project_id', projectId);
  const { error } = await supabase.from('projects').delete().eq('project_id', projectId);
  if (error) throw error;
  return { ok: true };
}

async function getLeaderboard(body) {
  const mode = body.mode || 'session';

  if (mode === 'alltime') {
    const { data, error } = await supabase.from('leaderboard').select('*');
    if (error) throw error;
    const byPresenter = {};
    (data || []).forEach((row) => {
      const key = row.presenter_name;
      if (!byPresenter[key]) byPresenter[key] = { presenterName: key, totalStars: 0, totalVotes: 0, sessions: 0, projects: new Set() };
      byPresenter[key].totalStars += Number(row.avg_stars) * Number(row.votes_count);
      byPresenter[key].totalVotes += Number(row.votes_count);
      byPresenter[key].sessions += 1;
      byPresenter[key].projects.add(row.project_title);
    });
    const rows = Object.values(byPresenter).map((p) => ({
      presenterName: p.presenterName,
      avgStars: p.totalVotes > 0 ? (p.totalStars / p.totalVotes).toFixed(2) : '0.00',
      votesCount: p.totalVotes,
      sessionsCount: p.sessions,
      projectTitle: [...p.projects].join(', '),
    }));
    rows.sort((a, b) => Number(b.avgStars) - Number(a.avgStars) || b.votesCount - a.votesCount);
    return { ok: true, mode, rows };
  }

  if (mode === 'history') {
    const { data, error } = await supabase.from('leaderboard').select('session_date');
    if (error) throw error;
    const dates = [...new Set((data || []).map((r) => r.session_date))].sort().reverse();
    return { ok: true, mode, dates };
  }

  // Default: specific session — sessionDate comes from client, no meta query needed
  const sessionDate = required(body.sessionDate, 'sessionDate is required.');
  const { data, error } = await supabase.from('leaderboard').select('*').eq('session_date', sessionDate);
  if (error) throw error;
  return { ok: true, mode, sessionDate, rows: rowsToCamel(data) };
}

async function newSession(body) {
  const newDate = body.sessionDate || formatDate(nowIST());
  await upsertMeta({ sessionDate: newDate, votingOpen: 'false', currentPresenterName: '', currentProjectId: '', announcement: '' });
  return { ok: true, sessionDate: newDate };
}

async function migrateSession(body) {
  const fromDate = required(body.fromDate, 'fromDate is required.');
  const toDate = required(body.toDate, 'toDate is required.');

  await supabase.from('projects').update({ session_date: toDate }).eq('session_date', fromDate);
  await supabase.from('votes').update({ session_date: toDate }).eq('session_date', fromDate);
  await supabase.from('feed').update({ session_date: toDate }).eq('session_date', fromDate);
  await supabase.from('comments').update({ session_date: toDate }).eq('session_date', fromDate);
  await supabase.from('presence').update({ session_date: toDate }).eq('session_date', fromDate);
  await upsertMeta({ sessionDate: toDate });

  return { ok: true, fromDate, toDate };
}
