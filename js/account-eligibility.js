/**
 * Await BEFORE dashboard/member data loads, and on every authenticated identity change.
 * This is an interruption UI, not an authorization boundary. RLS and server handlers
 * still need eligibility enforcement before claiming direct API access is protected.
 */
export async function fetchAccountEligibility(accessToken, { signal, body } = {}) {
  const response = await fetch('/api/account-eligibility', {
    method: body ? 'POST' : 'GET', credentials: 'omit', cache: 'no-store', signal,
    headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const result = await response.json();
  // A denied or concurrently recorded result is authoritative state, not a reason
  // to reopen an editable birthdate field and invite a different answer.
  if (['eligible', 'required', 'review_required'].includes(result.state) &&
      (response.ok || [403, 409].includes(response.status))) return result;
  const error = new Error(result.error || 'Eligibility is temporarily unavailable.');
  error.status = response.status;
  throw error;
}

/** Resolves true only after a server-owned eligible result; false on Exit or abort. */
export async function ensureAccountEligibility({ accessToken, signal, mount = document.body } = {}) {
  if (!accessToken || signal?.aborted) return false;
  let initial;
  try { initial = await fetchAccountEligibility(accessToken, { signal }); }
  catch (error) { if (signal?.aborted) return false; initial = { state: 'unavailable', message: error.message }; }
  if (signal?.aborted) return false;
  if (initial.state === 'eligible') return true;

  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-labelledby', 'owner-eligibility-title');
    dialog.style.cssText = 'max-width:30rem;width:calc(100% - 2rem);border-radius:1rem;padding:1.5rem;box-sizing:border-box;';
    dialog.innerHTML = `
      <h2 id="owner-eligibility-title">A one-time account check</h2>
      <p>Tell us about the person who uses this account, not someone added to Duck Globe or your journal. We save the eligibility result, not your full birthdate from this check.</p>
      <p data-status role="status" aria-live="polite"></p>
      <form data-form hidden>
        <p><label>Your birthdate<br><input data-birthdate type="date" autocomplete="off" required></label></p>
        <p><label>Country where you live<br><select data-country required><option value="">Choose your country</option></select></label></p>
        <p>If your country is unavailable, contact support rather than choosing a different country.</p>
        <button data-submit type="submit">Continue</button>
      </form>
      <button data-retry type="button" hidden>Check again</button>
      <p><a href="mailto:support@sineday.app">Contact support</a></p>
      <button data-billing type="button">Manage or cancel existing billing</button>
      <p data-billing-status role="status" aria-live="polite"></p>
      <button data-exit type="button">Leave account check</button>`;
    const form = dialog.querySelector('[data-form]');
    const birthdate = dialog.querySelector('[data-birthdate]');
    const country = dialog.querySelector('[data-country]');
    const status = dialog.querySelector('[data-status]');
    const retry = dialog.querySelector('[data-retry]');
    const submit = dialog.querySelector('[data-submit]');
    const billing = dialog.querySelector('[data-billing]');
    const billingStatus = dialog.querySelector('[data-billing-status]');
    let billingBusy = false;
    let ended = false, busy = false, countriesLoaded = false, version = 0;
    const finish = value => {
      if (ended) return;
      ended = true; version++; birthdate.value = '';
      signal?.removeEventListener('abort', abort);
      dialog.close(); dialog.remove(); resolve(value);
    };
    const abort = () => finish(false);
    const render = async state => {
      if (ended || signal?.aborted) return;
      form.hidden = true; retry.hidden = true; birthdate.value = '';
      if (state.state === 'eligible') { finish(true); return; }
      if (state.state === 'review_required') {
        status.textContent = state.message || 'This account needs an eligibility review. Please contact support. Your existing account and saved information have not been deleted.';
        return;
      }
      if (state.state !== 'required') {
        status.textContent = state.message || 'We could not confirm eligibility. Please try again later.';
        retry.hidden = false; return;
      }
      if (!countriesLoaded) {
        const currentVersion = version;
        try {
          const response = await fetch('/api/eligibility-policy', { cache: 'no-store', signal });
          const policy = await response.json();
          if (!response.ok || !policy.ok || !Array.isArray(policy.countries)) throw new Error();
          if (ended || currentVersion !== version) return;
          for (const item of policy.countries) {
            const option = document.createElement('option'); option.value = item.code; option.textContent = item.name; country.appendChild(option);
          }
          countriesLoaded = true;
        } catch {
          if (!ended) { status.textContent = 'Country eligibility is temporarily unavailable.'; retry.hidden = false; }
          return;
        }
      }
      if (ended) return;
      status.textContent = 'Please confirm your details once to continue.';
      form.hidden = false; birthdate.focus();
    };
    const check = async () => {
      if (busy || ended) return;
      busy = true; retry.disabled = true;
      try { await render(await fetchAccountEligibility(accessToken, { signal })); }
      catch (error) { if (!ended) await render({ state: 'unavailable', message: error.message }); }
      finally { busy = false; retry.disabled = false; }
    };
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy || ended || !form.reportValidity()) return;
      busy = true; submit.disabled = true; status.textContent = 'Checking eligibility…';
      const body = { birthdate: birthdate.value, country: country.value };
      birthdate.value = '';
      try { await render(await fetchAccountEligibility(accessToken, { signal, body })); }
      catch (error) {
        // The server might have persisted a result before a network error. Re-read
        // status instead of allowing a different declaration after an ambiguous send.
        if (!ended) await render({ state: 'unavailable', message: error.message });
      } finally { body.birthdate = ''; busy = false; submit.disabled = false; }
    });
    billing.addEventListener('click', async () => {
      if (ended || billingBusy) return;
      billingBusy = true; billing.disabled = true;
      billingStatus.textContent = 'Opening billing controls…';
      try {
        // Deliberately auth-only: an eligibility review must not prevent cancellation.
        // Never create a checkout or pass a client-selected customer/subscription ID.
        const response = await fetch('/api/create-portal-session', {
          method: 'POST', credentials: 'omit', cache: 'no-store', signal,
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
        });
        const result = await response.json();
        if (ended || signal?.aborted) return;
        if (!response.ok || !result.ok) throw new Error();
        const url = new URL(result.url);
        if (url.protocol !== 'https:' || url.hostname !== 'billing.stripe.com' || url.username || url.password || url.port) throw new Error();
        window.location.assign(url.href);
      } catch {
        if (!ended) billingStatus.textContent = 'We could not open existing billing. Contact support for help managing or canceling a subscription.';
      } finally { billingBusy = false; if (!ended) billing.disabled = false; }
    });
    retry.addEventListener('click', check);
    dialog.querySelector('[data-exit]').addEventListener('click', () => finish(false));
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
    signal?.addEventListener('abort', abort, { once: true });
    mount.appendChild(dialog);
    dialog.showModal();
    void render(initial);
  });
}
