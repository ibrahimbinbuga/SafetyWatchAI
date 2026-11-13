import { render } from '@testing-library/react';
import { AuthProvider, useAuth } from '../context/AuthContext';

// Mirrors App.jsx: pages are only rendered once the session has been restored.
const AuthGate = ({ children }) => {
  const { loading } = useAuth();
  return loading ? <p>Restoring session...</p> : children;
};

/**
 * Replace window.location with a writable stub so redirects
 * (`window.location.href = '/'`) can be asserted. Call restore() in afterEach.
 */
export const stubLocation = () => {
  const original = Object.getOwnPropertyDescriptor(window, 'location');
  const stub = { href: 'http://localhost:3000/dashboard', origin: 'http://localhost:3000' };
  Object.defineProperty(window, 'location', { value: stub, writable: true, configurable: true });
  return {
    location: stub,
    restore: () => Object.defineProperty(window, 'location', original),
  };
};

/** Seed localStorage as if a user had logged in earlier. */
export const seedSession = ({ role = 'user', companyCode = 'ACME', activeCompanyCode, token = 'valid-token' } = {}) => {
  localStorage.setItem('accessToken', token);
  localStorage.setItem('user', JSON.stringify({ id: role === 'admin' ? 1 : 2, email: `${role}@test.com`, role }));
  localStorage.setItem('companyCode', companyCode);
  if (activeCompanyCode) localStorage.setItem('activeCompanyCode', activeCompanyCode);
};

/** Render a component inside the real AuthProvider, with a pre-seeded session. */
export const renderWithAuth = (ui, session) => {
  if (session !== null) seedSession(session);
  return render(
    <AuthProvider>
      <AuthGate>{ui}</AuthGate>
    </AuthProvider>,
  );
};
