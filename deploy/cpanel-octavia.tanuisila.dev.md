# cPanel install: `octavia.tanuisila.dev`

Deploy Octavia (FastAPI + React) on a subdomain of **tanuisila.dev**.

| | |
|---|---|
| **URL** | https://octavia.tanuisila.dev |
| **cPanel user** | `ipusgkqs` |
| **Home** | `/home/ipusgkqs` |
| **Docroot** | `/home/ipusgkqs/octavia.tanuisila.dev` |

---

## 0. What you need on the host

- cPanel with **Subdomains**, **MySQL Databases**, and **Setup Python App** (Passenger)
- Python **3.11 or 3.12** (prefer 3.12)
- Node.js on your PC to build the frontend (or cPanel Node if available)

---

## 1. Create the subdomain

1. cPanel → **Domains** / **Subdomains**
2. Subdomain: `octavia`
3. Domain: `tanuisila.dev`
4. Document root: `/home/ipusgkqs/octavia.tanuisila.dev`
5. Save, then enable **Force HTTPS** / AutoSSL for the subdomain

---

## 2. Create MySQL database + user

1. cPanel → **MySQL® Databases**
2. Create database: `ipusgkqs_octavia`
3. Create user: `ipusgkqs_octavia` with a strong password
4. Add user → database with **ALL PRIVILEGES**
5. Host: `localhost`

(If cPanel shortens names, use the exact names it shows.)

---

## 3. Upload the code

**SSH (preferred):**

```bash
cd /home/ipusgkqs/octavia.tanuisila.dev
git clone https://github.com/silatanui/octavia.git .
```

Or cPanel **Git Version Control** → clone `https://github.com/silatanui/octavia.git` into that folder.

Or upload/extract the GitHub ZIP so the folder contains `backend/`, `frontend/`, `sql/`, `deploy/`.

Do **not** upload `backend/.venv`, `frontend/node_modules`, or `desktop/`.

---

## 4. Backend `.env`

Create `/home/ipusgkqs/octavia.tanuisila.dev/backend/.env`:

```env
DATABASE_URL=mysql+pymysql://ipusgkqs_octavia:YOUR_DB_PASSWORD@localhost:3306/ipusgkqs_octavia
SECRET_KEY=change-me-to-a-long-random-string
DEMO_MODE=true
FACTORY_TIMEZONE=Africa/Nairobi
CORS_ORIGINS=https://octavia.tanuisila.dev
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
OCTAVIA_STATIC_DIR=/home/ipusgkqs/octavia.tanuisila.dev/frontend/dist
```

Replace `YOUR_DB_PASSWORD` with the MySQL password from step 2.

---

## 5. Setup Python App (Passenger)

1. cPanel → **Setup Python App** → **Create Application**
2. Settings:
   - **Python version:** 3.12 (or 3.11)
   - **Application root:** `octavia.tanuisila.dev/backend`
   - **Application URL:** `octavia.tanuisila.dev` (path `/`)
   - **Application startup file:** `passenger_wsgi.py`
   - **Application Entry point:** `application`
3. Create the app, then install deps (use the virtualenv path cPanel prints):

```bash
cd /home/ipusgkqs/octavia.tanuisila.dev/backend
source /home/ipusgkqs/virtualenv/octavia.tanuisila.dev/backend/3.12/bin/activate
pip install -r requirements.txt
python seed.py
```

Restart the Python app in cPanel.

Health check: https://octavia.tanuisila.dev/health

---

## 6. Build and attach the frontend

On your PC:

```bash
cd C:\xampp\htdocs\Octavia\frontend
npm install
npm run build
```

Upload `frontend/dist` (the folder with `index.html` + `assets/`) to:

```text
/home/ipusgkqs/octavia.tanuisila.dev/frontend/dist/
```

Restart the Python app again if the UI was missing.

---

## 7. Demo logins (after `seed.py`)

| Role | Email | Password |
|------|-------|----------|
| Administrator | admin@octavia.local | admin123 |
| Production Manager | manager@octavia.local | manager123 |
| Supervisor | supervisor@octavia.local | super123 |

---

## 8. Updates later

```bash
cd /home/ipusgkqs/octavia.tanuisila.dev
git pull
cd backend
source /home/ipusgkqs/virtualenv/octavia.tanuisila.dev/backend/3.12/bin/activate
pip install -r requirements.txt
# rebuild/upload frontend/dist if UI changed
# Restart Python App in cPanel
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| 503 / Passenger error | Python App error log; confirm `a2wsgi` installed |
| `/health` OK, UI blank | Upload `frontend/dist` or check `OCTAVIA_STATIC_DIR` |
| API DB errors | Fix `DATABASE_URL` names/password; grant privileges |
| CORS errors | `CORS_ORIGINS=https://octavia.tanuisila.dev` + restart |
