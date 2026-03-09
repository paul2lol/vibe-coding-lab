# Vibe Coding Lab

A neo-brutalist internal platform for:
- trust-based login
- project submission
- active demo-day roster
- live presenter announcement (name + project)
- live voting (1–5 stars)
- hackathon feed + comments
- live leaderboard
- Google Sheets as the central backend
- Vercel frontend deployment

## Files included

- `index.html` — frontend shell
- `styles.css` — neo-brutalist theme
- `config.js` — team list, shared password, admin names
- `app.js` — full frontend logic
- `api/proxy.js` — Vercel serverless proxy for Apps Script
- `backend/google_apps_script.gs` — Google Apps Script backend for Google Sheets

## Setup

### 1) Create a Google Sheet
Create a new Google Sheet named anything you like, for example:

`Vibe Coding Lab`

### 2) Add Apps Script backend
Inside the Google Sheet:

- Extensions → Apps Script
- Delete the default code
- Paste the full contents of `backend/google_apps_script.gs`
- Save

### 3) Deploy Apps Script as Web App
In Apps Script:

- Deploy → New deployment
- Type: Web app
- Execute as: **Me**
- Who has access: **Anyone**
- Deploy

Copy the deployed Web App URL.

### 4) Put frontend on GitHub / Vercel
Upload the whole folder to a Git repo.

### 5) Add Vercel environment variable
In Vercel Project Settings → Environment Variables:

- `APPS_SCRIPT_URL` = your Apps Script Web App URL

### 6) Deploy on Vercel
Deploy the repo.

That’s it.

## Default behavior

- shared password in `config.js` is `vibe123`
- admin users in `config.js` are `Paul`
- the team roster is already preloaded
- all Sheets tabs auto-create themselves on first run

## How the flow works

### Login
Users pick their name and enter the shared password.

### Projects
Each user can save one project for the active demo date.

### Active demo-day presenters
If `Make me an active presenter for this demo day` is checked, the person appears in the presenter roster.

### Queue and presenter announcement
Admin can:
- randomize queue
- set a presenter live
- announce the presenter
- start a demo timer
- open/close voting
- advance to next presenter

The platform always shows:
- presenter name
- presenter project
- next presenter
- upcoming count

### Voting
Audience votes 1–5 stars.

Each person can only have one active vote per presenter.
If they vote again, the vote updates instead of duplicating.

### Feed
People can post updates and comments during the week.

## Customization

### Shared password
Edit in `config.js`:
```js
sharedPassword: "vibe123"
```

### Admin names
Edit in `config.js`:
```js
adminNames: ["Paul"]
```

### Team list
Edit in `config.js` and optionally in Apps Script `DEFAULT_TEAM`.

## Notes

- This is intentionally simple and trust-based.
- It is designed for internal team use, not enterprise security.
- Google Sheets remains the central data source.
- Vercel hosts the frontend and proxies API calls cleanly.
