import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { API, db } from '../mocks/db';
import { renderWithAuth } from '../test/utils';
import { Cameras } from './Cameras';
import { Component } from 'react';

// Turns a render crash into visible output so the known-bug test fails cleanly
// instead of surfacing as an unhandled error.
class CrashBoundary extends Component {
  state = { crashed: false };
  static getDerivedStateFromError() { return { crashed: true }; }
  render() { return this.state.crashed ? <p>Page crashed</p> : this.props.children; }
}

const renderCameras = async (session = { role: 'user', companyCode: 'ACME' }) => {
  const user = userEvent.setup();
  renderWithAuth(<Cameras />, session);
  return user;
};

const cardOf = (name) => screen.getByTitle(name).closest('.rounded-xl');

describe('Cameras: list', () => {
  it('loads the company cameras and shows their status and active models', async () => {
    await renderCameras();

    expect(await screen.findByText('Gate Cam')).toBeInTheDocument();
    const gate = cardOf('Gate Cam');
    expect(within(gate).getByText('LIVE')).toBeInTheDocument();
    expect(within(gate).getByText('PPE (v1)')).toBeInTheDocument();

    const warehouse = cardOf('Warehouse Cam');
    // Badge on the preview + status label under it.
    expect(within(warehouse).getAllByText('OFFLINE')).toHaveLength(2);
    expect(within(warehouse).getByText('No active models')).toBeInTheDocument();
  });

  it('streams online cameras with the auth token in the URL', async () => {
    await renderCameras();

    const img = await screen.findByAltText('Gate Cam live feed');
    expect(img).toHaveAttribute('src', `${API}/api/camera/1/stream?token=valid-token`);
    expect(screen.queryByAltText('Warehouse Cam live feed')).not.toBeInTheDocument();
  });

  it('shows the empty state when the company has no cameras', async () => {
    db.cameras = [];
    await renderCameras();

    expect(await screen.findByText('No cameras found')).toBeInTheDocument();
  });

  it('asks an admin to pick a company before listing cameras', async () => {
    await renderCameras({ role: 'admin', companyCode: 'ADMIN' });

    expect(await screen.findByText(/Please select a company/)).toBeInTheDocument();
    expect(screen.queryByText('Camera Management')).not.toBeInTheDocument();
  });
});

describe('Cameras: create', () => {
  const openForm = async (user) => {
    await screen.findByText('Gate Cam');
    await user.click(screen.getByRole('button', { name: 'Add Camera' }));
  };

  it('validates the name before sending anything', async () => {
    const posted = vi.fn();
    server.events.on('request:start', ({ request }) => request.method === 'POST' && posted());
    const user = await renderCameras();
    await openForm(user);

    await user.type(screen.getByPlaceholderText(/Camera name/), '   ');
    await user.click(screen.getByRole('button', { name: 'Create Camera' }));

    expect(screen.getByText('Camera name is required.')).toBeInTheDocument();
    expect(posted).not.toHaveBeenCalled();
    server.events.removeAllListeners();
  });

  it('posts trimmed values for the active company, closes the form and shows the new camera', async () => {
    let body;
    server.use(
      http.post(`${API}/api/cameras`, async ({ request }) => {
        body = await request.json();
        db.cameras.push({ id: 99, status: 'offline', active_models: [], ...body });
        return HttpResponse.json({ id: 99 }, { status: 201 });
      }),
    );
    const user = await renderCameras();
    await openForm(user);

    await user.type(screen.getByPlaceholderText(/Camera name/), '  Dock Cam ');
    await user.type(screen.getByPlaceholderText(/Location/), 'Dock 3');
    const source = screen.getByPlaceholderText(/Source/);
    await user.clear(source);
    await user.type(source, 'rtsp://10.0.0.5/live');
    await user.click(screen.getByRole('button', { name: 'Create Camera' }));

    expect(await screen.findByText('Dock Cam')).toBeInTheDocument();
    expect(body).toEqual({ name: 'Dock Cam', location: 'Dock 3', rtsp_url: 'rtsp://10.0.0.5/live', company_code: 'ACME' });
    expect(screen.queryByRole('button', { name: 'Create Camera' })).not.toBeInTheDocument();
  });

  it('shows the backend error and keeps the form open when creation fails', async () => {
    server.use(
      http.post(`${API}/api/cameras`, () =>
        HttpResponse.json({ detail: 'Camera limit reached' }, { status: 400 })),
    );
    const user = await renderCameras();
    await openForm(user);

    await user.type(screen.getByPlaceholderText(/Camera name/), 'Extra Cam');
    await user.click(screen.getByRole('button', { name: 'Create Camera' }));

    expect(await screen.findByText('Camera limit reached')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Camera' })).toBeEnabled();
    expect(screen.queryByText('Extra Cam')).not.toBeInTheDocument();
  });
});

describe('Cameras: delete', () => {
  it('deletes the camera after confirmation and removes it from the grid', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = await renderCameras();
    await screen.findByText('Gate Cam');

    await user.click(within(cardOf('Warehouse Cam')).getByTitle('Delete camera'));

    await vi.waitFor(() => expect(screen.queryByText('Warehouse Cam')).not.toBeInTheDocument());
    expect(window.confirm).toHaveBeenCalledWith('Delete camera "Warehouse Cam"?');
    expect(db.cameras.map((c) => c.id)).toEqual([1]);
  });

  it('does nothing when the user cancels the confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const deleted = vi.fn();
    server.use(http.delete(`${API}/api/cameras/:id`, () => { deleted(); return HttpResponse.json({}); }));
    const user = await renderCameras();
    await screen.findByText('Gate Cam');

    await user.click(within(cardOf('Gate Cam')).getByTitle('Delete camera'));

    expect(deleted).not.toHaveBeenCalled();
    expect(screen.getByText('Gate Cam')).toBeInTheDocument();
  });

  it('alerts the backend error and keeps the camera when deletion fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    server.use(
      http.delete(`${API}/api/cameras/:id`, () =>
        HttpResponse.json({ detail: 'Camera is in use' }, { status: 409 })),
    );
    const user = await renderCameras();
    await screen.findByText('Gate Cam');

    await user.click(within(cardOf('Gate Cam')).getByTitle('Delete camera'));

    await vi.waitFor(() => expect(alert).toHaveBeenCalledWith('Camera is in use'));
    expect(screen.getByText('Gate Cam')).toBeInTheDocument();
  });
});

// BUG (Cameras.jsx:298): `camera.status.toUpperCase()` throws when the backend returns a
// camera without a status, crashing the whole page. Remove `.fails` once fixed.
it.fails('renders a camera that has no status yet (known bug)', async () => {
  db.cameras = [{ id: 5, name: 'New Cam', location: 'Roof', status: null, company_code: 'ACME' }];
  renderWithAuth(<CrashBoundary><Cameras /></CrashBoundary>, { role: 'user', companyCode: 'ACME' });

  expect(await screen.findByText('New Cam')).toBeInTheDocument();
});
