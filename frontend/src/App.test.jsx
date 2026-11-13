import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server';
import { API } from './mocks/db';
import { seedSession } from './test/utils';
import App from './App';

// The WebSocket notification hook is out of scope here; keep it inert.
vi.mock('./hooks/useViolationSocket', () => ({
  useViolationSocket: () => ({ notifications: [], dismiss: vi.fn() }),
}));

const nav = () => screen.getByRole('navigation');
const navItem = (name) => within(nav()).queryByRole('button', { name });

const renderApp = async () => {
  const user = userEvent.setup();
  render(<App />);
  await vi.waitFor(() => expect(screen.queryByText('Restoring session...')).not.toBeInTheDocument());
  return user;
};

describe('App: authentication guard', () => {
  it('shows the login page instead of the app when there is no session', async () => {
    await renderApp();

    expect(screen.getByRole('button', { name: 'Login' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('shows the login page when the stored token is no longer valid', async () => {
    seedSession({ token: 'revoked' });
    render(<App />);

    // Storage is cleared because /auth/me rejected the token...
    await vi.waitFor(() => expect(localStorage.getItem('accessToken')).toBeNull());
    // ...and no protected content is ever shown.
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('logs in through the form and lands on the dashboard', async () => {
    const user = await renderApp();

    await user.type(screen.getByLabelText('Company Code'), 'ACME');
    await user.type(screen.getByLabelText('Email'), 'user@acme.com');
    await user.type(screen.getByLabelText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Login' }));

    expect(await screen.findByText('Violations — Last 7 Days')).toBeInTheDocument();
    expect(navItem('Cameras')).toBeInTheDocument();
  });

  it('logout from the user menu returns to the login page and clears the session', async () => {
    seedSession({ role: 'user' });
    const user = await renderApp();

    // The avatar button that opens the account menu sits next to the role label.
    const avatarButton = screen.getByText(/👤 User/).parentElement.nextElementSibling;
    await user.click(avatarButton);
    await user.click(screen.getByRole('button', { name: 'Logout' }));

    expect(await screen.findByRole('button', { name: 'Login' })).toBeInTheDocument();
    expect(localStorage.getItem('accessToken')).toBeNull();
  });
});

describe('App: role based access', () => {
  it('a regular user sees company pages and Settings but no admin section', async () => {
    seedSession({ role: 'user', companyCode: 'ACME' });
    await renderApp();

    ['Dashboard', 'Cameras', 'Violations', 'Reporting', 'Model Camera Assignment', 'Settings'].forEach((name) =>
      expect(navItem(name)).toBeInTheDocument());
    expect(screen.queryByText('Admin Management')).not.toBeInTheDocument();
    expect(navItem('Companies')).not.toBeInTheDocument();
    expect(navItem('General Model Management')).not.toBeInTheDocument();
  });

  it('an admin without a selected company sees admin tools but not company pages', async () => {
    seedSession({ role: 'admin', companyCode: 'ADMIN' });
    await renderApp();

    expect(screen.getByText('Admin Management')).toBeInTheDocument();
    expect(navItem('Companies')).toBeInTheDocument();
    expect(navItem('General Model Management')).toBeInTheDocument();
    ['Cameras', 'Violations', 'Reporting'].forEach((name) => expect(navItem(name)).not.toBeInTheDocument());
    expect(screen.getByText(/Please select a company from the sidebar/)).toBeInTheDocument();
  });

  it('the admin company list hides system companies and selecting one unlocks company pages', async () => {
    seedSession({ role: 'admin', companyCode: 'ADMIN' });
    let selected;
    server.use(
      http.post(`${API}/api/auth/select-company/:code`, ({ params }) => {
        selected = params.code;
        return HttpResponse.json({});
      }),
    );
    const user = await renderApp();

    const select = screen.getByLabelText('Select Company:');
    await within(select).findByRole('option', { name: 'Beta Mining (BETA)' });
    expect(within(select).queryByRole('option', { name: /ADMIN/ })).not.toBeInTheDocument();

    await user.selectOptions(select, 'BETA');
    await user.click(screen.getByRole('button', { name: 'Select' }));

    expect(await screen.findByRole('button', { name: 'Cameras' }, { timeout: 2000 })).toBeInTheDocument();
    expect(selected).toBe('BETA');
    expect(localStorage.getItem('activeCompanyCode')).toBe('BETA');
  });

  it('an admin with a selected company can open a company page', async () => {
    seedSession({ role: 'admin', companyCode: 'ADMIN', activeCompanyCode: 'ACME' });
    const user = await renderApp();

    await user.click(navItem('Cameras'));

    expect(await screen.findByText('Gate Cam')).toBeInTheDocument();
  });
});
