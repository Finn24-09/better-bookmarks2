import { apiFetch } from './api';

export interface AuthResult {
  token: string;
  user_id: string;
}

export function signUp(email: string, password: string): Promise<AuthResult> {
  return apiFetch<AuthResult>('/rpc/sign_up', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function signIn(email: string, password: string): Promise<AuthResult> {
  return apiFetch<AuthResult>('/rpc/sign_in', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function changePassword(
  current_password: string,
  new_password: string,
): Promise<void> {
  return apiFetch<void>('/rpc/change_password', {
    method: 'POST',
    body: JSON.stringify({ current_password, new_password }),
  });
}

export function deleteAccount(password: string): Promise<void> {
  return apiFetch<void>('/rpc/delete_account', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}
