import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { API } from '../mocks/db';
import { stubLocation } from '../test/utils';
import {
  apiClient,
  apiCall,
  logout,
  addCompanyCodeToUrl,
  selectAdminCompanyContext,
} from './api';

const seedStorage = () => {
  localStorage.setItem('accessToken', 'abc123');
  localStorage.setItem('user', '{"id":1}');
  localStorage.setItem('companyCode', 'ACME');
};

/** Echo endpoint: returns the Authorization header the server received. */
const captureAuthHeader = () => {
  const seen = [];
  server.use(
    http.get(`${API}/api/echo`, ({ request }) => {
      seen.push(request.headers.get('Authorization'));
      return HttpResponse.json({ ok: true });
    }),
  );
  return seen;
};

let loc;
beforeEach(() => {
  loc = stubLocation();
});
afterEach(() => loc.restore());

describe('apiClient request interceptor', () => {
  it('attaches the stored token as a Bearer Authorization header', async () => {
    const seen = captureAuthHeader();
    localStorage.setItem('accessToken', 'abc123');

    await apiClient.get('/api/echo');

    expect(seen).toEqual(['Bearer abc123']);
  });

  it('sends no Authorization header when the user is not logged in', async () => {
    const seen = captureAuthHeader();

    await apiClient.get('/api/echo');

    expect(seen).toEqual([null]);
  });

  it('reads the token at request time, so a token set after login is used', async () => {
    const seen = captureAuthHeader();
    await apiClient.get('/api/echo');
    localStorage.setItem('accessToken', 'fresh');
    await apiClient.get('/api/echo');

    expect(seen).toEqual([null, 'Bearer fresh']);
  });
});

describe('apiClient response interceptor', () => {
  it('on 401 clears the session from storage and redirects to the login page', async () => {
    seedStorage();
    server.use(http.get(`${API}/api/cameras`, () => new HttpResponse(null, { status: 401 })));

    await expect(apiClient.get('/api/cameras')).rejects.toMatchObject({ response: { status: 401 } });

    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(localStorage.getItem('companyCode')).toBeNull();
    expect(loc.location.href).toBe('/');
  });

  it('on 500 rejects with the server error but keeps the session', async () => {
    seedStorage();
    server.use(
      http.get(`${API}/api/cameras`, () =>
        HttpResponse.json({ detail: 'DB down' }, { status: 500 })),
    );

    await expect(apiClient.get('/api/cameras')).rejects.toMatchObject({
      response: { status: 500, data: { detail: 'DB down' } },
    });

    expect(localStorage.getItem('accessToken')).toBe('abc123');
    expect(loc.location.href).not.toBe('/');
  });

  it('on a network error rejects without a response and keeps the session', async () => {
    seedStorage();
    server.use(http.get(`${API}/api/cameras`, () => HttpResponse.error()));

    const error = await apiClient.get('/api/cameras').catch((e) => e);

    expect(error.message).toMatch(/network error/i);
    expect(error.response).toBeUndefined();
    expect(localStorage.getItem('accessToken')).toBe('abc123');
  });
});

describe('apiCall (fetch based helper)', () => {
  it('returns parsed JSON and sends the Bearer token', async () => {
    const seen = captureAuthHeader();
    localStorage.setItem('accessToken', 'abc123');

    await expect(apiCall('/api/echo')).resolves.toEqual({ ok: true });
    expect(seen).toEqual(['Bearer abc123']);
  });

  it('throws the backend "detail" message for non-2xx responses', async () => {
    server.use(
      http.get(`${API}/api/thing`, () => HttpResponse.json({ detail: 'Camera not found' }, { status: 404 })),
    );

    await expect(apiCall('/api/thing')).rejects.toThrow('Camera not found');
  });

  it('falls back to a generic HTTP message when the error body is not JSON', async () => {
    server.use(http.get(`${API}/api/thing`, () => new HttpResponse('boom', { status: 502 })));

    await expect(apiCall('/api/thing')).rejects.toThrow(/HTTP Error: 502|Bad Gateway/);
  });

  it('on 401 throws "Session expired", clears the token and redirects', async () => {
    seedStorage();
    server.use(http.get(`${API}/api/thing`, () => new HttpResponse(null, { status: 401 })));

    await expect(apiCall('/api/thing')).rejects.toThrow('Session expired. Please login again.');
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(loc.location.href).toBe('/');
  });
});

describe('logout', () => {
  it('notifies the backend with the company code and clears local storage', async () => {
    seedStorage();
    let body;
    server.use(
      http.post(`${API}/api/auth/logout`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({});
      }),
    );

    await logout('ACME');

    expect(body).toEqual({ company_code: 'ACME' });
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(localStorage.getItem('companyCode')).toBeNull();
  });

  it('still clears local storage when the backend call fails', async () => {
    seedStorage();
    server.use(http.post(`${API}/api/auth/logout`, () => HttpResponse.json({}, { status: 500 })));

    await expect(logout('ACME')).resolves.toBeUndefined();
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
  });

  it('does not call the backend when there is no token', async () => {
    const called = vi.fn();
    server.use(http.post(`${API}/api/auth/logout`, () => { called(); return HttpResponse.json({}); }));

    await logout();

    expect(called).not.toHaveBeenCalled();
  });
});

describe('addCompanyCodeToUrl', () => {
  it.each([
    ['/api/violations', 'ACME', '/api/violations?company_code=ACME'],
    ['/api/violations?limit=5', 'ACME', '/api/violations?limit=5&company_code=ACME'],
    ['/api/violations', 'A&B Co', '/api/violations?company_code=A%26B%20Co'],
    ['/api/violations', null, '/api/violations'],
  ])('%s + %s -> %s', (endpoint, code, expected) => {
    expect(addCompanyCodeToUrl(endpoint, code)).toBe(expected);
  });
});

describe('selectAdminCompanyContext', () => {
  it('rejects without a company code and makes no request', async () => {
    await expect(selectAdminCompanyContext('')).rejects.toThrow('Company code is required');
  });

  it('posts to the URL-encoded select-company endpoint', async () => {
    let path;
    server.use(
      http.post(`${API}/api/auth/select-company/:code`, ({ request }) => {
        path = new URL(request.url).pathname;
        return HttpResponse.json({ ok: true });
      }),
    );

    await selectAdminCompanyContext('A/B');

    expect(path).toBe('/api/auth/select-company/A%2FB');
  });
});
