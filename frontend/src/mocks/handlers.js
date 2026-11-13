// MSW request handlers mirroring the real endpoints called by the frontend
// (axios apiClient, fetch-based apiCall and AuthContext).
import { http, HttpResponse } from 'msw';
import { API, db } from './db';

const tokenFrom = (request) => request.headers.get('Authorization')?.replace('Bearer ', '');

export const handlers = [
  // ---- Auth ----
  http.post(`${API}/api/auth/login`, async ({ request }) => {
    const { email, password, company_code } = await request.json();
    const user = db.users[email];
    if (!user || user.password !== password || (user.role === 'user' && user.company_code !== company_code)) {
      return HttpResponse.json({ detail: 'Invalid email, password or company code' }, { status: 401 });
    }
    db.validTokens.add(`token-${user.user_id}`);
    return HttpResponse.json({
      access_token: `token-${user.user_id}`,
      user_id: user.user_id,
      email,
      role: user.role,
      company_code: user.company_code,
    });
  }),

  http.get(`${API}/api/auth/me`, ({ request }) => {
    if (!db.validTokens.has(tokenFrom(request))) {
      return HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 });
    }
    return HttpResponse.json({ ok: true });
  }),

  http.post(`${API}/api/auth/logout`, () => HttpResponse.json({ message: 'Logged out' })),

  http.post(`${API}/api/auth/select-company/:code`, ({ params }) =>
    HttpResponse.json({ company_code: params.code })),

  http.get(`${API}/api/companies`, () => HttpResponse.json(db.companies)),

  // ---- Cameras ----
  http.get(`${API}/api/cameras`, ({ request }) => {
    const code = new URL(request.url).searchParams.get('company_code');
    return HttpResponse.json(code ? db.cameras.filter((c) => c.company_code === code) : db.cameras);
  }),

  http.post(`${API}/api/cameras`, async ({ request }) => {
    const body = await request.json();
    const camera = { id: db.nextCameraId++, status: 'offline', active_models: [], ...body };
    db.cameras.push(camera);
    return HttpResponse.json(camera, { status: 201 });
  }),

  http.delete(`${API}/api/cameras/:id`, ({ params }) => {
    db.cameras = db.cameras.filter((c) => c.id !== Number(params.id));
    return HttpResponse.json({ message: 'deleted' });
  }),

  http.get(`${API}/api/company/:code/model-cameras`, ({ request, params }) => {
    const modelId = new URL(request.url).searchParams.get('model_id');
    const cameras = db.cameras.filter((c) => c.company_code === params.code);
    if (!modelId) return HttpResponse.json(cameras);
    const links = db.modelCameras[modelId] || {};
    return HttpResponse.json(
      cameras.map((c) => ({
        ...c,
        model_is_active: c.id in links,
        priority: links[c.id],
      })),
    );
  }),

  http.put(`${API}/api/company/:code/model-cameras`, async ({ request }) => {
    const { model_id, camera_ids, camera_priorities } = await request.json();
    db.modelCameras[model_id] = Object.fromEntries(
      camera_ids.map((id) => [id, camera_priorities[String(id)] || 'medium']),
    );
    return HttpResponse.json({ ok: true });
  }),

  // ---- Models ----
  http.get(`${API}/api/general-models`, () => HttpResponse.json(db.generalModels)),

  http.get(`${API}/api/company/:code/general-models`, ({ params }) => {
    const ids = db.companyModels[params.code] || [];
    return HttpResponse.json(db.generalModels.filter((m) => ids.includes(m.id)));
  }),

  http.put(`${API}/api/company/:code/general-models`, async ({ request, params }) => {
    const { model_ids } = await request.json();
    db.companyModels[params.code] = model_ids;
    return HttpResponse.json({ ok: true });
  }),

  // ---- Violations ----
  http.get(`${API}/api/violations`, () => HttpResponse.json(db.violations)),

  http.patch(`${API}/api/violations/:id/status`, async ({ request, params }) => {
    const { review_status } = await request.json();
    const v = db.violations.find((x) => x.id === Number(params.id));
    if (!v) return HttpResponse.json({ detail: 'Not found' }, { status: 404 });
    v.review_status = review_status;
    return HttpResponse.json(v);
  }),

  // ---- Reports ----
  http.get(`${API}/api/company/:code/reports/active-types`, () =>
    HttpResponse.json({
      types: ['head', 'vest', 'fallen'],
      groups: [
        { label: 'PPE Model', types: ['head', 'vest'] },
        { label: 'Fall Detection Model', types: ['fallen'] },
      ],
    })),

  http.get(`${API}/api/company/:code/reports/data`, () =>
    HttpResponse.json({
      summary: { total: 0, by_type: {}, pending: 0 },
      violation_distribution: [],
      violations: [],
    })),

  http.get(`${API}/api/company/:code/reports/export/:format`, () =>
    new HttpResponse('id,type\n1,head\n', { headers: { 'Content-Type': 'text/csv' } })),

  http.post(`${API}/api/company/:code/reports/email-pdf`, () => HttpResponse.json({ sent: true })),
];
