import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { API } from '../mocks/db';
import { renderWithAuth } from '../test/utils';
import { apiClient } from '../utils/api';
import { Reporting } from './Reporting';

// ---- jsPDF / autoTable mocks: we verify what is drawn, not the PDF bytes ----
const pdf = vi.hoisted(() => ({ instances: [], options: [] }));

vi.mock('jspdf', () => {
  function jsPDF(options) {
    pdf.options.push(options);
    const doc = {
      internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 }, getNumberOfPages: () => 2 },
      lastAutoTable: { finalY: 100 },
      setFillColor: vi.fn(), setDrawColor: vi.fn(), setTextColor: vi.fn(),
      setFontSize: vi.fn(), setFont: vi.fn(), rect: vi.fn(), roundedRect: vi.fn(),
      text: vi.fn(), setPage: vi.fn(),
      output: vi.fn(() => new Blob(['%PDF-mock'], { type: 'application/pdf' })),
    };
    pdf.instances.push(doc);
    return doc;
  }
  return { default: jsPDF };
});
vi.mock('jspdf-autotable', () => ({ default: vi.fn() }));

import autoTable from 'jspdf-autotable';

const REPORT = {
  summary: { total: 3, by_type: { head: 2, fallen: 1 }, pending: 1, reviewed: 1, resolved: 1 },
  violation_distribution: [
    { name: 'No Helmet', type: 'head', value: 2 },
    { name: 'Fall Detected', type: 'fallen', value: 1 },
  ],
  daily_data: [],
  camera_data: [],
  violations: [
    { id: 11, type: 'head', type_label: 'No Helmet', model: 'PPE Detector', camera_label: 'Gate Cam', datetime: '2026-11-01T10:00:00Z', review_status: 'resolved' },
    { id: 12, type: 'fallen', type_label: null, model: null, camera_label: null, datetime: null, review_status: null },
  ],
};

const today = new Date().toISOString().split('T')[0];

let downloads;
beforeEach(() => {
  pdf.instances.length = 0;
  pdf.options.length = 0;
  downloads = [];
  // Capture "file downloads" instead of letting jsdom navigate.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
    downloads.push({ filename: this.download, href: this.href });
  });
  server.use(http.get(`${API}/api/company/:code/reports/data`, () => HttpResponse.json(REPORT)));
});

const renderReporting = async () => {
  const user = userEvent.setup();
  renderWithAuth(<Reporting />, { role: 'user', companyCode: 'ACME' });
  await screen.findByRole('button', { name: /Generate Report/ });
  return user;
};

const generate = async (user) => {
  await user.click(screen.getByRole('button', { name: /Generate Report/ }));
  await screen.findByRole('button', { name: /Download PDF/ });
};

describe('Reporting: report data', () => {
  it('requests the report with the selected period, types and statuses', async () => {
    let url;
    server.use(
      http.get(`${API}/api/company/:code/reports/data`, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json(REPORT);
      }),
    );
    const user = await renderReporting();

    await user.click(screen.getByRole('button', { name: 'Last 30 days' }));
    await user.click(screen.getByRole('button', { name: /All Types/ }));
    await user.click(screen.getByRole('checkbox', { name: 'No Helmet' }));
    await user.click(screen.getByRole('button', { name: /All Statuses/ }));
    await user.click(screen.getByRole('checkbox', { name: 'Resolved' }));
    await generate(user);

    expect(url.pathname).toBe('/api/company/ACME/reports/data');
    expect(url.searchParams.get('to_date')).toBe(today);
    const days = (new Date(today) - new Date(url.searchParams.get('from_date'))) / 86_400_000;
    expect(days).toBe(30);
    expect(url.searchParams.getAll('violation_types')).toEqual(['head']);
    expect(url.searchParams.getAll('review_statuses')).toEqual(['resolved']);
  });

  it('shows the backend error when the report cannot be generated', async () => {
    server.use(
      http.get(`${API}/api/company/:code/reports/data`, () =>
        HttpResponse.json({ detail: 'Date range too large' }, { status: 422 })),
    );
    const user = await renderReporting();

    await user.click(screen.getByRole('button', { name: /Generate Report/ }));

    expect(await screen.findByText('Date range too large')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download PDF/ })).not.toBeInTheDocument();
  });
});

describe('Reporting: CSV / Excel export', () => {
  it.each([
    ['CSV', 'csv', 'csv'],
    ['Excel', 'excel', 'xlsx'],
  ])('downloads %s from the backend with the current filters', async (label, format, ext) => {
    let url;
    server.use(
      http.get(`${API}/api/company/:code/reports/export/:format`, ({ request }) => {
        url = new URL(request.url);
        return new HttpResponse('id,type\n11,head\n');
      }),
    );
    const user = await renderReporting();
    await generate(user);

    await user.click(screen.getByRole('button', { name: `Download ${label}` }));

    await vi.waitFor(() => expect(downloads).toHaveLength(1));
    expect(url.pathname).toBe(`/api/company/ACME/reports/export/${format}`);
    expect(url.searchParams.get('to_date')).toBe(today);
    expect(downloads[0].filename).toBe(`violations_ACME_${today}.${ext}`);
    expect(screen.getByRole('button', { name: `Download ${label}` })).toBeEnabled();
  });

  it('alerts when the export request fails', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    server.use(
      http.get(`${API}/api/company/:code/reports/export/:format`, () => new HttpResponse(null, { status: 500 })),
    );
    const user = await renderReporting();
    await generate(user);

    await user.click(screen.getByRole('button', { name: 'Download CSV' }));

    await vi.waitFor(() => expect(alert).toHaveBeenCalledWith('Failed to export CSV'));
    expect(downloads).toHaveLength(0);
  });
});

describe('Reporting: PDF export', () => {
  it('builds an A4 PDF from the report data and downloads it', async () => {
    const user = await renderReporting();
    await generate(user);

    await user.click(screen.getByRole('button', { name: /Download PDF/ }));

    await vi.waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0].filename).toBe(`violations_ACME_${today}.pdf`);
    expect(pdf.options).toEqual([{ orientation: 'portrait', unit: 'mm', format: 'a4' }]);

    const doc = pdf.instances[0];
    const texts = doc.text.mock.calls.map(([t]) => t);
    expect(texts).toContain('Safety Violations Report');
    expect(texts.some((t) => t.startsWith('Company: ACME'))).toBe(true);
    // Summary cards: total, no helmet, no vest, fall, pending.
    expect(texts).toEqual(expect.arrayContaining(['3', '2', '0', '1']));
    // Footer on every page.
    expect(texts).toContain('SafetyWatch - Confidential   |   Page 2 of 2');
  });

  it('passes the distribution and violation rows to autoTable', async () => {
    const user = await renderReporting();
    await generate(user);

    await user.click(screen.getByRole('button', { name: /Download PDF/ }));
    await vi.waitFor(() => expect(autoTable).toHaveBeenCalledTimes(2));

    const [distribution, details] = autoTable.mock.calls.map(([, opts]) => opts);
    expect(distribution.head).toEqual([['Violation Type', 'Count', 'Percentage']]);
    expect(distribution.body).toEqual([
      ['No Helmet', '2', '66.7%'],
      ['Fall Detected', '1', '33.3%'],
    ]);
    expect(details.head).toEqual([['ID', 'Type', 'Model', 'Camera', 'Date & Time', 'Status']]);
    expect(details.body[0]).toEqual([
      '11', 'No Helmet', 'PPE Detector', 'Gate Cam',
      new Date('2026-11-01T10:00:00Z').toLocaleString('tr-TR'), 'Resolved',
    ]);
    // Missing fields fall back to the raw type, "-" and "Pending".
    expect(details.body[1]).toEqual(['12', 'fallen', '-', '-', '-', 'Pending']);
  });

  it('caps the detail table at 200 rows', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ ...REPORT.violations[0], id: i + 1 }));
    server.use(
      http.get(`${API}/api/company/:code/reports/data`, () => HttpResponse.json({ ...REPORT, violations: many })),
    );
    const user = await renderReporting();
    await generate(user);

    await user.click(screen.getByRole('button', { name: /Download PDF/ }));
    await vi.waitFor(() => expect(autoTable).toHaveBeenCalledTimes(2));

    expect(autoTable.mock.calls[1][1].body).toHaveLength(200);
  });
});

describe('Reporting: e-mail PDF', () => {
  it('requires a recipient address', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const user = await renderReporting();
    await generate(user);

    await user.click(screen.getByRole('button', { name: /Send PDF to E-mail/ }));

    expect(alert).toHaveBeenCalledWith('Please enter an e-mail address');
    expect(pdf.instances).toHaveLength(0);
  });

  it('uploads the generated PDF with the recipient and confirms success', async () => {
    // jsdom's XHR cannot hand multipart bodies to MSW intact, so the outgoing call is
    // inspected at the axios boundary instead (nothing reaches the network either way).
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { sent: true } });
    const user = await renderReporting();
    await generate(user);

    await user.type(screen.getByPlaceholderText('name@example.com'), '  boss@acme.com ');
    await user.click(screen.getByRole('button', { name: /Send PDF to E-mail/ }));

    expect(await screen.findByText('Report sent successfully')).toBeInTheDocument();
    const [url, form, config] = post.mock.calls[0];
    expect(url).toBe('/api/company/ACME/reports/email-pdf');
    expect(config.headers['Content-Type']).toBe('multipart/form-data');
    expect(form.get('recipient_email')).toBe('boss@acme.com');
    expect(form.get('pdf_file').name).toBe(`violations_ACME_${today}.pdf`);
    expect(form.get('pdf_file').type).toBe('application/pdf');
  });

  it('alerts the backend error when sending fails', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    server.use(
      http.post(`${API}/api/company/:code/reports/email-pdf`, () =>
        HttpResponse.json({ detail: 'SMTP not configured' }, { status: 503 })),
    );
    const user = await renderReporting();
    await generate(user);

    await user.type(screen.getByPlaceholderText('name@example.com'), 'boss@acme.com');
    await user.click(screen.getByRole('button', { name: /Send PDF to E-mail/ }));

    await vi.waitFor(() => expect(alert).toHaveBeenCalledWith('SMTP not configured'));
    expect(screen.queryByText('Report sent successfully')).not.toBeInTheDocument();
  });
});
