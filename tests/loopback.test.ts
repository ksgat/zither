import { expect, it } from 'vitest';
import { loopback, randomToken } from '../electron/loopback.js';

it('accepts only the expected callback path and state', async () => {
  const state = randomToken();
  const callback = await loopback(state, AbortSignal.timeout(5000));
  try {
    expect((await fetch(`${callback.redirectUri}?state=wrong&code=x`)).status).toBe(400);
    expect((await fetch(`${callback.redirectUri}/other?state=${state}&code=x`)).status).toBe(400);
    const response = await fetch(`${callback.redirectUri}?state=${state}&code=valid`);
    expect(response.status).toBe(200);
    expect((await callback.result).searchParams.get('code')).toBe('valid');
  } finally { callback.close(); }
});
it('closes a cancelled sign-in listener', async () => {
  const controller = new AbortController();
  const callback = await loopback(randomToken(), controller.signal);
  controller.abort();
  await expect(callback.result).rejects.toThrow('cancelled');
  await expect(fetch(callback.redirectUri)).rejects.toThrow();
  callback.close();
});
