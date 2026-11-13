# SafetyWatch AI

[![CI](https://github.com/ibrahimbinbuga/SafetyWatchAI/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ibrahimbinbuga/SafetyWatchAI/actions/workflows/ci.yml)

Workplace safety monitoring with computer vision. SafetyWatch watches camera streams with YOLO
models and spots **missing helmets, missing safety vests and worker falls**. Each violation is
saved and shown to safety staff in real time. The web dashboard is where they review violations
and export reports.

## Features

- **Live detection.** Webcam or RTSP cameras are processed with Ultralytics YOLO. You can watch
  each camera as an MJPEG stream in the browser.
- **PPE and fall detection.** It detects *no helmet*, *no vest* and *fall detected*. Each
  model/camera pair has a priority (critical, high, medium, low) that controls how often it runs
  detection.
- **Multi-company.** Each company has its own cameras, models, users and violations. A system
  admin can pick any company from the sidebar.
- **Model management.** Admins upload YOLO weights, assign models to companies and choose which
  cameras each model runs on.
- **Violation review.** Each violation moves through `pending → reviewed → resolved`. You can
  filter by type, status and date.
- **Reports.** The dashboard shows charts and trends. You can download reports as PDF (built in
  the browser), CSV or Excel, send a PDF by e-mail, or schedule e-mail reports.
- **Real-time alerts.** New violations reach the web dashboard over WebSocket, and mobile devices
  through Firebase Cloud Messaging push notifications.
- **Roles.** Admins and regular users see different pages, and the API is protected with JWT.

## Tech stack

| Layer | Technologies |
|---|---|
| Backend | FastAPI, SQLAlchemy (async) + asyncpg, PostgreSQL 15, JWT (python-jose), APScheduler |
| Computer vision | Ultralytics YOLO, OpenCV (headless) |
| Notifications | WebSocket, Firebase Admin SDK (FCM), SMTP |
| Frontend | React 19, Vite 7, Tailwind CSS, Recharts, Axios, jsPDF |
| Testing | Vitest, React Testing Library, MSW (see [TESTING.md](TESTING.md)) |
| Infra | Docker, Docker Compose (PostgreSQL + pgAdmin) |

## Project structure

```
SafetyWatchAI/
├── backend/
│   ├── main.py               # FastAPI app, routers, WebSocket, startup/shutdown
│   ├── routes/               # auth, users, cameras, detections, models, reports, notifications, devices
│   ├── services/             # camera, model, violation, notification, report generation/scheduling
│   ├── camera_runner.py      # per-camera capture + YOLO inference loop
│   ├── models.py             # SQLAlchemy models
│   ├── database.py           # async DB session
│   └── init_db.py            # creates tables and seed data
├── frontend/
│   └── src/
│       ├── components/       # Dashboard, Cameras, Violations, Reporting, ModelManagement, ...
│       ├── context/          # AuthContext, AppearanceContext
│       ├── hooks/            # useViolationSocket (real-time alerts)
│       └── utils/api.js      # Axios client with auth interceptors
├── fall_model/weights/       # fall detection weights
├── docker-compose.yml        # PostgreSQL + pgAdmin
└── Dockerfile                # backend image
```

## Getting started

### Requirements

- Python 3.11+
- Node.js 20+
- Docker (for PostgreSQL)

### 1. Start the database

```bash
docker compose up -d
```

PostgreSQL runs on `localhost:5432` (`admin` / `password123`, database `safety_analysis_db`).
pgAdmin runs on http://localhost:5050.

### 2. Configure the backend

Create `backend/.env`:

```env
DB_USER=admin
DB_PASSWORD=password123
DB_HOST=localhost
DB_PORT=5432
DB_NAME=safety_analysis_db

SECRET_KEY=change-me-to-a-long-random-string
```

Optional variables:

| Variable | Purpose |
|---|---|
| `MODEL_PATH` | PPE model weights (default `model/weights/best.pt`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | E-mail reports |
| `FIREBASE_SERVICE_ACCOUNT_PATH` or `FIREBASE_SERVICE_ACCOUNT_JSON` | Mobile push notifications |

> The PPE model weights are not stored in the repository. Put them at `model/weights/best.pt`
> (relative to the project root) or point `MODEL_PATH` to them. The fall model is already in
> `fall_model/weights/best.pt`.

### 3. Run the backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
python init_db.py               # creates tables and seed data
uvicorn main:app --reload
```

The API runs on http://localhost:8000. The interactive API docs are at http://localhost:8000/docs.

### 4. Run the frontend

```bash
cd frontend
npm install
echo "VITE_API_URL=http://localhost:8000" > .env
npm run dev
```

Open http://localhost:5173.

### Default login

`init_db.py` creates a system admin account:

| Company code | E-mail | Password |
|---|---|---|
| `ADMIN` | `admin@system.com` | `admin123` |

Change these credentials before you deploy anywhere.

## Running with Docker

The `Dockerfile` builds only the backend image. The build needs the PPE weights at
`model/weights/best.pt`.

```bash
docker build -t safetywatch-backend .
docker run -p 8000:8000 --env-file backend/.env -e DB_HOST=host.docker.internal safetywatch-backend
```

Inside the container, `localhost` means the container itself. That's why `DB_HOST` points to the
host machine, where Docker Compose runs PostgreSQL.

## Testing

```bash
cd frontend
npm run test            # run the test suite
npm run test:coverage   # with coverage report
```

The frontend tests cover auth and role-based access, the Axios interceptors, camera and
violation CRUD, the dashboard and report export. They mock every HTTP call with MSW, so they need
no backend. [TESTING.md](TESTING.md) lists what is covered and the known bugs the tests document.

## More documentation

- [SETUP.md](SETUP.md): detailed setup guide in Turkish, with troubleshooting
- [MODEL_MANAGEMENT_GUIDE.md](MODEL_MANAGEMENT_GUIDE.md): how models are uploaded, assigned and activated
- [TESTING.md](TESTING.md): test strategy and coverage
