import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { API } from '../mocks/db';
import { AuthProvider } from '../context/AuthContext';
import LoginPage from './LoginPage';

const setup = async () => {
  const onLoginSuccess = vi.fn();
  const loginRequests = [];
  server.events.on('request:start', ({ request }) => {
    if (request.url.endsWith('/api/auth/login')) loginRequests.push(request);
  });
  const user = userEvent.setup();
  render(
    <AuthProvider>
      <LoginPage onLoginSuccess={onLoginSuccess} />
    </AuthProvider>,
  );
  // Wait for the initial session check to finish (inputs are disabled while loading).
  await screen.findByRole('button', { name: 'Login' });

  const fill = async ({ company = 'ACME', email = 'user@acme.com', password = 'secret' } = {}) => {
    if (company) await user.type(screen.getByLabelText('Company Code'), company);
    if (email) await user.type(screen.getByLabelText('Email'), email);
    if (password) await user.type(screen.getByLabelText('Password'), password);
  };
  const submit = () => user.click(screen.getByRole('button', { name: 'Login' }));

  return { onLoginSuccess, loginRequests, fill, submit };
};

afterEach(() => server.events.removeAllListeners());

describe('LoginPage', () => {
  it('requires all fields and does not call the API when one is missing', async () => {
    const { fill, submit, loginRequests, onLoginSuccess } = await setup();

    await fill({ company: '' });
    await submit();

    expect(screen.getByText(/All fields are required/)).toBeInTheDocument();
    expect(loginRequests).toHaveLength(0);
    expect(onLoginSuccess).not.toHaveBeenCalled();
  });

  it('rejects a malformed e-mail address before calling the API', async () => {
    const { fill, submit, loginRequests } = await setup();

    // type="email" inputs would block native submit; the component validates itself.
    await fill({ email: 'user@acme' });
    await submit();

    expect(screen.getByText(/Please enter a valid email address/)).toBeInTheDocument();
    expect(loginRequests).toHaveLength(0);
  });

  it('clears the validation error as soon as the user edits a field', async () => {
    const { fill, submit } = await setup();
    await submit();
    expect(screen.getByText(/All fields are required/)).toBeInTheDocument();

    await fill({ email: '', password: '' });

    expect(screen.queryByText(/All fields are required/)).not.toBeInTheDocument();
  });

  it('logs in with valid credentials and calls onLoginSuccess', async () => {
    const { fill, submit, onLoginSuccess } = await setup();

    await fill();
    await submit();

    await vi.waitFor(() => expect(onLoginSuccess).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem('accessToken')).toBe('token-2');
  });

  it('shows an error and stays on the page when the credentials are wrong', async () => {
    const { fill, submit, onLoginSuccess } = await setup();

    await fill({ password: 'wrong' });
    await submit();

    expect(await screen.findByText(/⚠️/)).toBeInTheDocument();
    expect(onLoginSuccess).not.toHaveBeenCalled();
    expect(localStorage.getItem('accessToken')).toBeNull();
  });

  it('disables the form while the login request is in flight', async () => {
    let release;
    server.use(
      http.post(`${API}/api/auth/login`, async () => {
        await new Promise((r) => { release = r; });
        return HttpResponse.json({ detail: 'x' }, { status: 401 });
      }),
    );
    const { fill, submit } = await setup();
    await fill();

    const pending = submit();
    const button = await screen.findByRole('button', { name: 'Logging in...' });
    expect(button).toBeDisabled();
    expect(screen.getByLabelText('Email')).toBeDisabled();

    release();
    await pending;
    expect(await screen.findByRole('button', { name: 'Login' })).toBeEnabled();
  });

  // BUG (LoginPage.jsx:53 + :107): `error` is read from a stale closure (always null on the
  // first failure), so localError is set to the generic text and, because localError wins
  // in `localError || error`, the backend's message is never shown. Remove `.fails` once fixed.
  it.fails('shows the backend error message on failed login (known bug)', async () => {
    const { fill, submit } = await setup();

    await fill({ password: 'wrong' });
    await submit();

    expect(await screen.findByText(/Invalid email, password or company code/)).toBeInTheDocument();
  });
});
