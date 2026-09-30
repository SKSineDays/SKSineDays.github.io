import { authenticateUser } from './auth.js';

// Bound this optional feature's auth work without changing shared authentication.
// The helper's pending request can settle later, but cannot start a data query then.
export async function authenticateGlobeUser(req) {
  let timeout;
  try {
    return await Promise.race([
      authenticateUser(req),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          const error = new Error('Authentication service unavailable');
          error.code = 'GLOBE_AUTH_TIMEOUT';
          reject(error);
        }, 5000);
      })
    ]);
  } finally { clearTimeout(timeout); }
}
