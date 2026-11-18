/** Conservative opt-in analytics. Never loaded before affirmative permission. */
import { privacyAllowed } from './privacy-consent.js';
const INSIGHTS_SCRIPT_SRC = '/_vercel/insights/script.js';
let loaded = false;
export function filterAnalyticsEvent(event) {
  if (!privacyAllowed('analytics') || event.type !== 'pageview') return null;
  try {
    const url = new URL(event.url, window.location.origin);
    url.search = ''; url.hash = '';
    return { ...event, url: url.href };
  } catch { return null; }
}
function injectVercelAnalytics() {
  if (!privacyAllowed('analytics') || loaded) return;
  loaded = true;
  window.va = window.va || function va() {
    window.vaq = window.vaq || [];
    window.vaq.push(arguments);
  };
  window.va('beforeSend', filterAnalyticsEvent);
  const script = document.createElement('script');
  script.src = INSIGHTS_SCRIPT_SRC; script.defer = true;
  document.head.appendChild(script);
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('sineday:privacy-change', () => {
    // beforeSend denies immediately, including in-flight SDK startup. A reload
    // also removes the provider's listeners; removing its DOM tag alone cannot.
    if (loaded && !privacyAllowed('analytics')) window.location.reload();
    else injectVercelAnalytics();
  });
  injectVercelAnalytics();
}
