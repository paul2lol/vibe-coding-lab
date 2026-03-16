const supabase = require('./_supabase');
const { rowsToCamel, rowToCamel } = require('./_mappers');

module.exports = async function handler(req, res) {
  try {
    const action = req.query.action || (req.body && req.body.action) || '';
    const body = req.body || {};

    if (req.method === 'GET') {
      if (action === 'bootstrap') {
        return res.json(await bootstrap(req.query.viewer || ''));
      }
      return res.status(400).json({ ok: false, error: 'Unknown GET action.' });
    }

    if (req.method === 'POST') {
      switch (action) {
        case 'heartbeat':
          return res.json(await heartbeat(body));
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

function getDefaultSessionDate() {
  const now = new Date();
  const day = now.getDay();
  if (day === 1) return formatDate(now);
  const daysUntilMonday = day === 0 ? 1 : 8 - day;
  const target = new Date(now);
  target.setDate(now.getDate() + daysUntilMonday);
  return formatDate(target);
}

function formatDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function getSessionDate() {
  const { data } = await supabase
    .from('meta')
    .select('value')
    .eq('key', 'sessionDate')
    .single();

  const stored = data?.value;
  if (stored && stored.trim() !== '') return stored;

  const defaultDate = getDefaultSessionDate();
  await upsertMeta({ sessionDate: defaultDate });
  return defaultDate;
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

async function bootstrap(viewer) {
  const sessionDate = await getSessionDate();

  const [usersRes, projectsRes, votesRes, feedRes, commentsRes, metaRes, presenceRes, leaderboardRes, ppRes] = await Promise.all([
    supabase.from('users').select('*'),
    supabase.from('projects').select('*').eq('session_date', sessionDate),
    supabase.from('votes').select('*').eq('session_date', sessionDate),
    supabase.from('feed').select('*').eq('session_date', sessionDate).order('created_at', { ascending: false }),
    supabase.from('comments').select('*').eq('session_date', sessionDate).order('created_at', { ascending: true }),
    supabase.from('meta').select('*'),
    supabase.from('presence').select('*').eq('session_date', sessionDate).gte('last_seen_at', new Date(Date.now() - 2 * 60 * 1000).toISOString()),
    supabase.from('leaderboard').select('*').eq('session_date', sessionDate),
    supabase.from('project_presenters').select('*'),
  ]);

  const meta = {};
  (metaRes.data || []).forEach((row) => { meta[row.key] = row.value; });

  // Build a map of project_id -> all presenter names
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

  return {
    ok: true,
    viewer: viewer || '',
    sessionDate,
    team: rowsToCamel(usersRes.data),
    projects,
    activeProjects,
    votes: rowsToCamel(votesRes.data),
    feed: rowsToCamel(feedRes.data),
    comments: rowsToCamel(commentsRes.data),
    meta,
    leaderboard: rowsToCamel(leaderboardRes.data),
    onlineUsers: rowsToCamel(presenceRes.data),
  };
}

async function heartbeat(body) {
  const name = required(body.userName, 'userName is required.');
  const sessionDate = await getSessionDate();
  const { error } = await supabase.from('presence').upsert({
    name,
    role: body.role || '',
    session_date: sessionDate,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'name,session_date' });
  if (error) throw error;
  return { ok: true };
}

async function saveProject(body) {
  const presenterName = required(body.presenterName, 'presenterName is required.');
  const sessionDate = required(body.sessionDate, 'sessionDate is required.');
  const now = new Date().toISOString();

  // Check if project exists by projectId (allows multiple projects per person)
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
    // Get next queue order
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

  // Auto-add creator to project_presenters
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
  });
  if (error) throw error;
  return { ok: true };
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
  const stars = Math.max(1, Math.min(5, Number(body.stars || 1)));
  const now = new Date().toISOString();

  // Resolve project_id from the current presenter's active project
  const { data: project } = await supabase
    .from('projects')
    .select('project_id')
    .eq('session_date', sessionDate)
    .eq('presenter_name', presenterName)
    .eq('active_demo_day', true)
    .limit(1)
    .maybeSingle();

  const projectId = project?.project_id || null;

  // Check: same person cannot vote twice for the same project
  const { data: existing } = await supabase
    .from('votes')
    .select('vote_id')
    .eq('session_date', sessionDate)
    .eq('project_id', projectId)
    .eq('voter_name', voterName)
    .maybeSingle();

  if (existing) {
    // Update existing vote (allow changing stars)
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
