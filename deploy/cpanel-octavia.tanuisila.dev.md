# cPanel install: `octavia.tanuisila.dev`

Deploy Octavia (FastAPI + React) on a subdomain of **tanuisila.dev**.

Target URL: **https://octavia.tanuisila.dev**

---

## 0. What you need on the host

- cPanel with **Subdomains**, **MySQL Databases**, and **Setup Python App** (Passenger)
- Python **3.11 or 3.12** (prefer 3.12)
- Node.js available either:
  - on your PC (build locally, upload `frontend/dist`), or
  - via cPanel **Setup Node.js App** / SSH `npm`

---

## 1. Create the subdomain

1. cPanel → **Domains** / **Subdomains**
2. Subdomain: `octavia`
3. Domain: `tanuisila.dev`
4. Document root (example):  
   `/home/YOURUSER/octavia.tanuisila.dev`  
   (note the exact path cPanel shows)
5. Save, then wait for DNS (usually automatic on the same cPanel account)

Optional: enable **Force HTTPS** for the subdomain (SSL / AutoSSL).

---

## 2. Create MySQL database + user

1. cPanel → **MySQL® Databases**
2. Create database, e.g. `YOURUSER_octavia`
3. Create user, e.g. `YOURUSER_octavia` with a strong password
4. Add user to database with **ALL PRIVILEGES**
5. Note the full names (cPanel often prefixes `YOURUSER_`)

Host is almost always `localhost`.

---

## 3. Upload the code

From GitHub (after this repo is pushed):

**Option A – Git Version Control (cPanel)**  
Clone into the subdomain root:

```text
https://github.com/silatanui/octavia.git
```

**Option B – SSH**

```bash
cd ~/octavia.tanuisila.dev
git clone https://github.com/silatanui/octavia.git .
```

**Option C – ZIP**  
Download the repo ZIP from GitHub and extract into the subdomain document root so you see:

```text
octavia.tanuisila.dev/
  backend/
  frontend/
  sql/
  README.md
  deploy/
```

Do **not** upload `backend/.venv`, `frontend/node_modules`, or `desktop/`.

---

## 4. Backend `.env`

Create `backend/.env` (copy from `backend/.env.example`):

```env
DATABASE_URL=mysql+pymysql://YOURUSER_octavia:YOUR_DB_PASSWORD@localhost:3306/YOURUSER_octavia
SECRET_KEY=change-me-to-a-long-random-string
DEMO_MODE=true
FACTORY_TIMEZONE=Africa/Nairobi
CORS_ORIGINS=https://octavia.tanuisila.dev
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
```

Replace DB user, password, and database name with the cPanel values.

---

## 5. Setup Python App (Passenger)

1. cPanel → **Setup Python App** → **Create Application**
2. Settings:
   - **Python version:** 3.12 (or 3.11)
   - **Application root:** `octavia.tanuisila.dev/backend`  
     (path relative to home, or absolute under the subdomain)
   - **Application URL:** `octavia.tanuisila.dev` (leave path empty `/`)
   - **Application startup file:** `passenger_wsgi.py`
   - **Application Entry point:** `application`
3. Create the app, then **Enter** the virtualenv it prints (or use the “Run pip install” UI)

Install dependencies:

```bash
cd ~/octavia.tanuisila.dev/backend
source ~/virtualenv/octavia.tanuisila.dev/backend/3.12/bin/activate
# exact virtualenv path is shown in Setup Python App
pip install -r requirements.txt
```

Seed demo data once:

```bash
cd ~/octavia.tanuisila.dev/backend
python seed.py
```

Restart the Python app from cPanel (**Stop → Start** or **Restart**).

Health check: `https://octavia.tanuisila.dev/health`

---

## 6. Build and attach the frontend

On your PC (recommended):

```bash
cd frontend
npm install
npm run build
```

Upload the contents of `frontend/dist` to the server as:

```text
~/octavia.tanuisila.dev/frontend/dist/
  index.html
  assets/
```

The API automatically serves that folder when present (same host as `/api`).

If the UI does not appear, set in `backend/.env` or the Python App environment:

```env
OCTAVIA_STATIC_DIR=/home/YOURUSER/octavia.tanuisila.dev/frontend/dist
```

Then restart the Python app.

---

## 7. Document root / `.htaccess` note

Passenger should own the subdomain URL. If Apache still serves a blank `public_html` folder instead of Python:

1. Confirm **Application URL** is exactly `octavia.tanuisila.dev/`
2. In Setup Python App, open the generated config and ensure the subdomain docroot is the app root (or the parent that Passenger expects)
3. Avoid putting a competing `index.html` in the docroot that bypasses Passenger

If your host requires the app under a subfolder, keep the SPA and API on the same origin so the frontend can keep using `/api`.

---

## 8. Demo logins (after `seed.py`)

| Role | Email | Password |
|------|-------|----------|
| Administrator | admin@octavia.local | admin123 |
| Production Manager | manager@octavia.local | manager123 |
| Supervisor | supervisor@octavia.local | super123 |

Change passwords for any non-demo use.

---

## 9. Updates later

```bash
cd ~/octavia.tanuisila.dev
git pull
cd backend
source ~/virtualenv/.../bin/activate
pip install -r requirements.txt
# rebuild/upload frontend/dist if UI changed
# Restart Python App in cPanel
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| 503 / Passenger error | Check Python App error log; confirm `passenger_wsgi.py` and `a2wsgi` installed |
| `/health` works, UI blank | Upload `frontend/dist` or set `OCTAVIA_STATIC_DIR` |
| API DB errors | Fix `DATABASE_URL` user/password/db name; grant privileges |
| CORS errors | Set `CORS_ORIGINS=https://octavia.tanuisila.dev` and restart |
| Seed fails | Confirm MySQL is reachable as `localhost` from the Python app |
