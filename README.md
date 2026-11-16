# Octavia Daily Production MVP

Manufacturing production monitoring platform for daily output, machine status, downtime, quality and OEE.

## Stack

- **Frontend:** React + TypeScript + Vite + Recharts
- **Backend:** FastAPI + SQLAlchemy
- **Database:** MySQL / MariaDB (XAMPP)

## Quick start (Windows + XAMPP)

### 1. Database

1. Start **Apache** and **MySQL** in XAMPP.
2. Create the database:

```bash
C:\xampp\mysql\bin\mysql.exe -u root -e "CREATE DATABASE IF NOT EXISTS octavia_production CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

### 2. Backend

Use **Python 3.12** (3.14 may lack binary wheels for some packages):

```bash
cd C:\xampp\htdocs\Octavia\backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
copy .env.example .env
.\.venv\Scripts\python.exe seed.py
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

API docs: http://127.0.0.1:8000/docs

### 3. Frontend

```bash
cd C:\xampp\htdocs\Octavia\frontend
npm install
npm run dev
```

App: http://localhost:5173

### Demo login

| Role | Email | Password |
|------|-------|----------|
| Administrator | admin@octavia.local | admin123 |
| Production Manager | manager@octavia.local | manager123 |
| Supervisor | supervisor@octavia.local | super123 |
| Operator | operator@octavia.local | operator123 |
| Maintenance | maintenance@octavia.local | maint123 |

The UI shows a **demonstration data** banner when seeded/simulated records are in use.

## Staffing (web)

Open **Staffing** in the sidebar (`/staffing`) to assign people to a date + shift:

- **Section / team lead** → production line
- **Operator / junior / relief** → specific machine

Supervisors and managers can edit; operators can view. If the DB already exists, create the table once:

```bash
C:\xampp\mysql\bin\mysql.exe -u root octavia_production < sql\staff_assignments.sql
cd backend
.\.venv\Scripts\python.exe -c "from seed import seed_staff_assignments_demo; from app.core.database import SessionLocal; db=SessionLocal(); seed_staff_assignments_demo(db); db.close()"
```

## KPI formulas

- **Achievement** = actual / planned × 100
- **Availability** = operating time / planned production time × 100
- **Performance** = (ideal cycle time × total units) / operating time × 100
- **Quality** = good units / total units × 100
- **OEE** = Availability × Performance × Quality (decimals)

## Production build (optional Apache static)

```bash
cd frontend
npm run build
```

Serve `frontend/dist` from Apache (or open via Vite preview). Keep the FastAPI process running for API access.

### cPanel subdomain (`octavia.tanuisila.dev`)

Step-by-step for Phusion Passenger + MySQL:

→ [`deploy/cpanel-octavia.tanuisila.dev.md`](deploy/cpanel-octavia.tanuisila.dev.md)

## Windows desktop installer (.exe)

Creates an installable **Octavia Production** app (Electron + bundled API):

```powershell
cd C:\xampp\htdocs\Octavia
.\scripts\build-windows-installer.ps1
```

Outputs in `desktop\release\`:

| File | Use |
|------|-----|
| `Octavia-1.0.0-x64.exe` | **NSIS installer** (choose folder, Start Menu + Desktop shortcuts) |
| `Octavia-Portable-1.0.0-x64.exe` | Portable single-file exe (no install) |

After install / launch:
1. Start **XAMPP MySQL** (database `octavia_production` must exist; run `backend\seed.py` once if needed).
2. Open **Octavia Production**.
3. Optional: edit `%APPDATA%\Octavia Production\.env` for DB credentials.

Dev run of the desktop shell (after a resource build, or with backend venv present):

```powershell
cd desktop
npm install
npm start
```

## Project layout

```
Octavia/
  backend/     FastAPI app + seed script
  frontend/    React SPA
  sql/         Database helpers
```
