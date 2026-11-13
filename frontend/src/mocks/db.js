// In-memory fake backend state used by MSW handlers.
// Reset before every test (see src/test/setup.js) so tests never leak state.

export const API = 'http://localhost:8000';

const initialState = () => ({
  users: {
    'user@acme.com': { password: 'secret', user_id: 2, role: 'user', company_code: 'ACME' },
    'admin@sw.com': { password: 'adminpass', user_id: 1, role: 'admin', company_code: 'ADMIN' },
  },
  validTokens: new Set(['valid-token']),
  companies: [
    { id: 1, code: 'ACME', name: 'Acme Construction' },
    { id: 2, code: 'BETA', name: 'Beta Mining' },
    { id: 3, code: 'ADMIN', name: 'System Admin' },
  ],
  cameras: [
    { id: 1, name: 'Gate Cam', location: 'Main Gate', status: 'online', company_code: 'ACME', active_models: [{ id: 10, name: 'PPE', version: 'v1' }] },
    { id: 2, name: 'Warehouse Cam', location: 'Warehouse', status: 'offline', company_code: 'ACME', active_models: [] },
  ],
  generalModels: [
    { id: 10, name: 'PPE Detector', version: 'v1', description: 'Helmet & vest' },
    { id: 11, name: 'Fall Detector', version: 'v2', description: '' },
  ],
  companyModels: { ACME: [10] },
  // modelId -> { cameraId: priority }
  modelCameras: { 10: { 1: 'high' } },
  violations: [],
  nextCameraId: 3,
});

export let db = initialState();

export const resetDb = () => {
  db = initialState();
};
