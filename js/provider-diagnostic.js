const status = document.getElementById('status');
const googleButton = document.getElementById('google-button');
const appleButton = document.getElementById('apple-button');
let flow = null, generation = 0, busy = false;
const scripts = new Map();
function reset() { generation++; flow = null; busy = false; googleButton.replaceChildren(); appleButton.hidden = true; }
async function request(body) {
  const response = await fetch('/api/provider-diagnostic', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error('Diagnostic unavailable or failed. No SineDay account was created or signed in.');
  return result;
}
function load(src) {
  if (!scripts.has(src)) scripts.set(src, new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = src; script.async = true;
    script.onload = resolve; script.onerror = () => { scripts.delete(src); script.remove(); reject(new Error()); };
    document.head.appendChild(script);
  }));
  return scripts.get(src);
}
async function complete(token, version) {
  if (busy || version !== generation || !flow) return;
  busy = true;
  try {
    const result = await request({ action: 'complete', provider: flow.provider, state: flow.state, token });
    if (version !== generation) return;
    reset(); status.textContent = `${result.provider === 'google' ? 'Google' : 'Apple'} provider proof: ${result.passed ? 'PASS' : 'FAIL'}. No SineDay account was created or signed in.`;
  } catch {
    if (version !== generation) return;
    reset(); status.textContent = 'Provider proof: FAIL or unavailable. No SineDay account was created or signed in.';
  } finally { token = ''; if (version === generation) busy = false; }
}
async function prepare(provider) {
  if (busy) return;
  reset(); const version = generation; busy = true;
  status.textContent = 'Preparing preview-only test…';
  try {
    const result = await request({ action: 'begin', provider });
    if (version !== generation) return;
    flow = result;
    if (provider === 'google') {
      await load('https://accounts.google.com/gsi/client');
      if (version !== generation) return;
      window.google.accounts.id.initialize({ client_id: flow.clientId, nonce: flow.nonce, auto_select: false,
        callback: result => complete(result.credential, version) });
      window.google.accounts.id.renderButton(googleButton, { theme: 'outline', size: 'large', text: 'continue_with' });
    } else {
      await load('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js');
      if (version !== generation) return;
      window.AppleID.auth.init({ clientId: flow.clientId, redirectURI: flow.redirectUri, nonce: flow.nonce,
        state: flow.state, scope: 'email', usePopup: true });
      appleButton.hidden = false;
    }
    status.textContent = 'Click the provider button to run the test. It expires in three minutes.';
  } catch {
    if (version !== generation) return;
    reset(); status.textContent = 'This diagnostic is unavailable on this deployment. No provider test started.';
  } finally { if (version === generation) busy = false; }
}
document.getElementById('test-google').addEventListener('click', () => prepare('google'));
document.getElementById('test-apple').addEventListener('click', () => prepare('apple'));
appleButton.addEventListener('click', async () => {
  if (busy || flow?.provider !== 'apple') return;
  const version = generation; busy = true;
  try {
    const result = await window.AppleID.auth.signIn();
    if (version !== generation) return;
    if (result.authorization?.state !== flow.state) throw new Error();
    busy = false; await complete(result.authorization?.id_token, version);
  } catch {
    if (version !== generation) return;
    reset(); status.textContent = 'Apple test canceled or failed. No SineDay account was created or signed in.';
  } finally { if (version === generation) busy = false; }
});
document.getElementById('cancel').addEventListener('click', () => {
  reset(); status.textContent = 'Test canceled. No SineDay account was created or signed in.';
  request({ action: 'cancel' }).catch(() => {});
});
window.addEventListener('pagehide', reset);
window.addEventListener('pageshow', event => { if (event.persisted) reset(); });
