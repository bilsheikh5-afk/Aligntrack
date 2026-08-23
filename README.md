# AlignTrack AI

Clear aligner practice management dashboard — case list, status tracking,
login, and Gemini-powered wear coaching notes + fit-check photo analysis.

## What's inside
- `server/index.js` — Express API (auth, case CRUD, Gemini text + vision calls)
- `server/db.js` — Postgres connection + schema + one-time demo data seed
- `server/auth.js` — invite-code registration, login, session-based auth
- `public/` — vanilla JS frontend (no build step, no framework)
- `data/cases.seed.json` — demo cases loaded into Postgres on first boot only

## Run locally
1. Have a local Postgres running (or use a free one from Render/Supabase/Neon).
2. `cp .env.example .env` and fill in `DATABASE_URL`, `GEMINI_API_KEY`, `SESSION_SECRET`.
3. `npm install`
4. `npm start`
5. Open http://localhost:10000 — register using the invite code printed in
   your terminal logs on first boot (defaults to `WELCOME2026`, or whatever
   you set `SEED_INVITE_CODE` to).

## Deploy to Render (~5 minutes)
1. Push this folder to a new GitHub repo.
2. In Render: **New +** → **Blueprint** → connect the repo.
   `render.yaml` provisions BOTH the web service and a free Postgres database,
   and wires `DATABASE_URL` between them automatically.
3. Get a free Gemini API key at https://aistudio.google.com/apikey and add it
   as `GEMINI_API_KEY` in the web service's Environment tab (this one field is
   the only thing `render.yaml` can't set for you, since it's a secret).
4. Deploy. You'll get a live URL like `https://aligntrack-ai.onrender.com`.
5. Open it, click "Register with invite code", and use the code from
   `SEED_INVITE_CODE` (defaults to `WELCOME2026`) to create your first admin
   account.

## How login works
- Accounts are created only via invite code — there's no open signup, matching
  how you described AlignerTracker's dentist onboarding.
- One admin-role invite code is auto-created on first boot. To invite more
  people, insert a row into `invite_codes` directly (via Render's Postgres
  dashboard → Shell, or any Postgres client):
  ```sql
  INSERT INTO invite_codes (code, role) VALUES ('YOUR-CODE-HERE', 'dentist');
  ```
- Passwords are hashed with bcrypt. Sessions are stored in Postgres itself
  (via `connect-pg-simple`), so logins survive server restarts.

## Database persistence
Unlike the earlier JSON-file version, this uses real Postgres — data survives
redeploys and restarts. Render's free Postgres tier expires after 90 days
unless upgraded; for anything beyond a demo, plan to upgrade the database plan
or point `DATABASE_URL` at your own long-term Postgres instance.

## Swapping in your real ClearPro Lab data
Replace the queries in `server/index.js` (`SELECT * FROM cases...`) with calls
into your existing Convex deployment instead — the frontend and auth layer
don't need to change either way.
