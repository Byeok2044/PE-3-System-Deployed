export async function validateSession(token, request = fetch) {
  const unavailable = { status: 'unavailable', message: 'Session verification is unavailable. Check that the backend and its database are running, then retry.' };
  try {
    const response = await request('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    if ([401, 403].includes(response.status)) return { status: 'invalid' };
    if (!response.ok) return unavailable;
    const { user } = await response.json();
    if (!user || !(user.id || user._id)) return unavailable;
    return { status: 'valid', user };
  } catch { return unavailable; }
}
