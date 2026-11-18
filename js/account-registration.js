import { getSupabaseClient, fetchConfig } from './supabase-client.js';

const panel = document.getElementById('registration-panel');
const form = document.getElementById('registration-form');
const status = document.getElementById('registration-status');
const providerArea = document.getElementById('registration-provider');
const country = document.getElementById('registration-country');
const birthdate = document.getElementById('registration-birthdate');
const method = document.getElementById('registration-method');
const email = document.getElementById('registration-email');
const submit = document.getElementById('registration-continue');
let registrationEnabled = false;
let generation = 0;
let busy = false;
let flow = null;
const scripts = new Map();

async function request(body) {
  if (!registrationEnabled) throw new Error('New account registration is not enabled.');
  const response = await fetch('/api/account-registration', { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || 'Registration is temporarily unavailable.');
  return result;
}
function loadScript(src) {
  if (scripts.has(src)) return scripts.get(src);
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src; script.async = true;
    script.onload = resolve;
    script.onerror = () => { scripts.delete(src); script.remove(); reject(new Error('Unable to load sign-up provider. Please try again.')); };
    document.head.appendChild(script);
  });
  scripts.set(src, promise);
  return promise;
}
function setBusy(value) {
  busy = value;
  submit.disabled = value;
  document.getElementById('registration-email-submit').disabled = value;
  form.setAttribute('aria-busy', String(value));
}
function reset() {
  generation++;
  flow = null;
  birthdate.value = '';
  email.value = '';
  providerArea.hidden = true;
  document.getElementById('registration-email-form').hidden = true;
  document.getElementById('registration-google-button').replaceChildren();
  document.getElementById('registration-apple-button').hidden = true;
  form.hidden = false;
  setBusy(false);
}
function cancel() {
  reset();
  status.textContent = '';
  // The server may already have admitted the request; cancellation is not rollback.
  request({ action: 'cancel' }).catch(() => {});
}
async function complete(token, version) {
  if (busy || version !== generation || !flow) return;
  setBusy(true);
  status.textContent = 'Creating your account…';
  try {
    const result = await request({ action: 'complete', token, email: email.value });
    if (version !== generation) return;
    if (result.emailSent) {
      reset();
      status.textContent = 'Check your inbox for your secure SineDay link.';
      return;
    }
    const client = await getSupabaseClient();
    if (version !== generation) return;
    const { error } = await client.auth.setSession(result.session);
    if (version !== generation) return;
    if (error) throw new Error('Your account was created, but sign-in did not finish. Please use Sign in.');
    window.location.assign('/dashboard.html');
  } catch (error) {
    if (version !== generation) return;
    reset();
    status.textContent = error.message;
  } finally {
    if (version === generation) setBusy(false);
  }
}

document.getElementById('registration-email-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || flow?.provider !== 'email' || !event.currentTarget.reportValidity()) return;
  await complete(undefined, generation);
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !form.reportValidity()) return;
  const version = ++generation;
  setBusy(true);
  status.textContent = 'Checking account eligibility…';
  let configuringApple = false;
  try {
    const result = await request({ action: 'begin', birthdate: birthdate.value, country: country.value, provider: method.value });
    birthdate.value = '';
    if (version !== generation) return;
    flow = result;
    form.hidden = true;
    providerArea.hidden = false;
    if (flow.provider === 'email') {
      document.getElementById('registration-email-form').hidden = false;
      status.textContent = 'Eligibility check complete. Enter your email to finish within five minutes.';
      email.focus();
      return;
    }
    if (flow.provider === 'google') {
      await loadScript('https://accounts.google.com/gsi/client');
      if (version !== generation) return;
      window.google.accounts.id.initialize({ client_id: flow.clientId, nonce: flow.nonce,
        auto_select: false, callback: response => complete(response.credential, version) });
      window.google.accounts.id.renderButton(document.getElementById('registration-google-button'),
        { theme: 'outline', size: 'large', text: 'continue_with' });
    } else {
      configuringApple = true;
      await loadScript('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js');
      if (version !== generation) return;
      window.AppleID.auth.init({ clientId: flow.clientId, scope: 'name email', redirectURI: flow.redirectUri,
        nonce: flow.nonce, state: flow.nonce, usePopup: true });
      document.getElementById('registration-apple-button').hidden = false;
    }
    status.textContent = 'Continue below to finish. This step expires in five minutes.';
  } catch (error) {
    if (version !== generation) return;
    reset();
    status.textContent = configuringApple ? appleSignupFailure(error) : error.message;
  } finally {
    if (version === generation) setBusy(false);
  }
});
// Only these fixed references/messages may leave the Apple SDK error boundary.
// Never display/log SDK error_description, message, authorization data or tokens.
function appleSignupFailure(error) {
  const messages = {
    APPLE_CANCELED: 'Apple authorization ended before returning to SineDay. Please try again.',
    APPLE_POPUP_CLOSED: 'The Apple authorization window closed before returning a result. Please try again.',
    APPLE_POPUP_BLOCKED: 'The browser could not open Apple authorization. Allow the sign-in window, or try Safari directly.',
    APPLE_UNAUTHORIZED_CLIENT: 'Apple did not authorize this sign-up configuration. Please share this reference with SineDay support.',
    APPLE_INVALID_CLIENT: 'Apple could not accept the configured sign-up client. Please share this reference with SineDay support.',
    APPLE_INVALID_REQUEST: 'Apple could not accept the authorization request. Please share this reference with SineDay support.',
    APPLE_INVALID_REDIRECT: 'Apple could not accept the sign-up return address. Please share this reference with SineDay support.',
    APPLE_STATE_MISSING: 'Apple returned without the required sign-up state. No account request was sent. Please start again.',
    APPLE_STATE_MISMATCH: 'The Apple sign-up state did not match. No account request was sent. Please start again.',
    APPLE_TOKEN_MISSING: 'Apple returned without the required identity token. No account request was sent. Please start again.',
    APPLE_UNAVAILABLE: 'Apple sign-up is unavailable in this browser right now. Please start again.',
    APPLE_UNKNOWN: 'Apple authorization could not finish. Please share this reference with SineDay support.'
  };
  const sdkCodes = {
    user_cancelled_authorize: 'APPLE_CANCELED',
    popup_closed_by_user: 'APPLE_POPUP_CLOSED',
    popup_blocked_by_browser: 'APPLE_POPUP_BLOCKED',
    popup_blocked: 'APPLE_POPUP_BLOCKED',
    unauthorized_client: 'APPLE_UNAUTHORIZED_CLIENT',
    invalid_client: 'APPLE_INVALID_CLIENT',
    invalid_request: 'APPLE_INVALID_REQUEST',
    invalid_redirect_uri: 'APPLE_INVALID_REDIRECT'
  };
  const raw = typeof error === 'string' ? error :
    typeof error?.error === 'string' ? error.error : typeof error?.code === 'string' ? error.code : '';
  const code = Object.prototype.hasOwnProperty.call(messages, raw) ? raw :
    Object.prototype.hasOwnProperty.call(sdkCodes, raw) ? sdkCodes[raw] : 'APPLE_UNKNOWN';
  return `${messages[code]} Reference: ${code}.`;
}
function appleFlowError(code) { return { code }; }

document.getElementById('registration-apple-button').addEventListener('click', async () => {
  if (busy || flow?.provider !== 'apple') return;
  const version = generation;
  setBusy(true);
  try {
    if (typeof window.AppleID?.auth?.signIn !== 'function') throw appleFlowError('APPLE_UNAVAILABLE');
    const result = await window.AppleID.auth.signIn();
    if (version !== generation) return;
    if (typeof result?.authorization?.state !== 'string' || !result.authorization.state) throw appleFlowError('APPLE_STATE_MISSING');
    if (result.authorization.state !== flow.nonce) throw appleFlowError('APPLE_STATE_MISMATCH');
    if (typeof result.authorization.id_token !== 'string' || !result.authorization.id_token) throw appleFlowError('APPLE_TOKEN_MISSING');
    setBusy(false);
    await complete(result.authorization?.id_token, version);
  } catch (error) {
    if (version !== generation) return;
    reset();
    status.textContent = appleSignupFailure(error);
  } finally { if (version === generation) setBusy(false); }
});
document.getElementById('registration-cancel').addEventListener('click', () => { cancel(); panel.open = false; });
panel.addEventListener('toggle', () => { if (!panel.open) cancel(); });
window.addEventListener('pagehide', reset);
window.addEventListener('pageshow', event => { if (event.persisted) reset(); });
fetchConfig().then(async config => {
  if (config.accountRegistrationEnabled !== true) return;
  registrationEnabled = true; panel.hidden = false;
  const response = await fetch('/api/eligibility-policy', { cache: 'no-store' });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error();
  for (const entry of result.countries) {
    const option = document.createElement('option');
    option.value = entry.code; option.textContent = entry.name; country.appendChild(option);
  }
}).catch(() => { status.textContent = 'Country eligibility is temporarily unavailable. Existing members can still sign in.'; });
