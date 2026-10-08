# Secure Notes – Frontend

Client for the Secure Notes API — Care Guide BD backend interview task.
Plain HTML + CSS + vanilla JavaScript: no framework, no template, no build step.

- Live site: https://care.tahmid-hasan-rafi.com
- Live API: https://care-api.tahmid-hasan-rafi.com/api
- Backend repository: `https://github.com/TahmidHasanRafi/careguide-notes-backend`

Features: register / log in (JWT), my notes (create, edit, delete, paginated), public posts,
a user's posts (`$lookup` aggregation), interest groups (aggregation), profile, an admin area
(users, staff with permissions, optional IP whitelist, switch accounts off/on, everyone's notes),
a permission-limited staff panel, a "How it works" page listing the indexes, and an **API log**
panel showing every request sent to the backend. All user content is rendered as text, never as HTML.

## Run locally

**Easiest:** clone this repository next to the backend repository and run the backend
(`npm install`, `npm run seed:demo`, `npm run dev` in `careguide-notes-backend`).
The backend serves this folder at http://localhost:5050.

**On its own:** `npx serve -l 5500 .` — on localhost it calls `http://localhost:5050/api`
(already allowed in the backend's CORS settings).

## Deploy (Vercel)

`config.js` points to the live API (`https://care-api.tahmid-hasan-rafi.com/api`) when not on localhost.

Import the repository in Vercel — framework preset *Other*, no build command, no environment variables —
then add the domain under Settings → Domains.
