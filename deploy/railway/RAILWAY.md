# Deploy Trove on Railway (trial)

Connect your **GitHub repo** → Railway builds the Dockerfile → you get a public URL.

> Railway free **trial / credits** run out. Not forever free. Good for a demo link.

---

## 1. Push latest code to GitHub

```bash
cd /home/zen/Desktop/behavior_analysis
git add -A
git status
git commit -m "Add Railway Dockerfile deploy"
git push origin main
```

(Use SSH if that already works.)

---

## 2. Sign up on Railway

1. Open **[https://railway.app](https://railway.app)**
2. **Login with GitHub** (BirukOverRide)
3. Authorize Railway to see your repos

They may ask for a card for the free trial — same capitalism tax. Trial credit is usually enough for a demo.

---

## 3. New project from GitHub

1. **New Project**
2. **Deploy from GitHub repo**
3. Pick **`trove-behavior-lab`**
4. Railway should detect the **Dockerfile** (see `railway.toml`)

If it asks for settings manually:

| Setting | Value |
|---------|--------|
| Builder | Dockerfile |
| Dockerfile path | `Dockerfile` |

---

## 4. Variables (optional)

In the service → **Variables**:

```
HOST=0.0.0.0
NODE_ENV=production
AUTO_TRAIN=0
PYTHON=python3
```

- `PORT` — Railway sets this automatically (our server reads `process.env.PORT`)
- `XAI_API_KEY` — only if you want Trove Chat online
- Leave `AUTO_TRAIN=0` on trial so Python train doesn’t burn all credit

---

## 5. Public URL

1. Service → **Settings** → **Networking** → **Generate Domain**
2. Wait for deploy to go **Success**
3. Open: `https://YOUR-APP.up.railway.app`
4. Admin: `https://YOUR-APP.up.railway.app/admin`  
   - `admin@trove.shop` / `admin123`

---

## 6. What works on trial

| Feature | Notes |
|---------|--------|
| Shop UI + API | Yes |
| Admin console | Yes |
| Create / run a few bots | Yes (keep batches small) |
| Auto full-fleet train | Off by default (`AUTO_TRAIN=0`) |
| Manual Tiny AI train | Possible but heavy — may be slow / expensive on credits |
| Data after restart | SQLite is on disk; **without a volume**, redeploys can wipe DB |

Optional: add a **Volume** mounted at `/app/server/db/data` so the DB survives restarts.

---

## Redeploy

Every `git push` to `main` triggers a new deploy (if auto-deploy is on).

---

## If deploy fails

| Error | Fix |
|-------|-----|
| Build OOM / killed | In Railway, try larger plan or smaller build; Dockerfile already multi-stage-ish |
| `better-sqlite3` | Dockerfile installs build tools — rebuild |
| Healthcheck fail | Personas route needs admin? Wait — actually personas is adminRequired. Healthcheck may 401! |

Healthcheck note: `/api/admin/bots/personas` needs admin token → may fail healthcheck.  
If deploy loops, remove healthcheck in Railway UI or use a public path.
