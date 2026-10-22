# Stopwatch

A personal task time tracker with start, pause, resume, stop, edit, delete, categories, category totals, and daily, weekly, and monthly history. The interface works on desktop and phone screens.

## Stack

- Next.js 16 and React for the website and API routes
- PostgreSQL for persistent tasks, categories, intervals, day settings, and resets
- Netlify for hosting the site and its API functions

The browser calls `/api` on the same origin. The older FastAPI implementation remains in `backend/` as a reference and for its tests; Netlify uses the Next.js API in `frontend/src/server/`. Both implementations use the same PostgreSQL tables, so pointing Netlify at the existing database preserves your data. Missing tables and columns are added when the API first connects.

## Deploy on Netlify

1. Push this repository to GitHub. In Netlify, choose **Add new project → Import an existing project** and select the repository. The root `netlify.toml` sets the `frontend` base directory, build command, and publish directory.
2. In **Site configuration → Environment variables**, add `DATABASE_URL`, `APP_PASSWORD`, and `APP_SESSION_SECRET`. Use the same PostgreSQL URL as the current deployment, including TLS settings. Choose a long password and a separate random session secret. Keep these as server-side variables; do not prefix them with `NEXT_PUBLIC_`. Netlify functions cannot read secrets declared only in `netlify.toml`.
3. Deploy the site, open its `netlify.app` URL on your phone, sign in, and check that your existing tasks and history appear. Add a new task and stop it to verify writes. Keep the PostgreSQL database running; the site and its data live in different places.
4. Once the Netlify site works, disable the old Render service and remove the GitHub Actions `RENDER_HEALTH_URL` variable. The old keep-awake workflow is only useful while Render is still in use.

The site requires a password and session secret in production. Authentication uses an HttpOnly, Secure, SameSite cookie. Netlify runs API routes as functions, so its website has no Render-style 15-minute web-service sleep; an individual function or the database can still have a cold start. Netlify's free plan has usage limits, so check its dashboard if requests stop working.

## Local development

1. Copy `frontend/.env.example` to `frontend/.env.local` and fill in a PostgreSQL URL, password, and session secret. For local development only, you may omit both `APP_PASSWORD` and `APP_SESSION_SECRET` to skip sign-in.
2. Run:

   ```sh
   cd frontend
   npm ci
   npm run dev
   ```

Open `http://localhost:3000`. The API includes `http://localhost:3000/api/auth/session`. The old FastAPI service does not need to run for the Netlify version.

## Data and migrations

Active intervals are saved when a task is paused or stopped, so daily, weekly, and monthly views can split time across the configured day hours. The default is a full day from midnight to midnight. An end time earlier than the start time makes an overnight window, labeled by its start date. Time outside the chosen hours is excluded from day, week, and month totals; task timers still show their full elapsed time.

Day hours are saved with an effective tracking date. By default, new hours start on the next tracking day, leaving today's and earlier totals on their existing hours. Selecting **Today** applies them to the current tracking day; earlier days still use their saved hours. If a change makes two adjacent day windows overlap, the shared time belongs to the earlier day. Existing settings become the historical baseline when the first dated change is saved. Reset Today hides time before the reset from totals and starts counting again immediately, without altering task timers. Older tasks have no interval history; their previously recorded time is assigned to the day containing the task's start time. Edited completed time is assigned to the stop date, with subtractions taken from the latest day first.

## Checks

```sh
(cd frontend && npm ci && npm test && npm run lint && npm run typecheck && npm run build)
backend/.venv/bin/python -m unittest discover -s backend/tests -v
```
