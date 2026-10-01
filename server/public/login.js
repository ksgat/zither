const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
let registering = false;

async function request(path, body) {
  const response = await fetch(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || data.error || 'Sign-in failed.');
  return data;
}
async function run(action) {
  document.querySelectorAll('button').forEach(button => { button.disabled = true; });
  try { await action(); } catch (error) { $('status').textContent = error.message; }
  finally { document.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
}
async function refresh() {
  const session = await request('/api/auth/get-session');
  $('signed-in').hidden = !session?.user;
  $('signed-out').hidden = !!session?.user;
  if (session?.user) $('account').textContent = `Signed in as ${session.user.name} (${session.user.email}).`;
}
$('toggle').onclick = () => {
  registering = !registering;
  $('email-label').hidden = !registering;
  document.querySelector('[name=email]').required = registering;
  document.querySelector('[name=password]').autocomplete = registering ? 'new-password' : 'current-password';
  $('submit').textContent = registering ? 'Create account' : 'Sign in';
  $('toggle').textContent = registering ? 'I already have an account' : 'Create an account';
};
$('credentials').onsubmit = event => {
  event.preventDefault();
  void run(async () => {
    const fields = Object.fromEntries(new FormData(event.target));
    await request(registering ? '/api/auth/sign-up/email' : '/api/auth/sign-in/username',
      registering ? { ...fields, name: fields.username } : { username: fields.username, password: fields.password });
    await refresh();
  });
};
$('signout').onclick = () => run(async () => { await request('/api/auth/sign-out', {}); await refresh(); });
$('continue').onclick = () => run(async () => {
  if (params.has('onshapeState')) {
    location.assign(`/onshape/connect?state=${encodeURIComponent(params.get('onshapeState'))}`);
  } else {
    const result = await request('/desktop/authorize', { redirectUri: params.get('redirectUri'), challenge: params.get('challenge'), state: params.get('state') });
    location.assign(result.url);
  }
});
void run(async () => {
  const { providers } = await request('/api/public-config');
  for (const provider of providers) {
    const button = document.createElement('button');
    button.textContent = `Continue with ${provider === 'google' ? 'Google' : 'GitHub'}`;
    button.onclick = () => run(async () => {
      const result = await request('/api/auth/sign-in/social', { provider, callbackURL: location.href });
      location.assign(result.url);
    });
    $('social').append(button);
  }
  await refresh();
});
