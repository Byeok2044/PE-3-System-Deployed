import { requestAuthEmailAction } from './authEmailActions.js';

export function requestEmailVerification(token) {
  return requestAuthEmailAction(`/api/auth/verify-email/${encodeURIComponent(token)}`);
}
