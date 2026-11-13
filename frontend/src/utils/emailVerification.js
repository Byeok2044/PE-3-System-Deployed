export function requestEmailVerification(token) {
  return (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch(`/api/auth/verify-email/${encodeURIComponent(token)}`, {
        method: 'POST', signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Unable to verify this email address. Please try again.');
      if (!data.message) throw new Error('The verification service is temporarily unavailable. Please try again.');
      return data.message;
    } catch (error) {
      if (error.name === 'AbortError' || error instanceof TypeError) {
        throw new Error('The server is starting or temporarily unavailable. Please try verifying again shortly.');
      }
      throw error;
    } finally { clearTimeout(timeout); }
  })();
}
