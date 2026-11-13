// Public email actions must receive a real API acknowledgement. A static-site
// rewrite can otherwise return index.html with HTTP 200 and look like success.
export async function requestAuthEmailAction(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch(path, {
      method: 'POST', signal: controller.signal,
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.message || 'The account service is temporarily unavailable. Please try again.');
    if (typeof data?.message !== 'string' || !data.message.trim()) {
      throw new Error('The account service is temporarily unavailable. Please try again.');
    }
    return data.message;
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError) {
      throw new Error('The server is starting or temporarily unavailable. Please try again shortly.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
