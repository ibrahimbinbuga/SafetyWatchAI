import { screen } from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../mocks/server';
import { API, db } from '../mocks/db';
import { renderWithAuth } from '../test/utils';
import { AppearanceProvider } from '../context/AppearanceContext';
import { Dashboard } from './Dashboard';

const violation = (id, type, status = null) => ({
  id,
  ihlal_cesidi: type,
  ihlal_yapilan_bolge: 'Gate Cam',
  tarih_saat: new Date().toISOString(),
  review_status: status,
});

const renderDashboard = async () => {
  renderWithAuth(
    <AppearanceProvider>
      <Dashboard />
    </AppearanceProvider>,
    { role: 'user', companyCode: 'ACME' },
  );
  await screen.findByText('Recent Violations');
  await vi.waitFor(() => expect(screen.queryAllByText('Loading...')).toHaveLength(0));
};

/** Value shown on a stats card (the h3 next to its title). */
const card = (title) => screen.getByText(title, { selector: 'p' }).parentElement;
const cardValue = (title) => card(title).querySelector('h3').textContent;

/** Label + status badge of a "System Status" row. */
const service = (name) => {
  const row = screen.getByText(name).closest('.flex.items-start.justify-between');
  return { label: row.querySelector('.text-xs').textContent, status: row.querySelector('span').textContent };
};

describe('Dashboard', () => {
  it('shows placeholders while loading', async () => {
    server.use(http.get(`${API}/api/violations`, async () => { await delay(50); return HttpResponse.json([]); }));
    renderWithAuth(<AppearanceProvider><Dashboard /></AppearanceProvider>, { role: 'user', companyCode: 'ACME' });

    await screen.findByText('Recent Violations');
    expect(cardValue('Total Violations')).toBe('—');
    expect(screen.getAllByText('Loading...').length).toBeGreaterThan(0);

    await vi.waitFor(() => expect(cardValue('Total Violations')).toBe('0'));
  });

  it('computes the stats cards from cameras and violations', async () => {
    db.violations = [
      violation(1, 'head'),
      violation(2, 'vest', 'resolved'),
      violation(3, 'fallen', 'pending'),
      violation(4, 'head', 'reviewed'),
    ];
    await renderDashboard();

    expect(cardValue('Active Cameras')).toBe('2');
    expect(card('Active Cameras')).toHaveTextContent('1 online');
    expect(cardValue('Total Violations')).toBe('4');
    expect(card('Total Violations')).toHaveTextContent('2 pending review');
    expect(cardValue('PPE Violations')).toBe('3');
    expect(cardValue('Fall Detections')).toBe('1');
  });

  it('derives the system status from real data', async () => {
    db.violations = Array.from({ length: 6 }, (_, i) => violation(i + 1, 'head'));
    await renderDashboard();

    expect(service('Camera Network')).toEqual({ label: '1/2 online', status: 'warning' });
    // More than 5 pending reviews escalates to "error".
    expect(service('Violation Review')).toEqual({ label: '6 pending', status: 'error' });
    expect(service('Detection Activity').label).toBe('6 total recorded');
  });

  it('reports a healthy system when every camera is online and nothing is pending', async () => {
    db.cameras = db.cameras.map((c) => ({ ...c, status: 'online' }));
    db.violations = [violation(1, 'head', 'resolved')];
    await renderDashboard();

    expect(service('Camera Network')).toEqual({ label: '2/2 online', status: 'online' });
    expect(service('Violation Review')).toEqual({ label: 'All reviewed', status: 'online' });
  });

  it('shows empty states when there is no data', async () => {
    db.cameras = [];
    await renderDashboard();

    expect(screen.getByText('No violations recorded yet.')).toBeInTheDocument();
    expect(service('Camera Network')).toEqual({ label: 'No cameras', status: 'warning' });
    expect(service('Detection Activity').label).toBe('No violations yet');
  });

  it('lists at most the 5 most recent violations', async () => {
    db.violations = [
      violation(1, 'head'), violation(2, 'vest'), violation(3, 'fallen'),
      violation(4, 'head'), violation(5, 'vest'), violation(6, 'sitting'),
    ];
    await renderDashboard();

    const recent = screen.getByText('Recent Violations').closest('.rounded-xl');
    expect(recent.querySelectorAll('.divide-y > div')).toHaveLength(5);
    expect(recent).not.toHaveTextContent('Sitting');
  });

  it('scopes both requests to the active company', async () => {
    const urls = [];
    server.events.on('request:start', ({ request }) => urls.push(new URL(request.url)));
    await renderDashboard();
    server.events.removeAllListeners();

    const scoped = urls.filter((u) => ['/api/cameras', '/api/violations'].includes(u.pathname));
    expect(scoped).toHaveLength(2);
    scoped.forEach((u) => expect(u.searchParams.get('company_code')).toBe('ACME'));
  });

  it('falls back to zeroed stats when the backend fails', async () => {
    server.use(http.get(`${API}/api/violations`, () => HttpResponse.json({}, { status: 500 })));
    await renderDashboard();

    expect(cardValue('Total Violations')).toBe('0');
    expect(cardValue('Active Cameras')).toBe('0');
  });
});
