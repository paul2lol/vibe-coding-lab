(() => {
  const cfg = window.VIBE_CONFIG;
  const STORAGE_KEY = "vibe-coding-user";
  const el = (id) => document.getElementById(id);
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const state = {
    user: null,
    data: null,
    pollTimer: null,
    heartbeatTimer: null,
    countdownTimer: null,
    selectedProjectId: null,
    toastTimer: null,
  };

  function init() {
    hydrateLoginOptions();
    bindBaseEvents();
    restoreUser();
  }

  function hydrateLoginOptions() {
    const select = el("login-name");
    select.innerHTML = `<option value="">Select your name</option>` + cfg.team
      .map((m) => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)} — ${escapeHtml(m.role)}</option>`)
      .join("");
  }

  function bindBaseEvents() {
    el("login-form").addEventListener("submit", onLogin);
    el("logout-btn").addEventListener("click", logout);
    el("refresh-btn").addEventListener("click", () => refreshData(true));

    $$(".nav-btn").forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));

    el("project-form").addEventListener("submit", onSaveProject);
    el("clear-project-btn").addEventListener("click", clearProjectForm);
    el("feed-form").addEventListener("submit", onPostFeed);
    el("feed-image").addEventListener("change", onFeedImageChange);

    el("spin-wheel-btn").addEventListener("click", spinWheel);
    el("shuffle-queue-btn").addEventListener("click", shuffleQueue);
    el("announce-current-btn").addEventListener("click", announceCurrentPresenter);
    el("start-demo-btn").addEventListener("click", startDemoTimer);
    el("open-voting-btn").addEventListener("click", openVoting);
    el("close-voting-btn").addEventListener("click", closeVoting);
    el("next-presenter-btn").addEventListener("click", nextPresenter);
    el("end-session-btn").addEventListener("click", resetSession);
  }

  function restoreUser() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const user = JSON.parse(raw);
      if (!user?.name) return;
      state.user = user;
      enterApp();
    } catch (err) {
      console.warn(err);
    }
  }

  function onLogin(event) {
    event.preventDefault();
    const name = el("login-name").value.trim();
    const password = el("login-password").value;
    const errorEl = el("login-error");
    errorEl.textContent = "";

    if (!name) {
      errorEl.textContent = "Choose your name first.";
      return;
    }
    if (password !== cfg.sharedPassword) {
      errorEl.textContent = "Wrong password. Use the shared one.";
      return;
    }

    const member = cfg.team.find((m) => m.name === name);
    state.user = { name, role: member?.role || "Participant", isAdmin: cfg.adminNames.includes(name) };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.user));
    enterApp();
  }

  function enterApp() {
    el("login-view").classList.add("hidden");
    el("app-view").classList.remove("hidden");
    el("refresh-btn").classList.remove("hidden");
    el("logout-btn").classList.remove("hidden");

    el("sidebar-name").textContent = state.user.name;
    el("sidebar-role").textContent = state.user.role;
    el("user-avatar").textContent = state.user.name.charAt(0).toUpperCase();
    const adminWrap = el("admin-panel-wrap");
    adminWrap.style.display = state.user.isAdmin ? "block" : "none";

    el("project-session-date").value = toDateInput(getDefaultSessionDate());

    sendHeartbeat();
    refreshData(true);

    clearInterval(state.pollTimer);
    state.pollTimer = setInterval(() => refreshData(false), cfg.pollMs);

    clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = setInterval(sendHeartbeat, cfg.heartbeatMs);
  }

  function logout() {
    localStorage.removeItem(STORAGE_KEY);
    state.user = null;
    state.data = null;
    clearInterval(state.pollTimer);
    clearInterval(state.heartbeatTimer);
    clearInterval(state.countdownTimer);
    window.location.reload();
  }

  function switchTab(tabName) {
    $$(".nav-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tabName));
    $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.content === tabName));
  }

  async function refreshData(showToastMsg = false) {
    if (!state.user) return;
    try {
      const data = await apiGet("bootstrap", { viewer: state.user.name });
      state.data = data;
      renderAll();
      if (showToastMsg) toast("Arena refreshed.");
    } catch (err) {
      console.error(err);
      toast("Could not refresh live data.", true);
    }
  }

  async function sendHeartbeat() {
    if (!state.user) return;
    try {
      await apiPost("heartbeat", { userName: state.user.name, role: state.user.role });
    } catch (err) {
      console.warn("heartbeat failed", err);
    }
  }

  function renderAll() {
    if (!state.data) return;
    const data = state.data;
    const meta = data.meta || {};
    const activeProjects = sortActiveProjects(data.activeProjects || []);
    const currentProject = activeProjects.find((p) => p.projectId === meta.currentProjectId) || null;
    const currentVote = data.votes?.find((v) => v.presenterName === meta.currentPresenterName && v.voterName === state.user.name) || null;
    const myProject = (data.projects || []).find((p) => p.sessionDate === data.sessionDate && (p.presenterName === state.user.name || (p.presenters || []).includes(state.user.name))) || null;

    el("session-chip").textContent = `Session ${formatDisplayDate(data.sessionDate)}`;
    el("online-chip").textContent = `${(data.onlineUsers || []).length} in arena`;
    el("live-count").textContent = `${(data.onlineUsers || []).length}`;
    el("active-demo-count").textContent = `${activeProjects.length}`;
    el("current-presenter-stat").textContent = currentProject ? currentProject.presenterName : "—";
    el("voting-state-stat").textContent = meta.votingOpen ? "Open" : "Closed";
    el("session-health-chip").textContent = activeProjects.length >= 4 ? `Healthy day • ${activeProjects.length}` : `Need more demos • ${activeProjects.length}`;
    el("roster-count-chip").textContent = `${activeProjects.length} active`;

    renderCurrentPresenter(meta, currentProject, activeProjects);
    renderLineup(activeProjects, meta.currentProjectId);
    renderProjectCard(myProject);
    renderFeed(data.feed || [], data.comments || []);
    renderLeaderboard(data.leaderboard || []);
    renderVoteCard(meta, currentProject, currentVote);
    renderProjectForm(myProject, data.sessionDate);
  }

  function renderCurrentPresenter(meta, currentProject, activeProjects) {
    const nameEl = el("current-presenter-name");
    const projectEl = el("current-presenter-project");
    const announcementEl = el("current-announcement");
    const timerEl = el("timer-chip");
    const voteStatusChip = el("vote-status-chip");

    if (!currentProject) {
      nameEl.textContent = "No presenter yet";
      projectEl.textContent = "Spin the wheel or pick from the active roster.";
      announcementEl.textContent = "Once selected, the platform announces both the person and the project.";
    } else {
      nameEl.textContent = (currentProject.presenters || [currentProject.presenterName]).join(' & ');
      projectEl.textContent = currentProject.projectTitle;
      announcementEl.textContent = meta.lastAnnouncement || `${currentProject.presenterName} is presenting ${currentProject.projectTitle}.`;
    }

    const currentIdx = activeProjects.findIndex((p) => p.projectId === meta.currentProjectId);
    const next = currentIdx >= 0 ? activeProjects[currentIdx + 1] : activeProjects[0];
    el("next-presenter-card").textContent = next ? `${(next.presenters || [next.presenterName]).join(' & ')} — ${next.projectTitle}` : "No next presenter";
    el("upcoming-count-card").textContent = `${Math.max(0, activeProjects.length - (currentIdx + 1 || 0))} more in queue`;

    clearInterval(state.countdownTimer);
    const updateTimer = () => {
      const now = Date.now();
      let label = "00:00";
      if (meta.votingOpen && meta.votingEndsAt) {
        label = formatCountdown(meta.votingEndsAt - now);
        voteStatusChip.textContent = `Voting open • ${label}`;
      } else if (meta.demoEndsAt) {
        label = formatCountdown(meta.demoEndsAt - now);
        voteStatusChip.textContent = meta.votingOpen ? "Voting open" : "Voting closed";
      } else {
        voteStatusChip.textContent = meta.votingOpen ? "Voting open" : "Voting closed";
      }
      timerEl.textContent = label;
    };
    updateTimer();
    state.countdownTimer = setInterval(updateTimer, 1000);
  }

  function renderLineup(activeProjects, currentProjectId) {
    const wrap = el("lineup-list");
    if (!activeProjects.length) {
      wrap.innerHTML = `<div class="empty-state">No active presenters yet. Get people to mark themselves active for demo day.</div>`;
      return;
    }

    wrap.innerHTML = activeProjects.map((project, index) => {
      const isCurrent = currentProjectId === project.projectId;
      const isMine = project.presenterName === state.user.name;
      return `
        <div class="lineup-item ${isCurrent ? "is-current" : ""}">
          <div class="lineup-rank">${index + 1}</div>
          <div>
            <div class="lineup-name">${escapeHtml((project.presenters || [project.presenterName]).join(' & '))}</div>
            <div class="lineup-project">${escapeHtml(project.projectTitle)} • ${escapeHtml(project.category || "General")}</div>
          </div>
          <div class="lineup-actions">
            <button class="btn btn-ghost btn-sm" type="button" ${state.user.isAdmin ? "" : "disabled"} data-action="pick-presenter" data-id="${project.projectId}">${isCurrent ? "Live now" : "Set live"}</button>
            <button class="btn btn-ghost btn-sm" type="button" data-action="shoutout" data-id="${project.projectId}">${isMine ? "My card" : "Announce"}</button>
          </div>
        </div>`;
    }).join("");

    $$("[data-action='pick-presenter']", wrap).forEach((btn) => btn.addEventListener("click", () => setCurrentPresenter(btn.dataset.id)));
    $$("[data-action='shoutout']", wrap).forEach((btn) => btn.addEventListener("click", () => announceProject(btn.dataset.id)));
  }

  function renderProjectForm(myProject, sessionDate) {
    if (!document.activeElement || !document.activeElement.closest("#project-form")) {
      el("project-id").value = myProject?.projectId || "";
      el("project-title").value = myProject?.projectTitle || "";
      el("project-category").value = myProject?.category || "Product";
      el("project-session-date").value = myProject?.sessionDate || sessionDate || toDateInput(getDefaultSessionDate());
      el("project-description").value = myProject?.description || "";
      el("project-active-demo").checked = myProject ? String(myProject.activeDemoDay) === "true" : true;
    }
    renderCoPresenters(myProject);
  }

  function renderCoPresenters(myProject) {
    const wrap = el("co-presenters-section");
    if (!wrap) return;
    if (!myProject || !myProject.projectId) {
      wrap.style.display = "none";
      return;
    }
    wrap.style.display = "";
    const presenters = myProject.presenters || [myProject.presenterName];
    const isCreator = myProject.presenterName === state.user.name;
    const team = cfg.team.map((m) => m.name).filter((n) => !presenters.includes(n));

    let html = `<div class="field-label" style="margin-bottom:8px">Co-presenters</div>`;
    html += `<div class="co-presenter-list">`;
    presenters.forEach((name) => {
      const isOriginal = name === myProject.presenterName;
      html += `<span class="pill co-pill">${escapeHtml(name)}${!isOriginal && isCreator ? ` <button type="button" class="co-remove" data-name="${escapeHtml(name)}">&times;</button>` : ""}</span>`;
    });
    html += `</div>`;

    if (isCreator && team.length) {
      html += `<div class="co-add-row" style="margin-top:8px;display:flex;gap:8px">
        <select id="co-presenter-select" class="input" style="flex:1"><option value="">Add a teammate...</option>${team.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("")}</select>
        <button type="button" class="btn btn-ghost btn-sm" id="co-add-btn">Add</button>
      </div>`;
    }

    wrap.innerHTML = html;

    // Bind events
    const addBtn = el("co-add-btn");
    if (addBtn) {
      addBtn.addEventListener("click", async () => {
        const select = el("co-presenter-select");
        const name = select?.value;
        if (!name) return;
        await apiPost("addPresenter", { projectId: myProject.projectId, presenterName: name });
        toast(`${name} added as co-presenter.`);
        refreshData(false);
      });
    }
    $$(".co-remove", wrap).forEach((btn) => {
      btn.addEventListener("click", async () => {
        const name = btn.dataset.name;
        await apiPost("removePresenter", { projectId: myProject.projectId, presenterName: name });
        toast(`${name} removed.`);
        refreshData(false);
      });
    });
  }

  function renderProjectCard(myProject) {
    const wrap = el("my-project-card");
    if (!myProject) {
      wrap.className = "empty-state compact";
      wrap.innerHTML = "No project submitted yet.";
      return;
    }

    wrap.className = "brutal-card glass";
    wrap.innerHTML = `
      <div class="section-head tight">
        <div>
          <div class="eyebrow">${escapeHtml(myProject.category || "General")}</div>
          <h3>${escapeHtml(myProject.projectTitle)}</h3>
        </div>
        <div class="chip ${String(myProject.activeDemoDay) === "true" ? "chip-lime" : "chip-outline"}">${String(myProject.activeDemoDay) === "true" ? "Active demo day" : "Draft only"}</div>
      </div>
      <p class="hero-copy" style="margin:0;color:rgba(255,255,255,.78)">${escapeHtml(myProject.description)}</p>
      <div class="hero-points" style="margin-top:14px">
        <div class="pill">${escapeHtml((myProject.presenters || [myProject.presenterName]).join(' & '))}</div>
        <div class="pill">${escapeHtml(formatDisplayDate(myProject.sessionDate))}</div>
        <div class="pill">Queue #${escapeHtml(myProject.queueOrder || "—")}</div>
      </div>
    `;
  }

  function renderVoteCard(meta, currentProject, currentVote) {
    el("vote-presenter-name").textContent = currentProject ? (currentProject.presenters || [currentProject.presenterName]).join(' & ') : "No presenter live";
    el("vote-project-title").textContent = currentProject ? currentProject.projectTitle : "Wait for the next announcement.";
    const wrap = el("star-row");
    const isOpen = Boolean(meta.votingOpen && currentProject);

    wrap.innerHTML = [1,2,3,4,5].map((stars) => `
      <button class="star-btn ${currentVote?.stars === stars ? "active" : ""}" type="button" data-stars="${stars}" ${isOpen ? "" : "disabled"}>${"★".repeat(stars)}</button>
    `).join("");

    $$(".star-btn", wrap).forEach((btn) => btn.addEventListener("click", () => submitVote(Number(btn.dataset.stars))));

    if (!currentProject) {
      el("vote-feedback").textContent = "No presenter is live right now.";
    } else if (!meta.votingOpen) {
      el("vote-feedback").textContent = currentVote ? `You already voted ${currentVote.stars} star(s) for ${(currentProject.presenters || [currentProject.presenterName]).join(' & ')}.` : "Voting is closed. Wait for the admin to open it.";
    } else if (currentVote) {
      el("vote-feedback").textContent = `You already voted ${currentVote.stars} star(s) for ${(currentProject.presenters || [currentProject.presenterName]).join(' & ')}.`;
    } else {
      el("vote-feedback").textContent = `Vote now for ${(currentProject.presenters || [currentProject.presenterName]).join(' & ')} — ${currentProject.projectTitle}.`;
    }
  }

  function renderFeed(feed, comments) {
    const wrap = el("feed-list");
    if (!feed.length) {
      wrap.innerHTML = `<div class="empty-state">No updates yet. Post a build update to make the room feel alive.</div>`;
      return;
    }

    wrap.innerHTML = feed.map((post) => {
      const postComments = comments.filter((c) => c.feedId === post.feedId);
      const iHearted = (post.heartedBy || []).includes(state.user?.name);
      const heartCount = post.heartCount || 0;

      const imageHtml = post.imageUrl
        ? `<div class="feed-image"><img src="${escapeHtml(post.imageUrl)}" alt="Screenshot" loading="lazy" /></div>`
        : "";

      const linkHtml = post.linkUrl
        ? `<div class="feed-link"><a href="${escapeHtml(post.linkUrl)}" target="_blank" rel="noopener">${escapeHtml(post.linkUrl)}</a></div>`
        : "";

      return `
        <div class="feed-item">
          <div class="feed-header">
            <div>
              <div class="feed-author">${escapeHtml(post.authorName)}</div>
              <div class="feed-meta">${escapeHtml(post.authorProject || "No project tagged")} • ${escapeHtml(timeAgo(post.createdAt))}</div>
            </div>
            <div class="chip chip-outline">${escapeHtml(post.sessionDate)}</div>
          </div>
          <div class="feed-text">${escapeHtml(post.message)}</div>
          ${linkHtml}
          ${imageHtml}
          <div class="feed-actions">
            <button class="btn btn-ghost btn-sm heart-btn ${iHearted ? "hearted" : ""}" type="button" data-action="heart" data-feed-id="${post.feedId}">
              ${iHearted ? "❤️" : "🤍"} ${heartCount > 0 ? heartCount : ""}
            </button>
          </div>
          <div class="comment-list">
            ${postComments.map((comment) => `
              <div class="comment-item">
                <div class="comment-header">
                  <div class="comment-author">${escapeHtml(comment.authorName)}</div>
                  <div class="comment-meta">${escapeHtml(timeAgo(comment.createdAt))}</div>
                </div>
                <div class="comment-text">${escapeHtml(comment.message)}</div>
              </div>
            `).join("")}
          </div>
          <form class="comment-form" data-feed-id="${post.feedId}">
            <input class="input" type="text" maxlength="180" placeholder="Comment on this build..." required />
            <button class="btn btn-black" type="submit">Comment</button>
          </form>
        </div>
      `;
    }).join("");

    $$(".comment-form", wrap).forEach((form) => form.addEventListener("submit", onPostComment));
    $$("[data-action='heart']", wrap).forEach((btn) => btn.addEventListener("click", () => toggleHeart(btn.dataset.feedId)));
  }

  function renderLeaderboard(rows) {
    const wrap = el("leaderboard-list");
    if (!rows.length) {
      wrap.innerHTML = `<div class="empty-state">No votes yet. Once demo-day voting begins, the leaderboard will light up.</div>`;
      return;
    }

    wrap.innerHTML = rows.map((row, index) => `
      <div class="leader-item">
        <div class="leader-row">
          <div style="display:flex; gap:14px; align-items:center;">
            <div class="rank-badge">${index + 1}</div>
            <div>
              <div class="leader-name">${escapeHtml(row.presenterName)}</div>
              <div class="leader-meta">${escapeHtml(row.votesCount)} votes • ${escapeHtml(row.projectTitle || "Project")}</div>
            </div>
          </div>
          <div class="leader-score">${Number(row.avgStars || 0).toFixed(2)} ★</div>
        </div>
        <div class="leader-project">${escapeHtml(row.projectTitle || "")}</div>
      </div>
    `).join("");
  }

  async function onSaveProject(event) {
    event.preventDefault();
    const payload = {
      projectId: el("project-id").value || "",
      presenterName: state.user.name,
      projectTitle: el("project-title").value.trim(),
      category: el("project-category").value,
      sessionDate: el("project-session-date").value,
      description: el("project-description").value.trim(),
      activeDemoDay: String(el("project-active-demo").checked)
    };

    if (!payload.projectTitle || !payload.description || !payload.sessionDate) {
      toast("Fill in the full project card first.", true);
      return;
    }

    await apiPost("saveProject", payload);
    toast("Project saved. You are on the board.");
    refreshData(false);
  }

  function clearProjectForm() {
    el("project-id").value = "";
    el("project-title").value = "";
    el("project-category").value = "Product";
    el("project-session-date").value = toDateInput(getDefaultSessionDate());
    el("project-description").value = "";
    el("project-active-demo").checked = true;
  }

  async function onPostFeed(event) {
    event.preventDefault();
    const message = el("feed-message").value.trim();
    if (!message) {
      toast("Write something before posting.", true);
      return;
    }

    let imageUrl = "";
    const fileInput = el("feed-image");
    if (fileInput.files && fileInput.files[0]) {
      toast("Uploading screenshot...");
      const base64 = await fileToBase64(fileInput.files[0]);
      const uploadRes = await apiPost("uploadFeedImage", { imageData: base64 });
      imageUrl = uploadRes.imageUrl || "";
    }

    const linkUrl = el("feed-link").value.trim();
    const myProject = (state.data?.projects || []).find((p) => p.sessionDate === state.data.sessionDate && (p.presenterName === state.user.name || (p.presenters || []).includes(state.user.name)));
    await apiPost("saveFeed", {
      authorName: state.user.name,
      authorProject: myProject?.projectTitle || "",
      message,
      imageUrl,
      linkUrl,
      sessionDate: state.data.sessionDate
    });
    el("feed-message").value = "";
    el("feed-link").value = "";
    fileInput.value = "";
    el("feed-image-preview").classList.add("hidden");
    el("feed-image-preview").innerHTML = "";
    toast("Posted to the feed.");
    refreshData(false);
  }

  function onFeedImageChange() {
    const fileInput = el("feed-image");
    const preview = el("feed-image-preview");
    if (fileInput.files && fileInput.files[0]) {
      const url = URL.createObjectURL(fileInput.files[0]);
      preview.innerHTML = `<img src="${url}" alt="Preview" />`;
      preview.classList.remove("hidden");
    } else {
      preview.innerHTML = "";
      preview.classList.add("hidden");
    }
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function toggleHeart(feedId) {
    if (!state.user) return;
    await apiPost("heartFeed", { feedId, userName: state.user.name });
    refreshData(false);
  }

  async function onPostComment(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = $("input", form);
    const message = input.value.trim();
    if (!message) return;

    await apiPost("saveComment", {
      feedId: form.dataset.feedId,
      authorName: state.user.name,
      message,
      sessionDate: state.data.sessionDate
    });
    input.value = "";
    toast("Comment dropped.");
    refreshData(false);
  }

  async function submitVote(stars) {
    const meta = state.data?.meta || {};
    if (!meta.votingOpen || !meta.currentPresenterName) {
      toast("Voting is not open right now.", true);
      return;
    }

    await apiPost("vote", {
      sessionDate: state.data.sessionDate,
      presenterName: meta.currentPresenterName,
      voterName: state.user.name,
      stars
    });
    toast(`Locked ${stars} star(s).`);
    burstConfetti(22);
    refreshData(false);
  }

  async function spinWheel() {
    const allActive = sortActiveProjects(state.data?.activeProjects || []);
    // Exclude projects that already got voted on today
    const votedProjectIds = new Set((state.data?.votes || []).map((v) => v.projectId).filter(Boolean));
    const eligible = allActive.filter((p) => !votedProjectIds.has(p.projectId));

    if (!eligible.length) {
      toast("All active projects have been voted on already.", true);
      return;
    }

    const box = el("wheel-result");
    const sub = el("wheel-sub");
    const steps = 20 + Math.floor(Math.random() * 14);
    let count = 0;
    let pick = eligible[0];
    const interval = setInterval(() => {
      pick = eligible[Math.floor(Math.random() * eligible.length)];
      box.textContent = (pick.presenters || [pick.presenterName]).join(' & ');
      sub.textContent = pick.projectTitle;
      count += 1;
      if (count >= steps) {
        clearInterval(interval);
        state.selectedProjectId = pick.projectId;
        burstConfetti(60);
        toast(`${(pick.presenters || [pick.presenterName]).join(' & ')} — ${pick.projectTitle}`);
      }
    }, 70 + count * 2);
  }

  async function shuffleQueue() {
    if (!state.user?.isAdmin) return toast("Only admin can reshuffle the queue.", true);
    const activeProjects = sortActiveProjects(state.data?.activeProjects || []);
    if (!activeProjects.length) return toast("No active presenters to queue.", true);
    const shuffled = [...activeProjects].sort(() => Math.random() - 0.5).map((p) => p.projectId);
    await apiPost("updateQueue", { projectIds: shuffled, sessionDate: state.data.sessionDate });
    toast("Queue shuffled. Pure beautiful chaos.");
    refreshData(false);
  }

  async function setCurrentPresenter(projectId) {
    if (!state.user?.isAdmin) return toast("Only admin can set the live presenter.", true);
    const project = (state.data?.activeProjects || []).find((p) => p.projectId === projectId);
    if (!project) return;
    await apiPost("setCurrentPresenter", {
      projectId: project.projectId,
      presenterName: project.presenterName,
      projectTitle: project.projectTitle,
      sessionDate: state.data.sessionDate
    });
    state.selectedProjectId = project.projectId;
    toast(`${(project.presenters || [project.presenterName]).join(' & ')} is now on deck.`);
    refreshData(false);
  }

  async function announceProject(projectId) {
    const project = (state.data?.activeProjects || []).find((p) => p.projectId === projectId) || (state.data?.projects || []).find((p) => p.projectId === projectId);
    if (!project) return;
    const names = (project.presenters || [project.presenterName]).join(' & ');
    const message = `${names} is presenting ${project.projectTitle}.`;
    el("wheel-result").textContent = names;
    el("wheel-sub").textContent = project.projectTitle;
    if (state.user.isAdmin) {
      await apiPost("setAnnouncement", { lastAnnouncement: message, sessionDate: state.data.sessionDate });
      refreshData(false);
    } else {
      toast(message);
    }
  }

  async function announceCurrentPresenter() {
    if (!state.user?.isAdmin) return;
    const activeProjects = sortActiveProjects(state.data?.activeProjects || []);
    const project = activeProjects.find((p) => p.projectId === state.selectedProjectId) || activeProjects.find((p) => p.projectId === state.data?.meta?.currentProjectId);
    if (!project) return toast("Pick or set a presenter first.", true);
    await apiPost("setCurrentPresenter", {
      projectId: project.projectId,
      presenterName: project.presenterName,
      projectTitle: project.projectTitle,
      sessionDate: state.data.sessionDate
    });
    toast(`Announced: ${(project.presenters || [project.presenterName]).join(' & ')} — ${project.projectTitle}`);
    burstConfetti(35);
    refreshData(false);
  }

  async function startDemoTimer() {
    if (!state.user?.isAdmin) return;
    const meta = state.data?.meta || {};
    if (!meta.currentProjectId) return toast("Set a presenter live first.", true);
    const demoEndsAt = new Date(Date.now() + cfg.defaultDemoMinutes * 60 * 1000).toISOString();
    await apiPost("updateMeta", { sessionDate: state.data.sessionDate, updates: { demoEndsAt, votingOpen: false, votingEndsAt: "" } });
    toast(`Demo timer started for ${cfg.defaultDemoMinutes} minutes.`);
    refreshData(false);
  }

  async function openVoting() {
    if (!state.user?.isAdmin) return;
    const meta = state.data?.meta || {};
    if (!meta.currentPresenterName) return toast("No live presenter yet.", true);
    const votingEndsAt = new Date(Date.now() + cfg.defaultVotingSeconds * 1000).toISOString();
    await apiPost("updateMeta", { sessionDate: state.data.sessionDate, updates: { votingOpen: true, votingEndsAt } });
    toast(`Voting opened for ${cfg.defaultVotingSeconds} seconds.`);
    refreshData(false);
  }

  async function closeVoting() {
    if (!state.user?.isAdmin) return;
    await apiPost("updateMeta", { sessionDate: state.data.sessionDate, updates: { votingOpen: false, votingEndsAt: "" } });
    toast("Voting closed.");
    refreshData(false);
  }

  async function nextPresenter() {
    if (!state.user?.isAdmin) return;
    const activeProjects = sortActiveProjects(state.data?.activeProjects || []);
    if (!activeProjects.length) return toast("No active queue found.", true);
    const currentId = state.data?.meta?.currentProjectId;
    const idx = activeProjects.findIndex((p) => p.projectId === currentId);
    const next = idx >= 0 ? activeProjects[idx + 1] : activeProjects[0];
    if (!next) return toast("Queue is complete.", true);
    await apiPost("setCurrentPresenter", {
      projectId: next.projectId,
      presenterName: next.presenterName,
      projectTitle: next.projectTitle,
      sessionDate: state.data.sessionDate
    });
    toast(`Next up: ${next.presenterName}.`);
    refreshData(false);
  }

  async function resetSession() {
    if (!state.user?.isAdmin) return;
    await apiPost("updateMeta", {
      sessionDate: state.data.sessionDate,
      updates: {
        currentProjectId: "",
        currentPresenterName: "",
        currentProjectTitle: "",
        lastAnnouncement: "",
        votingOpen: false,
        votingEndsAt: "",
        demoEndsAt: ""
      }
    });
    toast("Session reset. Fresh stage.");
    refreshData(false);
  }

  // function apiUrl(action, params = {}) {
  //   const url = new URL(`${window.location.origin}/api/proxy`);
  //   url.searchParams.set("action", action);
  //   Object.entries(params).forEach(([key, value]) => {
  //     if (value === undefined || value === null) return;
  //     url.searchParams.set(key, String(value));
  //   });
  //   return url.toString();
  // }

  function apiUrl(action, params = {}) {

    let base;

    // LOCAL TESTING
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
      base = window.VIBE_CONFIG.apiUrl;
    }
    // VERCEL DEPLOYMENT
    else {
      base = window.location.origin + "/api/proxy";
    }

    const url = new URL(base);

    url.searchParams.set("action", action);

    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      url.searchParams.set(key, String(value));
    });

    return url.toString();
  }

  // async function apiGet(action, params = {}) {
  //   const response = await fetch(apiUrl(action, params), { credentials: "same-origin" });
  //   const json = await response.json();
  //   if (!response.ok || json.ok === false) throw new Error(json.error || "Request failed");
  //   return json;
  // }

  async function apiGet(action, params = {}) {
    const response = await fetch(apiUrl(action, params));
    const json = await response.json();
    if (!response.ok || json.ok === false) {
      throw new Error(json.error || "Request failed");
    }
    return json;
  }

  // async function apiPost(action, payload = {}) {
  //   const response = await fetch(apiUrl(action), {
  //     method: "POST",
  //     headers: { "Content-Type": "application/json" },
  //     credentials: "same-origin",
  //     body: JSON.stringify(payload)
  //   });
  //   const json = await response.json();
  //   if (!response.ok || json.ok === false) throw new Error(json.error || "Request failed");
  //   return json;
  // }
  
  // async function apiPost(action, payload = {}) {

  //   const response = await fetch(apiUrl(action), {
  //     method: "POST",
  //     headers: {
  //       "Content-Type": "application/json"
  //     },
  //     body: JSON.stringify(payload)
  //   });

  //   const json = await response.json();

  //   if (!response.ok || json.ok === false) {
  //     throw new Error(json.error || "Request failed");
  //   }

  //   return json;
  // }

  // async function apiPost(action, payload = {}) {

  //   const url = apiUrl(action, payload);   // convert payload to query params

  //   const response = await fetch(url);     // send GET instead of POST

  //   const json = await response.json();

  //   if (!response.ok || json.ok === false) {
  //     throw new Error(json.error || "Request failed");
  //   }

  //   return json;
  // }


  async function apiPost(action, payload = {}) {

    const response = await fetch(apiUrl(action), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action,
        ...payload
      })
    });

    const json = await response.json();

    if (!response.ok || json.ok === false) {
      throw new Error(json.error || "Request failed");
    }

    return json;
  }


  function sortActiveProjects(projects) {
    return [...projects].sort((a, b) => {
      const aq = Number(a.queueOrder || 999);
      const bq = Number(b.queueOrder || 999);
      if (aq !== bq) return aq - bq;
      return String(a.presenterName).localeCompare(String(b.presenterName));
    });
  }

  function getDefaultSessionDate() {
    const now = new Date();
    const day = now.getDay();
    const result = new Date(now);
    if (day === 1) return result;
    const daysUntilMonday = day === 0 ? 1 : 8 - day;
    result.setDate(now.getDate() + daysUntilMonday);
    return result;
  }

  function toDateInput(dateValue) {
    const date = new Date(dateValue);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function formatDisplayDate(dateStr) {
    if (!dateStr) return "—";
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  }

  function formatCountdown(diffMs) {
    const safe = Math.max(0, diffMs || 0);
    const totalSec = Math.floor(safe / 1000);
    const mins = String(Math.floor(totalSec / 60)).padStart(2, "0");
    const secs = String(totalSec % 60).padStart(2, "0");
    return `${mins}:${secs}`;
  }

  function timeAgo(value) {
    if (!value) return "now";
    const diff = Date.now() - new Date(value).getTime();
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    return `${day}d ago`;
  }

  function toast(message, isError = false) {
    const node = el("toast");
    node.textContent = message;
    node.style.background = isError ? "#9b1d00" : "#000";
    node.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => node.classList.remove("show"), 2400);
  }

  function burstConfetti(n = 40) {
    const root = el("confetti-root");
    const colors = ["#3d6aff", "#ff1e99", "#9dff3a", "#ffe75a", "#ffffff"];
    for (let i = 0; i < n; i += 1) {
      const piece = document.createElement("i");
      piece.className = "confetti-piece";
      piece.style.left = `${Math.random() * 100}vw`;
      piece.style.top = `${-10 - Math.random() * 20}vh`;
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDuration = `${900 + Math.random() * 900}ms`;
      piece.style.transform = `translateY(-10vh) rotate(${Math.random() * 30 - 15}deg)`;
      root.appendChild(piece);
      setTimeout(() => piece.remove(), 2200);
    }
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  init();
})();
