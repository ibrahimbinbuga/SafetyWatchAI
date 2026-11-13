import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { API, db } from '../mocks/db';
import { renderWithAuth } from '../test/utils';
import { ModelCameraAssignment } from './ModelCameraAssignment';

const USER = { role: 'user', companyCode: 'ACME' };
const ADMIN = { role: 'admin', companyCode: 'ADMIN', activeCompanyCode: 'ACME' };

const renderPage = async (session = USER) => {
  const user = userEvent.setup();
  renderWithAuth(<ModelCameraAssignment />, session);
  await screen.findByText('Model Camera Assignment Overview');
  await vi.waitFor(() =>
    expect(screen.queryByText('Loading assignment overview...')).not.toBeInTheDocument());
  return user;
};

/** The overview card of one assigned model. */
const modelCard = (modelName) =>
  within(screen.getByText('Model Camera Assignment Overview').closest('.rounded-xl'))
    .getByText(modelName, { selector: 'p.font-semibold' })
    .closest('.rounded-lg');

const cameraCell = (card, cameraName) =>
  within(card).getByRole('checkbox', { name: new RegExp(cameraName) }).closest('.rounded-md');

describe('ModelCameraAssignment: listing', () => {
  it('shows a regular user the company models read-only with the saved camera links', async () => {
    await renderPage();

    expect(screen.queryByRole('button', { name: 'Save Models' })).not.toBeInTheDocument();
    const card = modelCard('PPE Detector');
    expect(within(card).getByText('1 selected')).toBeInTheDocument();
    expect(within(card).getByRole('checkbox', { name: /Gate Cam/ })).toBeChecked();
    expect(within(card).getByRole('checkbox', { name: /Warehouse Cam/ })).not.toBeChecked();
    // Saved priority from the backend is preselected; unknown ones default to medium.
    expect(within(cameraCell(card, 'Gate Cam')).getByRole('combobox')).toHaveValue('high');
    expect(within(cameraCell(card, 'Warehouse Cam')).getByRole('combobox')).toHaveValue('medium');
  });

  it('shows empty states when the company has no models assigned', async () => {
    db.companyModels = {};
    await renderPage();

    expect(screen.getAllByText('No models assigned to this company.')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Save All Assignments' })).toBeDisabled();
  });

  it('tells the user when the company has no cameras', async () => {
    db.cameras = [];
    await renderPage();

    expect(screen.getByText('No cameras found for this company.')).toBeInTheDocument();
  });

  it('falls back to the empty state when loading assigned models fails', async () => {
    server.use(
      http.get(`${API}/api/company/:code/general-models`, () => HttpResponse.json({}, { status: 500 })),
    );
    await renderPage();

    expect(screen.getAllByText('No models assigned to this company.')).toHaveLength(2);
  });
});

describe('ModelCameraAssignment: updating', () => {
  it('lets an admin change the company models and saves the selected ids', async () => {
    let body;
    server.use(
      http.put(`${API}/api/company/:code/general-models`, async ({ request, params }) => {
        body = await request.json();
        db.companyModels[params.code] = body.model_ids;
        return HttpResponse.json({});
      }),
    );
    const user = await renderPage(ADMIN);

    const fall = await screen.findByRole('checkbox', { name: /Fall Detector/ });
    expect(screen.getByRole('checkbox', { name: /PPE Detector/ })).toBeChecked();
    expect(fall).not.toBeChecked();

    await user.click(fall);
    await user.click(screen.getByRole('button', { name: 'Save Models' }));

    expect(body).toEqual({ model_ids: [10, 11] });
    // After saving, the overview is reloaded and now contains the new model.
    expect(await screen.findByText('Fall Detector', { selector: 'p.font-semibold' })).toBeInTheDocument();
  });

  it('saves camera selection and priority per model and refreshes the saved state', async () => {
    const bodies = [];
    server.use(
      http.put(`${API}/api/company/:code/model-cameras`, async ({ request }) => {
        const body = await request.json();
        bodies.push(body);
        db.modelCameras[body.model_id] = Object.fromEntries(
          body.camera_ids.map((id) => [id, body.camera_priorities[String(id)]]),
        );
        return HttpResponse.json({});
      }),
    );
    const user = await renderPage();
    const card = modelCard('PPE Detector');

    await user.click(within(card).getByRole('checkbox', { name: /Warehouse Cam/ }));
    await user.selectOptions(within(cameraCell(card, 'Warehouse Cam')).getByRole('combobox'), 'critical');
    expect(within(card).getByText('2 selected')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save All Assignments' }));

    expect(bodies).toEqual([
      { model_id: 10, camera_ids: [1, 2], camera_priorities: { 1: 'high', 2: 'critical' } },
    ]);
    // "Saved state" chips now include both cameras.
    await vi.waitFor(() =>
      expect(within(modelCard('PPE Detector')).getAllByText('Warehouse Cam')).toHaveLength(2));
  });

  it('unselecting a camera sends it without that camera', async () => {
    let body;
    server.use(
      http.put(`${API}/api/company/:code/model-cameras`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({});
      }),
    );
    const user = await renderPage();

    await user.click(within(modelCard('PPE Detector')).getByRole('checkbox', { name: /Gate Cam/ }));
    await user.click(screen.getByRole('button', { name: 'Save All Assignments' }));

    await vi.waitFor(() => expect(body).toMatchObject({ model_id: 10, camera_ids: [] }));
  });

  it('keeps the previously saved state when saving fails', async () => {
    server.use(
      http.put(`${API}/api/company/:code/model-cameras`, () => HttpResponse.json({}, { status: 500 })),
    );
    const user = await renderPage();
    const card = modelCard('PPE Detector');

    await user.click(within(card).getByRole('checkbox', { name: /Warehouse Cam/ }));
    await user.click(screen.getByRole('button', { name: 'Save All Assignments' }));

    await screen.findByRole('button', { name: 'Save All Assignments' });
    expect(db.modelCameras[10]).toEqual({ 1: 'high' });
    // Only the checkbox label mentions Warehouse Cam; no "saved" chip was added.
    expect(within(modelCard('PPE Detector')).getAllByText('Warehouse Cam')).toHaveLength(1);
  });
});
