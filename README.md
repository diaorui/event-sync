# EventSync

Automatically synchronize local [Luma](https://lu.ma) events to Google Calendar based on geographic location and event category.

---

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
  - [Google Cloud Setup](#google-cloud-setup)
  - [Google Apps Script Setup](#google-apps-script-setup)
  - [Frontend Configuration](#frontend-configuration)
- [Deployment](#deployment)
  - [Automated Deployment (CI/CD)](#automated-deployment-cicd)
  - [Manual Deployment](#manual-deployment)
- [Usage](#usage)
  - [End User Workflow](#end-user-workflow)
  - [Developer Workflow](#developer-workflow)
- [Scheduled Sync](#scheduled-sync)
- [Troubleshooting](#troubleshooting)
- [API Reference](#api-reference)
- [Security](#security)
- [Project Structure](#project-structure)

---

## Overview

EventSync enables users to:
- Select a geographic area using an interactive map
- Choose an event category (AI, Tech, Food, Arts, etc.)
- Automatically sync matching Luma events to a dedicated Google Calendar
- Receive updates via scheduled background synchronization

**Stack:** Static HTML (GitHub Pages) + Google Apps Script + Google Sheets + OAuth 2.0

---

## Prerequisites

### For End Users
- Google account
- Modern web browser

### For Developers/Self-Hosting
- Node.js 18+
- Google Cloud project
- Google Apps Script project
- Google Sheet for user database
- GitHub account (for Pages hosting)

---

## Installation

### 1. Clone Repository

```bash
git clone https://github.com/yourusername/event-sync.git
cd event-sync
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Install clasp (Google Apps Script CLI)

```bash
npm install -g @google/clasp
```

---

## Configuration

### Google Cloud Setup

#### 1. Create or Select Project

Visit [Google Cloud Console](https://console.cloud.google.com/) and create a new project or select an existing one.

#### 2. Enable Google Calendar API

- Navigate to **APIs & Services** → **Library**
- Search for "Google Calendar API"
- Click **Enable**

#### 3. Create OAuth 2.0 Credentials

- Go to **APIs & Services** → **Credentials**
- Click **Create Credentials** → **OAuth client ID**
- Application type: **Web application**
- Authorized redirect URIs: `https://yourusername.github.io`
- Save the **Client ID** and **Client Secret**

### Google Apps Script Setup

#### 1. Create Apps Script Project

Visit [script.google.com](https://script.google.com) and create a new project.

#### 2. Copy Source Files

Copy the contents of:
- `apps-script/Code.gs`
- `apps-script/Config.gs`
- `apps-script/appsscript.json`

Into your Apps Script project.

#### 3. Set Script Properties

In Apps Script Editor:
1. Click **Project Settings** (gear icon)
2. Scroll to **Script Properties**
3. Add the following properties:

| Property Name   | Value                          |
|-----------------|--------------------------------|
| `CLIENT_ID`     | Your OAuth Client ID           |
| `CLIENT_SECRET` | Your OAuth Client Secret       |
| `DB_SHEET_ID`   | Your Google Sheet ID (see below) |

#### 4. Create Database Sheet

1. Create a new Google Sheet
2. Rename the first tab to **"Users"**
3. Add header row:
   ```
   Timestamp | Email | RefreshToken | Config | CalendarID
   ```
4. Copy the Sheet ID from the URL:
   ```
   https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit
   ```
5. Add this ID to Script Properties as `DB_SHEET_ID`

#### 5. Get Script ID

- In Apps Script Editor, click **Project Settings**
- Copy the **Script ID** (needed for deployment)

### Frontend Configuration

Edit `docs/index.html` and update lines 87-89:

```javascript
const CLIENT_ID = 'your-client-id.apps.googleusercontent.com';
const GAS_URL = 'https://script.google.com/macros/s/.../exec';
const REDIRECT_URI = 'https://yourusername.github.io';
```

**Note:** `GAS_URL` will be auto-updated if using CI/CD deployment.

---

## Deployment

### Automated Deployment (CI/CD)

Automatically deploy to Google Apps Script on every push to `apps-script/` folder.

#### Initial Setup

**1. Login to clasp**

```bash
clasp login
```

This creates `~/.clasprc.json` with your Google OAuth credentials.

**2. Create `.clasp.json`**

Create `.clasp.json` in project root with your Script ID:

```json
{
  "scriptId": "YOUR_SCRIPT_ID",
  "rootDir": "./apps-script"
}
```

Replace `YOUR_SCRIPT_ID` with your actual Script ID from Apps Script **Project Settings**.

**3. Enable Apps Script API**

Visit https://script.google.com/home/usersettings and enable **Google Apps Script API**.

**4. Test Local Deployment**

```bash
clasp push
```

You should see:
```
└─ apps-script/Code.gs
└─ apps-script/Config.gs
└─ apps-script/appsscript.json
Pushed 3 files.
```

**5. Configure GitHub Secrets**

Go to your GitHub repo: **Settings** → **Secrets and variables** → **Actions**

Add two repository secrets:

**Secret 1: `CLASPRC_JSON`**
```bash
cat ~/.clasprc.json
# Copy entire output and paste as secret value
```

**Secret 2: `CLASP_JSON`**
```bash
cat .clasp.json
# Copy entire output and paste as secret value
```

Format should be:
```json
{"scriptId":"YOUR_SCRIPT_ID","rootDir":"./apps-script"}
```

**6. Deploy Frontend**

Push to GitHub and enable Pages:
- Go to **Settings** → **Pages**
- Source: **main branch / docs folder**
- Save

Your site will be live at: `https://yourusername.github.io/event-sync`

#### Using CI/CD

Push changes to `apps-script/` to trigger auto-deployment:

```bash
git add apps-script/
git commit -m "Update backend logic"
git push
```

**Workflow automatically:**
- Pushes code to Google Apps Script
- Creates versioned deployment (e.g., @10, @11)
- Updates `GAS_URL` in `docs/index.html`
- Commits updated HTML back to repo
- Deletes old deployments (keeps last 5)

**Monitor:** GitHub repo → **Actions** tab

### Manual Deployment

If not using CI/CD:

#### Backend

**Option 1: Using clasp**
```bash
npm run push      # Push to Apps Script
npm run deploy    # Create new deployment
```

**Option 2: Via UI**
1. Copy contents of `apps-script/*.gs`
2. Paste into Apps Script editor
3. Click **Deploy** → **New deployment**
4. Type: **Web app**
5. Execute as: **Me**
6. Who has access: **Anyone**
7. Click **Deploy**
8. Copy the deployment URL

#### Frontend

1. Update `GAS_URL` in `docs/index.html` with deployment URL
2. Commit and push to GitHub

---

## Usage

### End User Workflow

1. Visit the deployed site (e.g., `https://yourusername.github.io/event-sync`)
2. Select event category from dropdown
3. Pan and zoom the map to your desired area
4. Click **"Sync This Area"**
5. Authorize Google Calendar access
6. A new calendar will be created: "Luma Events (category)"
7. Events sync automatically every few hours

### Developer Workflow

#### With CI/CD
```bash
# Make changes to backend
vim apps-script/Code.gs

# Commit and push
git add apps-script/
git commit -m "Add new feature"
git push

# GitHub Actions handles deployment automatically
```

#### Local Development
```bash
# Push changes to Apps Script
npm run push

# View execution logs
npm run logs

# Open script in browser
npm run open
```

#### Available Commands

| Command           | Description                        |
|-------------------|------------------------------------|
| `npm run push`    | Push local files to Apps Script    |
| `npm run deploy`  | Create new deployment              |
| `npm run logs`    | View Apps Script execution logs    |
| `npm run open`    | Open script in browser             |

---

## Scheduled Sync

Enable automatic background sync:

1. Apps Script editor → **Triggers** (clock icon) → **Add Trigger**
2. Function: `syncAllUsers` | Event: **Time-driven** | Interval: **Every 4 hours**
3. **Save**

---

## Troubleshooting

### Backend Issues

**"Server configuration error"**
- Verify all Script Properties are set: `CLIENT_ID`, `CLIENT_SECRET`, `DB_SHEET_ID`
- Check values are correct (no extra spaces or quotes)

**"Invalid Category" error**
- Selected category must match one in `ALLOWED_SLUGS` (Code.gs:2)
- Current allowed values: tech, food, ai, arts, climate, fitness, wellness, crypto

**Calendar not syncing**
- Check Apps Script **Executions** log for errors
- Verify Google Calendar API is enabled
- Ensure trigger is set up for `syncAllUsers`
- Check user has not revoked OAuth permissions

**OAuth errors**
- Verify redirect URI in Google Cloud Console matches `REDIRECT_URI` in index.html
- Check Client ID/Secret are correct in Script Properties
- Ensure OAuth consent screen is configured

### CI/CD Issues

**Workflow fails**
- Verify secrets: `CLASPRC_JSON`, `CLASP_JSON` (GitHub Settings → Secrets)
- Enable Apps Script API: https://script.google.com/home/usersettings
- Ensure secrets are valid JSON (no extra quotes)

**"Could not find script"**
- Check Script ID in `CLASP_JSON` matches your project
- Test locally: `clasp open`

**Version mismatch / access_token error**
- Match clasp versions: `clasp --version` should be 3.x
- Regenerate: `clasp logout && clasp login`, update `CLASPRC_JSON` secret

**Workflow not triggering**
- Only triggers on `apps-script/**` changes
- Manual: **Actions** → **Run workflow**

### Frontend Issues

**Map not loading**
- Check browser console for errors
- Verify internet connection (uses OpenStreetMap tiles)

**Authorization popup blocked**
- Allow popups for your domain
- Try in different browser

---

## API Reference

### Backend Endpoint

**URL:** Deployed web app URL from Apps Script

**Method:** `POST`

**Request Body:**
```json
{
  "auth_code": "4/0AbC123...",
  "redirect_uri": "https://yourusername.github.io",
  "config": {
    "slug": "ai",
    "north": 37.9,
    "south": 37.6,
    "east": -122.1,
    "west": -122.5
  }
}
```

**Parameters:**

| Field                  | Type   | Description                              |
|------------------------|--------|------------------------------------------|
| `auth_code`            | string | OAuth authorization code                 |
| `redirect_uri`         | string | OAuth redirect URI                       |
| `config.slug`          | string | Event category (see ALLOWED_SLUGS)       |
| `config.north`         | number | Northern boundary (latitude)             |
| `config.south`         | number | Southern boundary (latitude)             |
| `config.east`          | number | Eastern boundary (longitude)             |
| `config.west`          | number | Western boundary (longitude)             |

**Success Response:**
```json
{
  "status": "success",
  "action": "created",
  "email": "user@example.com",
  "calendarName": "Luma Events (ai)"
}
```

| Field          | Description                          |
|----------------|--------------------------------------|
| `action`       | Either "created" or "updated"        |
| `email`        | User's email address                 |
| `calendarName` | Name of the synced calendar          |

**Error Response:**
```json
{
  "status": "error",
  "msg": "Error description"
}
```

### Allowed Event Categories

Defined in `Code.gs` line 2:
- `tech` - Technology events
- `food` - Food & Drink
- `ai` - AI & Machine Learning
- `arts` - Arts & Culture
- `climate` - Climate & Environment
- `fitness` - Fitness & Sports
- `wellness` - Health & Wellness
- `crypto` - Cryptocurrency & Web3

---

## Security

### Best Practices

- **Never commit secrets**: Config.gs uses Script Properties, not hardcoded values
- **OAuth scope**: Limited to `calendar.app.created` (only calendars created by this app)
- **Input validation**: Backend validates event category against whitelist
- **Concurrent access**: Uses LockService to prevent database race conditions
- **Credentials storage**: `.clasp.json` and `.clasprc.json` are gitignored

### Credential Files

**Never commit these files:**
- `.clasp.json` - Contains Script ID
- `~/.clasprc.json` - Contains OAuth tokens
- Both are in `.gitignore`

**If credentials are compromised:**

1. Revoke access: https://myaccount.google.com/permissions
2. Regenerate:
   ```bash
   clasp logout
   clasp login
   ```
3. Update GitHub Secrets with new `CLASPRC_JSON`
4. Rotate OAuth Client Secret in Google Cloud Console
5. Update Script Properties with new `CLIENT_SECRET`

### OAuth Permissions

The app requests:
- `https://www.googleapis.com/auth/calendar.app.created` - Manage calendars created by this app
- `openid` - User identification
- `email` - User email address

Users can revoke access anytime at: https://myaccount.google.com/permissions

---

## Project Structure

```
event-sync/
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions CI/CD workflow
├── apps-script/
│   ├── Code.gs                 # Backend logic (OAuth, sync, API)
│   ├── Config.gs               # Configuration (Script Properties)
│   └── appsscript.json         # Apps Script manifest
├── docs/
│   └── index.html              # Frontend (map, OAuth, UI)
├── scripts/
│   └── update-gas-url.js       # Auto-update deployment URL
├── .gitignore                  # Git ignore rules
├── package.json                # Node.js dependencies & scripts
└── README.md                   # This file
```

---

## License

MIT
