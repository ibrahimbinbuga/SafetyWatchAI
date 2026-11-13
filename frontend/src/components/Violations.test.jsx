import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../mocks/server';
import { API, db } from '../mocks/db';
import { renderWithAuth } from '../test/utils';
import { Violations } from './Violations';

// Backend (Turkish) field names, exactly as /api/violations returns them.
const seedViolations = () => {
  db.violations = [
    { id: 1, violation_id: 7, ihlal_yapilan_bolge: 'Gate Cam', ihlal_cesidi: 'head', tarih_saat: '2026-11-01T10:00:00Z', review_status: null },
    { id: 2, violation_id: 8, ihlal_yapilan_bolge: 'Warehouse Cam', ihlal_cesidi: 'vest', tarih_saat: '2026-11-05T10:00:00Z', review_status: 'resolved' },
    { id: 3, violation_id: null, ihlal_yapilan_bolge: null, ihlal_cesidi: 'fallen', tarih_saat: '2026-11-10T10:00:00Z', review_status: 'pending' },
  ];
};

const renderViolations = async () => {
  const user = userEvent.setup();
  renderWithAuth(<Violations />, { role: 'user', companyCode: 'ACME' });
  await screen.findByText('Violation Records');
  await vi.waitFor(() => expect(screen.queryByText('Loading violations...')).not.toBeInTheDocument());
  return user;
};

const rowIds = () =>
  screen.queryAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent);

const rowById = (id) => screen.getByText(`#${id}`).closest('tr');

const stat = (label) => screen.getByText(label).parentElement.querySelector('h3').textContent;

const filter = (label) => screen.getByText(label, { selector: 'label' }).parentElement.querySelector('select, input');

beforeEach(seedViolations);

describe('Violations: list', () => {
  it('shows a loading indicator until the data arrives', async () => {
    server.use(http.get(`${API}/api/violations`, async () => { await delay(50); return HttpResponse.json([]); }));
    renderWithAuth(<Violations />, { role: 'user', companyCode: 'ACME' });

    expect(await screen.findByText('Loading violations...')).toBeInTheDocument();
    expect(await screen.findByText('No violations found matching the filters.')).toBeInTheDocument();
  });

  it('maps backend fields into rows, newest first, with readable labels', async () => {
    await renderViolations();

    expect(rowIds()).toEqual(['#3', '#2', '#1']);
    const first = rowById(1);
    expect(within(first).getByText('Worker #7')).toBeInTheDocument();
    expect(within(first).getByText('Gate Cam')).toBeInTheDocument();
    expect(within(first).getByText('No Helmet')).toBeInTheDocument();
    // review_status null defaults to "pending".
    expect(within(first).getByRole('button', { name: 'Pending' })).toBeInTheDocument();
    // Missing worker / camera are shown as placeholders.
    expect(within(rowById(3)).getByText('Worker #-')).toBeInTheDocument();
    expect(within(rowById(3)).getByText('Fall Detected')).toBeInTheDocument();
  });

  it('computes the summary cards from the data', async () => {
    await renderViolations();

    expect(stat('Total Violations')).toBe('3');
    expect(stat('PPE Violations')).toBe('2');
    expect(stat('Fall Detections')).toBe('1');
    expect(stat('Pending Review')).toBe('2');
  });

  it('shows the empty state when there are no violations', async () => {
    db.violations = [];
    await renderViolations();

    expect(screen.getByText('No violations found matching the filters.')).toBeInTheDocument();
    expect(stat('Total Violations')).toBe('0');
  });

  it('requests violations scoped to the active company', async () => {
    let url;
    server.use(http.get(`${API}/api/violations`, ({ request }) => { url = new URL(request.url); return HttpResponse.json([]); }));
    await renderViolations();

    expect(url.searchParams.get('company_code')).toBe('ACME');
  });
});

describe('Violations: filtering and sorting', () => {
  it('filters by violation type', async () => {
    const user = await renderViolations();

    await user.selectOptions(filter('Type'), 'fallen');

    expect(rowIds()).toEqual(['#3']);
  });

  it('filters by review status', async () => {
    const user = await renderViolations();

    await user.selectOptions(filter('Status'), 'resolved');

    expect(rowIds()).toEqual(['#2']);
  });

  it('filters by an inclusive date range', async () => {
    const user = await renderViolations();

    await user.type(filter('From Date'), '2026-11-02');
    await user.type(filter('To Date'), '2026-11-05');

    expect(rowIds()).toEqual(['#2']);
  });

  it('shows the empty message when no row matches the filters', async () => {
    const user = await renderViolations();

    await user.selectOptions(filter('Type'), 'head');
    await user.selectOptions(filter('Status'), 'resolved');

    expect(rowIds()).toEqual([]);
    expect(screen.getByText('No violations found matching the filters.')).toBeInTheDocument();
  });

  it('sorts oldest first on request and Reset restores the defaults', async () => {
    const user = await renderViolations();

    await user.selectOptions(filter('Sort By Date'), 'oldest');
    await user.selectOptions(filter('Type'), 'vest');
    expect(rowIds()).toEqual(['#2']);

    await user.click(screen.getByRole('button', { name: 'Reset' }));

    expect(rowIds()).toEqual(['#3', '#2', '#1']);
    expect(filter('Type')).toHaveValue('all');
  });
});

describe('Violations: status update', () => {
  it('updates the status optimistically and sends a PATCH', async () => {
    let request;
    server.use(
      http.patch(`${API}/api/violations/:id/status`, async ({ request: req, params }) => {
        request = { id: params.id, body: await req.json() };
        return HttpResponse.json({});
      }),
    );
    const user = await renderViolations();

    await user.click(within(rowById(1)).getByRole('button', { name: 'Pending' }));
    await user.click(within(rowById(1)).getByRole('button', { name: 'Resolved' }));

    expect(within(rowById(1)).getByRole('button', { name: 'Resolved' })).toBeInTheDocument();
    expect(stat('Pending Review')).toBe('1');
    await vi.waitFor(() => expect(request).toEqual({ id: '1', body: { review_status: 'resolved' } }));
  });

  it('rolls the status back when the backend rejects the update', async () => {
    server.use(
      http.patch(`${API}/api/violations/:id/status`, async () => {
        await delay(20);
        return HttpResponse.json({ detail: 'Forbidden' }, { status: 403 });
      }),
    );
    const user = await renderViolations();

    await user.click(within(rowById(1)).getByRole('button', { name: 'Pending' }));
    await user.click(within(rowById(1)).getByRole('button', { name: 'Reviewed' }));
    expect(within(rowById(1)).getByRole('button', { name: 'Reviewed' })).toBeInTheDocument();

    expect(await within(rowById(1)).findByRole('button', { name: 'Pending' })).toBeInTheDocument();
    expect(stat('Pending Review')).toBe('2');
  });
});

it('asks an admin to select a company first', async () => {
  renderWithAuth(<Violations />, { role: 'admin', companyCode: 'ADMIN' });

  expect(await screen.findByText(/Please select a company/)).toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
