const SHEETS = {
  USERS: 'Users',
  PROJECTS: 'Projects',
  VOTES: 'Votes',
  FEED: 'Feed',
  COMMENTS: 'Comments',
  META: 'Meta',
  PRESENCE: 'Presence'
};

const DEFAULT_TEAM = [
  ['Aditya', 'Tech'],
  ['Amit', 'Tech'],
  ['Vara', 'Tech'],
  ['Kartik', 'Tech'],
  ['Vivek', 'Tech'],
  ['Suraj', 'Tech'],
  ['Ankit', 'Tech'],
  ['Divya', 'QA'],
  ['Sandeep', 'Design'],
  ['Paul', 'PM'],
  ['Suneet', 'PM'],
  ['Sudheer', 'PM'],
  ['Shivam', 'PM'],
  ['Diksha', 'PjM'],
  ['Shreedevi', 'Curriculum']
];

function doGet(e) {
  try {
    ensureSetup_();
    const action = (e.parameter.action || 'bootstrap').trim();
    if (action === 'bootstrap') {
      return jsonResponse_(bootstrap_(e.parameter.viewer || ''));
    }
    return jsonResponse_({ ok: false, error: 'Unknown GET action.' });
  } catch (error) {
    return jsonResponse_({ ok: false, error: error.message, stack: error.stack });
  }
}

function doPost(e) {
  try {
    ensureSetup_();
    const body = parseJsonBody_(e);
    const action = (body.action || '').trim();

    switch (action) {
      case 'heartbeat':
        heartbeat_(body);
        return jsonResponse_({ ok: true });
      case 'saveProject':
        saveProject_(body);
        return jsonResponse_({ ok: true });
      case 'saveFeed':
        saveFeed_(body);
        return jsonResponse_({ ok: true });
      case 'saveComment':
        saveComment_(body);
        return jsonResponse_({ ok: true });
      case 'vote':
        vote_(body);
        return jsonResponse_({ ok: true });
      case 'updateQueue':
        updateQueue_(body);
        return jsonResponse_({ ok: true });
      case 'setCurrentPresenter':
        setCurrentPresenter_(body);
        return jsonResponse_({ ok: true });
      case 'setAnnouncement':
        updateMetaValues_(body.sessionDate, { lastAnnouncement: body.lastAnnouncement || '' });
        return jsonResponse_({ ok: true });
      case 'updateMeta':
        updateMetaValues_(body.sessionDate, body.updates || {});
        return jsonResponse_({ ok: true });
      default:
        return jsonResponse_({ ok: false, error: 'Unknown POST action.' });
    }
  } catch (error) {
    return jsonResponse_({ ok: false, error: error.message, stack: error.stack });
  }
}

function bootstrap_(viewer) {
  const sessionDate = getMetaValue_('sessionDate') || getDefaultSessionDate_();
  setMetaValue_('sessionDate', sessionDate);

  const users = getRows_(SHEETS.USERS);
  const projects = getRows_(SHEETS.PROJECTS).filter((row) => row.sessionDate === sessionDate);
  const votes = getRows_(SHEETS.VOTES).filter((row) => row.sessionDate === sessionDate);
  const feed = getRows_(SHEETS.FEED).filter((row) => row.sessionDate === sessionDate).sort(sortByDateDesc_);
  const comments = getRows_(SHEETS.COMMENTS).filter((row) => row.sessionDate === sessionDate).sort(sortByDateAsc_);
  const meta = getMetaMap_();
  const onlineUsers = getOnlineUsers_(sessionDate);
  const activeProjects = projects.filter((row) => String(row.activeDemoDay) === 'true');

  return {
    ok: true,
    viewer: viewer || '',
    sessionDate,
    team: users,
    projects,
    activeProjects,
    votes,
    feed,
    comments,
    meta,
    leaderboard: buildLeaderboard_(activeProjects, votes),
    onlineUsers
  };
}

function heartbeat_(payload) {
  const name = required_(payload.userName, 'userName is required.');
  const role = payload.role || '';
  const sessionDate = getMetaValue_('sessionDate') || getDefaultSessionDate_();
  const sheet = getSheet_(SHEETS.PRESENCE);
  const rows = getRows_(SHEETS.PRESENCE);
  const existingIndex = rows.findIndex((row) => row.name === name && row.sessionDate === sessionDate);
  const now = isoNow_();

  if (existingIndex >= 0) {
    sheet.getRange(existingIndex + 2, 1, 1, 4).setValues([[name, role, sessionDate, now]]);
  } else {
    sheet.appendRow([name, role, sessionDate, now]);
  }
}

function saveProject_(payload) {
  const sheet = getSheet_(SHEETS.PROJECTS);
  const rows = getRows_(SHEETS.PROJECTS);
  const projectId = payload.projectId || Utilities.getUuid();
  const sessionDate = required_(payload.sessionDate, 'sessionDate is required.');
  const presenterName = required_(payload.presenterName, 'presenterName is required.');
  const now = isoNow_();

  const rowValues = [
    projectId,
    sessionDate,
    presenterName,
    required_(payload.projectTitle, 'projectTitle is required.'),
    payload.category || 'General',
    required_(payload.description, 'description is required.'),
    String(payload.activeDemoDay) === 'true' ? 'true' : 'false',
    '',
    'ready',
    now,
    now
  ];

  const existingIndex = rows.findIndex((row) => row.projectId === projectId || (row.presenterName === presenterName && row.sessionDate === sessionDate));

  if (existingIndex >= 0) {
    const currentQueueOrder = rows[existingIndex].queueOrder || '';
    rowValues[7] = currentQueueOrder;
    rowValues[9] = rows[existingIndex].createdAt || now;
    sheet.getRange(existingIndex + 2, 1, 1, rowValues.length).setValues([rowValues]);
  } else {
    rowValues[7] = String(getNextQueueOrder_(sessionDate));
    sheet.appendRow(rowValues);
  }
}

function saveFeed_(payload) {
  const sheet = getSheet_(SHEETS.FEED);
  sheet.appendRow([
    Utilities.getUuid(),
    required_(payload.sessionDate, 'sessionDate is required.'),
    required_(payload.authorName, 'authorName is required.'),
    payload.authorProject || '',
    required_(payload.message, 'message is required.'),
    isoNow_()
  ]);
}

function saveComment_(payload) {
  const sheet = getSheet_(SHEETS.COMMENTS);
  sheet.appendRow([
    Utilities.getUuid(),
    required_(payload.feedId, 'feedId is required.'),
    required_(payload.sessionDate, 'sessionDate is required.'),
    required_(payload.authorName, 'authorName is required.'),
    required_(payload.message, 'message is required.'),
    isoNow_()
  ]);
}

function vote_(payload) {
  const sheet = getSheet_(SHEETS.VOTES);
  const rows = getRows_(SHEETS.VOTES);
  const sessionDate = required_(payload.sessionDate, 'sessionDate is required.');
  const presenterName = required_(payload.presenterName, 'presenterName is required.');
  const voterName = required_(payload.voterName, 'voterName is required.');
  const stars = String(Math.max(1, Math.min(5, Number(payload.stars || 1))));
  const now = isoNow_();
  const existingIndex = rows.findIndex((row) => row.sessionDate === sessionDate && row.presenterName === presenterName && row.voterName === voterName);

  const voteRow = [
    existingIndex >= 0 ? rows[existingIndex].voteId : Utilities.getUuid(),
    sessionDate,
    presenterName,
    voterName,
    stars,
    existingIndex >= 0 ? rows[existingIndex].createdAt : now,
    now
  ];

  if (existingIndex >= 0) {
    sheet.getRange(existingIndex + 2, 1, 1, voteRow.length).setValues([voteRow]);
  } else {
    sheet.appendRow(voteRow);
  }
}

function updateQueue_(payload) {
  const projectIds = payload.projectIds || [];
  if (!projectIds.length) return;
  const rows = getRows_(SHEETS.PROJECTS);
  const sheet = getSheet_(SHEETS.PROJECTS);
  const orderMap = {};
  projectIds.forEach((id, index) => orderMap[id] = String(index + 1));

  rows.forEach((row, idx) => {
    if (orderMap[row.projectId]) {
      sheet.getRange(idx + 2, 8).setValue(orderMap[row.projectId]);
      sheet.getRange(idx + 2, 11).setValue(isoNow_());
    }
  });
}

function setCurrentPresenter_(payload) {
  const sessionDate = required_(payload.sessionDate, 'sessionDate is required.');
  updateMetaValues_(sessionDate, {
    currentProjectId: required_(payload.projectId, 'projectId is required.'),
    currentPresenterName: required_(payload.presenterName, 'presenterName is required.'),
    currentProjectTitle: required_(payload.projectTitle, 'projectTitle is required.'),
    lastAnnouncement: payload.presenterName + ' is presenting ' + payload.projectTitle + '.',
    votingOpen: false,
    votingEndsAt: ''
  });
}

function buildLeaderboard_(activeProjects, votes) {
  const projectMap = {};
  activeProjects.forEach((project) => projectMap[project.presenterName] = project.projectTitle);
  const grouped = {};

  votes.forEach((vote) => {
    if (!grouped[vote.presenterName]) grouped[vote.presenterName] = [];
    grouped[vote.presenterName].push(Number(vote.stars || 0));
  });

  return Object.keys(grouped).map((presenterName) => {
    const items = grouped[presenterName];
    const total = items.reduce((sum, value) => sum + value, 0);
    return {
      presenterName,
      projectTitle: projectMap[presenterName] || '',
      avgStars: items.length ? total / items.length : 0,
      votesCount: items.length
    };
  }).sort((a, b) => b.avgStars - a.avgStars || b.votesCount - a.votesCount || a.presenterName.localeCompare(b.presenterName));
}

function getOnlineUsers_(sessionDate) {
  const threshold = Date.now() - 2 * 60 * 1000;
  return getRows_(SHEETS.PRESENCE)
    .filter((row) => row.sessionDate === sessionDate && new Date(row.lastSeenAt).getTime() >= threshold)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function ensureSetup_() {
  ensureSheet_(SHEETS.USERS, ['name', 'role', 'enabled', 'createdAt']);
  ensureSheet_(SHEETS.PROJECTS, ['projectId', 'sessionDate', 'presenterName', 'projectTitle', 'category', 'description', 'activeDemoDay', 'queueOrder', 'status', 'createdAt', 'updatedAt']);
  ensureSheet_(SHEETS.VOTES, ['voteId', 'sessionDate', 'presenterName', 'voterName', 'stars', 'createdAt', 'updatedAt']);
  ensureSheet_(SHEETS.FEED, ['feedId', 'sessionDate', 'authorName', 'authorProject', 'message', 'createdAt']);
  ensureSheet_(SHEETS.COMMENTS, ['commentId', 'feedId', 'sessionDate', 'authorName', 'message', 'createdAt']);
  ensureSheet_(SHEETS.META, ['key', 'value', 'updatedAt']);
  ensureSheet_(SHEETS.PRESENCE, ['name', 'role', 'sessionDate', 'lastSeenAt']);
  seedUsers_();
}

function ensureSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
}

function seedUsers_() {
  const rows = getRows_(SHEETS.USERS);
  if (rows.length) return;
  const sheet = getSheet_(SHEETS.USERS);
  const now = isoNow_();
  DEFAULT_TEAM.forEach((member) => sheet.appendRow([member[0], member[1], 'true', now]));
}

function getSheet_(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function getRows_(name) {
  const sheet = getSheet_(name);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0];
  return values.slice(1).filter((row) => row.join('') !== '').map((row) => {
    const obj = {};
    headers.forEach((header, index) => obj[header] = row[index]);
    return obj;
  });
}

function getMetaMap_() {
  const map = {};
  getRows_(SHEETS.META).forEach((row) => map[row.key] = row.value);
  return map;
}

function getMetaValue_(key) {
  const rows = getRows_(SHEETS.META);
  const row = rows.find((item) => item.key === key);
  return row ? row.value : '';
}

function setMetaValue_(key, value) {
  const sheet = getSheet_(SHEETS.META);
  const rows = getRows_(SHEETS.META);
  const existingIndex = rows.findIndex((row) => row.key === key);
  const record = [key, value, isoNow_()];
  if (existingIndex >= 0) {
    sheet.getRange(existingIndex + 2, 1, 1, 3).setValues([record]);
  } else {
    sheet.appendRow(record);
  }
}

function updateMetaValues_(sessionDate, updates) {
  if (sessionDate) setMetaValue_('sessionDate', sessionDate);
  Object.keys(updates || {}).forEach((key) => setMetaValue_(key, updates[key]));
}

function getNextQueueOrder_(sessionDate) {
  const rows = getRows_(SHEETS.PROJECTS).filter((row) => row.sessionDate === sessionDate);
  const maxOrder = rows.reduce((max, row) => Math.max(max, Number(row.queueOrder || 0)), 0);
  return maxOrder + 1;
}

function getDefaultSessionDate_() {
  const now = new Date();
  const day = now.getDay();
  const target = new Date(now.getTime());
  if (day === 1) return formatDate_(target);
  const daysUntilMonday = day === 0 ? 1 : 8 - day;
  target.setDate(now.getDate() + daysUntilMonday);
  return formatDate_(target);
}

function required_(value, message) {
  if (value === undefined || value === null || String(value).trim() === '') throw new Error(message);
  return String(value).trim();
}

function parseJsonBody_(e) {
  if (!e.postData || !e.postData.contents) return {};
  return JSON.parse(e.postData.contents);
}

function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function isoNow_() {
  return new Date().toISOString();
}

function formatDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function sortByDateDesc_(a, b) {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function sortByDateAsc_(a, b) {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}
