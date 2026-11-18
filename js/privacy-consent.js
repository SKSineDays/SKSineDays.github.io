/** Optional browser uses are denied until explicitly permitted. No auth keys are touched. */
export const PRIVACY_KEY = 'sineday:privacy:v1';
export const PRIVACY_TTL = 180 * 24 * 60 * 60 * 1000;
const CODE_KEY = 'sineday_pending_affiliate_code';
const CODE_TIME_KEY = 'sineday_pending_affiliate_code_saved_at';
const CODE_TTL = 30 * 24 * 60 * 60 * 1000;
const PURPOSES = ['analytics', 'referrals', 'photos'];
const denied = () => ({ analytics: false, referrals: false, photos: false });
function storage(name) { try { return globalThis[name]; } catch { return undefined; } }
function remove(store, key) { try { store?.removeItem(key); } catch { /* Storage unavailable. */ } }
export function validChoice(value, now = Date.now()) {
  return value?.version === 1 && Number.isFinite(value.savedAt) && value.savedAt <= now
    && now - value.savedAt < PRIVACY_TTL && PURPOSES.every(key => typeof value[key] === 'boolean');
}
export function createPrivacyController({ local, session, now = Date.now, search = '', onChange = () => {} } = {}) {
  let choice = null;
  let referral = '';
  try {
    const code = (new URLSearchParams(search).get('ref') || '').trim().toUpperCase();
    if (/^[A-Z0-9-]{4,20}$/.test(code)) referral = code;
  } catch { /* Invalid URL. */ }
  function readChoice() {
    try {
      const saved = JSON.parse(local?.getItem(PRIVACY_KEY) || 'null');
      if (validChoice(saved, now())) return saved;
    } catch { /* Invalid or unavailable storage is not permission. */ }
    remove(local, PRIVACY_KEY);
    return null;
  }
  function clean() {
    if (!choice?.referrals) { remove(local, CODE_KEY); remove(local, CODE_TIME_KEY); }
    if (!choice?.photos) { remove(local, 'sineday:photo-history:v1'); remove(session, 'sineday:photo-visit:v1'); }
  }
  function captureReferral() {
    if (!choice?.referrals || !referral) return;
    try { local?.setItem(CODE_KEY, referral); local?.setItem(CODE_TIME_KEY, String(now())); } catch { /* No persistence available. */ }
    referral = '';
  }
  function current() {
    if (choice && !validChoice(choice, now())) {
      const previous = choice; choice = null; remove(local, PRIVACY_KEY); clean(); onChange(null, previous);
    }
    return choice;
  }
  choice = readChoice(); clean(); captureReferral();
  return {
    get: () => current() ? { ...choice } : null,
    allowed: purpose => current()?.[purpose] === true,
    save(values) {
      const previous = choice;
      choice = { version: 1, savedAt: now(), ...Object.fromEntries(PURPOSES.map(key => [key, values[key] === true])) };
      try { local?.setItem(PRIVACY_KEY, JSON.stringify(choice)); } catch { /* Respect in memory for this page only. */ }
      clean(); captureReferral(); onChange({ ...choice }, previous); return { ...choice };
    },
    refresh() {
      const previous = choice; choice = readChoice(); clean(); captureReferral();
      if (JSON.stringify(choice) !== JSON.stringify(previous)) onChange(choice, previous);
    },
    pendingReferral() {
      if (!current()?.referrals) return '';
      try {
        const time = Number(local?.getItem(CODE_TIME_KEY));
        const code = local?.getItem(CODE_KEY) || '';
        if (time > 0 && time <= now() && now() - time < CODE_TTL && /^[A-Z0-9-]{4,20}$/.test(code)) return code;
      } catch { /* Storage unavailable. */ }
      remove(local, CODE_KEY); remove(local, CODE_TIME_KEY); return '';
    },
    clearReferral() { referral = ''; remove(local, CODE_KEY); remove(local, CODE_TIME_KEY); },
  };
}
const browser = typeof window !== 'undefined' && typeof document !== 'undefined'
  && Boolean(window.location) && typeof document.createElement === 'function';
export const privacy = createPrivacyController({
  local: browser ? storage('localStorage') : undefined,
  session: browser ? storage('sessionStorage') : undefined,
  search: browser ? window.location.search : '',
  onChange(choice, previous) {
    if (!browser) return;
    window.dispatchEvent(new CustomEvent('sineday:privacy-change', { detail: { choice, previous } }));
  },
});
export const privacyAllowed = purpose => privacy.allowed(purpose);

function mountPrivacyChoices() {
  if (document.getElementById('sd-privacy-panel')) return;
  const style = document.createElement('style');
  style.textContent = `
    #sd-privacy-panel{position:fixed;z-index:10050;inset:auto 12px max(12px,env(safe-area-inset-bottom));margin:auto;max-width:640px;max-height:80dvh;overflow:auto;padding:20px;background:#20212b;color:#fff;border:1px solid #9895ac;border-radius:16px;box-shadow:0 8px 40px #0008;font:15px/1.5 system-ui,sans-serif;text-align:left}
    #sd-privacy-panel[hidden]{display:none}#sd-privacy-panel h2{font:600 20px/1.3 system-ui;margin:0 0 8px;color:#fff}#sd-privacy-panel p{margin:8px 0;color:#e5e4eb}#sd-privacy-panel a{color:#e1d3ff;text-decoration:underline}
    .sd-privacy-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}#sd-privacy-panel button,.sd-privacy-open{font:inherit;cursor:pointer;border-radius:8px;padding:10px 14px;min-height:44px}#sd-privacy-panel button{flex:1;background:#eee9ff;color:#20182e;border:1px solid #eee9ff}#sd-privacy-panel button:focus-visible,.sd-privacy-open:focus-visible{outline:3px solid #a8ceff;outline-offset:3px}
    #sd-privacy-panel label{display:block;padding:9px 0;color:#fff}#sd-privacy-panel input{width:18px;height:18px;margin-right:8px;vertical-align:middle;accent-color:#a993da}#sd-privacy-panel small{display:block;padding-left:30px;color:#ddd}.sd-privacy-open{background:transparent;color:inherit;border:1px solid currentColor}.sd-privacy-footer{text-align:center;padding:16px}
  `;
  document.head.append(style);
  const panel = document.createElement('section'); panel.id = 'sd-privacy-panel'; panel.hidden = true;
  panel.setAttribute('role', 'region'); panel.setAttribute('aria-labelledby', 'sd-privacy-title');
  panel.innerHTML = `<h2 id="sd-privacy-title" tabindex="-1">Your privacy choices</h2>
    <p>Sign-in and essential service storage stay on. You choose whether we remember referral links and photo history or collect optional site analytics. All are off until you allow them.</p>
    <p><a href="/privacy.html">Privacy policy</a>. These choices apply here, not automatically on SineDay Blog.</p>
    <div id="sd-privacy-options" hidden>
      <label><input type="checkbox" name="analytics">Analytics<small>Allow Vercel page-view analytics. No third-party analytics cookies.</small></label>
      <label><input type="checkbox" name="referrals">Remember referral links<small>Save an Affiliate Code for up to 30 days. If rejected, it is not remembered for checkout; referral attribution is not guaranteed.</small></label>
      <label><input type="checkbox" name="photos">Remember photo history<small>Keep day-photo selections across visits. Pictures still work if you decline.</small></label>
      <p>Saved choices expire after 180 days. Changing analytics permission may reload this page. You can change your mind here at any time.</p>
    </div>
    <div class="sd-privacy-actions"><button type="button" data-choice="reject">Reject optional</button><button type="button" data-choice="accept">Accept optional</button></div>
    <div class="sd-privacy-actions"><button type="button" data-choice="customize" aria-expanded="false" aria-controls="sd-privacy-options">Choose settings</button><button type="button" data-choice="save" hidden>Save choices</button><button type="button" data-choice="close">Not now</button></div>`;
  document.body.append(panel);
  const openButton = document.createElement('button'); openButton.type = 'button'; openButton.className = 'sd-privacy-open'; openButton.textContent = 'Privacy choices'; openButton.setAttribute('aria-controls', panel.id);
  const footer = document.querySelector('.site-footer__nav');
  if (footer) footer.append(openButton);
  else { const holder = document.createElement('footer'); holder.className = 'sd-privacy-footer'; holder.append(openButton); document.body.append(holder); }
  const options = panel.querySelector('#sd-privacy-options');
  const customize = panel.querySelector('[data-choice="customize"]');
  const save = panel.querySelector('[data-choice="save"]');
  function show(focus = false) {
    const values = privacy.get() || denied();
    PURPOSES.forEach(key => { panel.querySelector(`[name="${key}"]`).checked = values[key]; });
    panel.hidden = false; options.hidden = !focus; save.hidden = !focus; customize.hidden = focus;
    customize.setAttribute('aria-expanded', String(focus));
    if (focus) panel.querySelector('h2').focus();
  }
  function close(focus = true) { panel.hidden = true; if (focus) openButton.focus({ preventScroll: true }); }
  openButton.addEventListener('click', () => show(true));
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  panel.addEventListener('click', event => {
    const action = event.target.closest('[data-choice]')?.dataset.choice;
    if (!action) return;
    if (action === 'close') { close(); return; }
    if (action === 'customize') { show(true); return; }
    const values = action === 'save'
      ? Object.fromEntries(PURPOSES.map(key => [key, panel.querySelector(`[name="${key}"]`).checked]))
      : Object.fromEntries(PURPOSES.map(key => [key, action === 'accept']));
    privacy.save(values); close();
  });
  window.addEventListener('storage', event => { if (event.key === PRIVACY_KEY || event.key === null) privacy.refresh(); });
  window.addEventListener('pageshow', () => privacy.refresh());
  window.addEventListener('sineday:privacy-change', event => { if (!event.detail.choice) show(); });
  setInterval(() => privacy.get(), 60 * 1000);
  if (!privacy.get()) show();
}
if (browser) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountPrivacyChoices, { once: true });
  else mountPrivacyChoices();
}
