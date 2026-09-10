/**
 * Vercel Web Analytics bootstrap.
 *
 * SineDay is vanilla ES modules with no bundler, so the Next.js
 * `<Analytics />` import from `@vercel/analytics/next` cannot mount here.
 * This module is the page-layout equivalent: queue events, then inject
 * `/_vercel/insights/script.js` the same way `@vercel/analytics` `inject()` does.
 */

const INSIGHTS_SCRIPT_SRC = "/_vercel/insights/script.js";

function initQueue() {
  if (window.va) return;
  window.va = function va() {
    if (!window.vaq) window.vaq = [];
    window.vaq.push(arguments);
  };
}

function injectVercelAnalytics() {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  initQueue();

  if (document.querySelector(`script[src*="${INSIGHTS_SCRIPT_SRC}"]`)) {
    return;
  }

  const script = document.createElement("script");
  script.src = INSIGHTS_SCRIPT_SRC;
  script.defer = true;
  script.onerror = () => {
    console.log(
      `[Vercel Web Analytics] Failed to load script from ${INSIGHTS_SCRIPT_SRC}. Be sure to enable Web Analytics for your project and deploy again. See https://vercel.com/docs/analytics/quickstart for more information.`
    );
  };
  document.head.appendChild(script);
}

injectVercelAnalytics();
