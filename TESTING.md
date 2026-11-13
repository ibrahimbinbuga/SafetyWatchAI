# Testing

## Web (frontend)

Stack: **Vitest** + **jsdom** + **React Testing Library** + **user-event** + **MSW**.

```bash
cd frontend
npm install
npm run test            # run once
npm run test:watch      # watch mode
npm run test:coverage   # coverage report (text + frontend/coverage/index.html)
```

### How it works

- **No real network.** Every HTTP call (axios `apiClient`, `fetch`-based `apiCall`, `AuthContext`)
  is answered by MSW (`src/mocks/handlers.js`). The handlers mirror the real backend endpoints
  and work on an in-memory fake DB (`src/mocks/db.js`) that is reset after each test.
  `onUnhandledRequest: 'error'` makes any un-mocked request fail the test.
- **Real providers.** Components are rendered inside the real `AuthProvider`. A session is
  seeded into `localStorage` and validated against the mocked `/api/auth/me`, the same way the
  app restores a session (`src/test/utils.jsx`).
- **Per-test overrides.** Error paths use `server.use(...)` to return 4xx/5xx or network errors.
- **jsPDF / jspdf-autotable are mocked.** The tests check what gets drawn (texts, table rows),
  not the PDF bytes.
- jsdom runs on `http://localhost:8000` (same origin as the API) so axios' XHR does not apply
  CORS to mocked responses.

### What is covered

| Area | File | Behaviour verified |
|---|---|---|
| Axios interceptors and API helpers | `src/utils/api.test.js` | Bearer header added or omitted; 401 clears the session and redirects to `/`; 500 and network errors reject without logging out; `apiCall` error messages; `logout` always clears storage; URL helpers |
| Auth state | `src/context/AuthContext.test.jsx` | Login success and failure, what gets stored, user vs admin company handling, session restore (valid, expired, corrupt), logout even when the API fails |
| Login form | `src/components/LoginPage.test.jsx` | Validation blocks the request, errors clear on edit, success callback, form disabled while the request is in flight |
| Auth guard and roles | `src/App.test.jsx` | Login page when there is no or an invalid session, full login and logout flow, user vs admin navigation, admin company selection unlocks company pages |
| Cameras CRUD | `src/components/Cameras.test.jsx` | List, live stream URL, empty state, create (validation, payload, server error), delete (confirm, cancel, server error) |
| Model–camera assignment | `src/components/ModelCameraAssignment.test.jsx` | Read-only user view, admin model save payload, camera selection and priority save payload, failure keeps the saved state |
| Violations | `src/components/Violations.test.jsx` | Loading, empty and data states, field mapping, stats, type, status and date filters, sort and reset, optimistic status update with rollback |
| Dashboard | `src/components/Dashboard.test.jsx` | Loading placeholders, stats, system-status thresholds, empty state, recent-5 list, error fallback |
| Report export | `src/components/Reporting.test.jsx` | Report query string, CSV and Excel download URL and filename, export error, PDF content and table rows (200-row cap), e-mail PDF upload |

### Known bugs documented by tests

Tests marked `it.fails(...)` describe the **correct** behaviour of a known bug. They pass while
the bug exists. Once the bug is fixed, Vitest reports them as failing, which is the reminder to
remove `.fails`.

- `AuthContext.jsx:62-64`: with an expired token, `loading` never becomes `false`, so the app
  stays on "Restoring session..." forever.
- `LoginPage.jsx:53`: the backend error message is never shown (stale `error` closure).
- `Cameras.jsx:298`: a camera with `status: null` crashes the page.

### Not covered yet

`Models.jsx`, `ModelManagement.jsx`, `Settings.jsx`, `Companies.jsx`, `LiveCameraFeed.jsx` and
`useViolationSocket.js` (WebSocket).

## Mobile (Flutter)

The Flutter app is not part of this repository, so there are no mobile tests here yet.
