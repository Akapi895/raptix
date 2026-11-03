import { http } from '../../platform/http';
import { authSessionSchema, loginResponseSchema, type LoginRequest, type ChangePasswordRequest } from '../types/auth';
import { messageResultSchema, type ApiOptions } from '../types/common';

// Routes: internal/app/app.go:setupRoutes; handlers: internal/handler/auth.go.
// Persistence is explicit: session.save(toStoredSession(await auth.login(...))).
// changePassword sends the Go oldPassword/newPassword contract. The current
// legacy mock's current_password/new_password handler still needs parity work.
export function createAuthClient(transport = http) {
  return {
    login: (body: LoginRequest, options: ApiOptions = {}) => transport.post('/api/auth/login', body, { ...options, auth: false, schema: loginResponseSchema }),
    validate: (options: ApiOptions = {}) => transport.get('/api/auth/validate', { ...options, schema: authSessionSchema }),
    logout: (options: ApiOptions = {}) => transport.post('/api/auth/logout', undefined, { ...options, schema: messageResultSchema }),
    changePassword: (body: ChangePasswordRequest, options: ApiOptions = {}) => transport.post('/api/auth/change-password', body, { ...options, schema: messageResultSchema }),
  };
}
export const auth = createAuthClient();
