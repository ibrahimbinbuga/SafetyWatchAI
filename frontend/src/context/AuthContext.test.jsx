import { renderHook, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { API } from '../mocks/db';
import { seedSession } from '../test/utils';
import { AuthProvider, useAuth } from './AuthContext';

const renderAuth = async () => {
  const hook = renderHook(() => useAuth(), { wrapper: AuthProvider });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
};

describe('AuthContext login', () => {
  it('stores token, user and company for a regular user and selects their company', async () => {
    const { result } = await renderAuth();

    let ok;
    await act(async () => {
      ok = await result.current.login('user@acme.com', 'secret', 'ACME');
    });

    expect(ok).toBe(true);
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.activeCompanyCode).toBe('ACME');
    expect(localStorage.getItem('accessToken')).toBe('token-2');
    expect(JSON.parse(localStorage.getItem('user'))).toEqual({ id: 2, email: 'user@acme.com', role: 'user' });
    expect(localStorage.getItem('companyCode')).toBe('ACME');
    expect(localStorage.getItem('activeCompanyCode')).toBe('ACME');
  });

  it('logs an admin in without an active company (admin must pick one)', async () => {
    const { result } = await renderAuth();

    await act(async () => {
      await result.current.login('admin@sw.com', 'adminpass', 'ADMIN');
    });

    expect(result.current.isAdmin).toBe(true);
    expect(result.current.activeCompanyCode).toBeNull();
    expect(localStorage.getItem('activeCompanyCode')).toBeNull();
  });

  it('on wrong credentials returns false, exposes the backend error and stores nothing', async () => {
    const { result } = await renderAuth();

    let ok;
    await act(async () => {
      ok = await result.current.login('user@acme.com', 'wrong', 'ACME');
    });

    expect(ok).toBe(false);
    expect(result.current.error).toBe('Invalid email, password or company code');
    expect(result.current.isAuthenticated).toBe(false);
    expect(localStorage.getItem('accessToken')).toBeNull();
  });

  it('sends the company code in the login payload', async () => {
    let body;
    server.use(
      http.post(`${API}/api/auth/login`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ detail: 'nope' }, { status: 401 });
      }),
    );
    const { result } = await renderAuth();

    await act(async () => {
      await result.current.login('a@b.co', 'pw', 'ACME');
    });

    expect(body).toEqual({ email: 'a@b.co', password: 'pw', company_code: 'ACME' });
  });
});

describe('AuthContext session restore', () => {
  it('restores a stored session when /auth/me accepts the token', async () => {
    seedSession({ role: 'user', companyCode: 'ACME' });

    const { result } = await renderAuth();

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user.role).toBe('user');
    expect(result.current.activeCompanyCode).toBe('ACME');
  });

  it('restores the admin\'s last selected company after a refresh', async () => {
    seedSession({ role: 'admin', companyCode: 'ADMIN', activeCompanyCode: 'BETA' });

    const { result } = await renderAuth();

    expect(result.current.isAdmin).toBe(true);
    expect(result.current.activeCompanyCode).toBe('BETA');
  });

  it('clears storage when the stored token is rejected by the backend', async () => {
    seedSession({ token: 'expired-token' });

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    await waitFor(() => expect(localStorage.getItem('accessToken')).toBeNull());
    expect(localStorage.getItem('user')).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  // BUG (AuthContext.jsx:62-64): the early `return` skips setLoading(false), so with an
  // expired token the app stays on the "Restoring session..." spinner forever instead of
  // showing the login page. Remove `.fails` once fixed.
  it.fails('finishes loading after rejecting an expired token (known bug)', async () => {
    seedSession({ token: 'expired-token' });

    await renderAuth();
  });

  it('clears storage when the stored user JSON is corrupt', async () => {
    seedSession();
    localStorage.setItem('user', '{not json');

    const { result } = await renderAuth();

    expect(result.current.isAuthenticated).toBe(false);
    expect(localStorage.getItem('accessToken')).toBeNull();
  });
});

describe('AuthContext logout', () => {
  it('clears state and storage even if the backend logout fails', async () => {
    seedSession({ role: 'admin', companyCode: 'ADMIN', activeCompanyCode: 'ACME' });
    server.use(http.post(`${API}/api/auth/logout`, () => HttpResponse.error()));
    const { result } = await renderAuth();
    expect(result.current.isAuthenticated).toBe(true);

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.activeCompanyCode).toBeNull();
    ['accessToken', 'user', 'companyCode', 'activeCompanyCode'].forEach((key) =>
      expect(localStorage.getItem(key)).toBeNull());
  });
});

it('useAuth throws a helpful error outside of AuthProvider', () => {
  expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used within AuthProvider');
});
