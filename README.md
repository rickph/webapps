# 🏀 PH Hoops — League Management System
Philippines Basketball Stats & League Manager — Barangay to Regional level.

## Quick Start

```bash
npm install
cp .env.example .env
# Edit .env and set your DATABASE_URL
npm start
```

Demo login: `demo@phhoops.com` / `demo1234`

## PostgreSQL Setup

### Option A — Supabase (Free, recommended for starters)
1. Go to https://supabase.com → New Project
2. Copy the connection string from Settings → Database
3. Paste into `.env` as `DATABASE_URL`

### Option B — Railway
1. Go to https://railway.app → New Project → PostgreSQL
2. Click the DB → Variables → copy `DATABASE_URL`

### Option C — Local
```bash
createdb phhoops
# Set DATABASE_URL=postgresql://postgres:password@localhost:5432/phhoops
```

Schema and demo data are created automatically on first run.

## Deploy

### Railway (easiest)
1. Push to GitHub
2. railway.app → New Project → Deploy from GitHub
3. Add PostgreSQL plugin → it auto-sets DATABASE_URL
4. Set SESSION_SECRET and JWT_SECRET in Variables

### Render
1. Push to GitHub → render.com → New Web Service
2. Add PostgreSQL database → copy internal URL to env vars

### VPS (Ubuntu)
```bash
npm install -g pm2
pm2 start src/app.js --name phhoops
pm2 save && pm2 startup
# Point Nginx → localhost:3000
```

## Structure
```
src/
├── app.js                  ← Express server, boots DB
├── db/database.js          ← PostgreSQL pool, schema, seed
├── middleware/auth.js      ← JWT, session, plan checks
└── routes/
    ├── auth.js             ← Login / Register / Logout
    ├── public.js           ← Landing + public league view
    ├── admin.js            ← Admin panel + REST API
    └── upgrade.js          ← Pro plan (add PayMongo here)
public/css/main.css         ← Dark theme stylesheet
```

## Plans
| Feature           | Free | Pro ₱199/mo |
|------------------|------|-------------|
| Leagues           | 1    | Unlimited   |
| Teams / Players   | 10/30| Unlimited   |
| PDF Stat Reports  | ✗    | ✓           |
| Bracket Generator | ✗    | ✓           |
| Live Scoring      | ✓    | ✓           |

## Adding Payments Later
See the `TODO` comments in `src/routes/upgrade.js` for PayMongo integration steps.
