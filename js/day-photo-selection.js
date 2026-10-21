/** Website-only photo selection. The rhythm engine and email assets stay unchanged. */
export const PHOTO_VISIT_KEY = 'sineday:photo-visit:v1';
export const PHOTO_HISTORY_KEY = 'sineday:photo-history:v1';
export const PHOTO_VISIT_IDLE_MS = 30 * 60 * 1000;

function read(storage, key) {
  try { return JSON.parse(storage?.getItem(key) || 'null'); } catch { return null; }
}
function write(storage, key, value) {
  try { storage?.setItem(key, JSON.stringify(value)); } catch { /* Private mode / full storage. */ }
}
function validIndex(value, count) {
  return Number.isInteger(value) && value >= 0 && value < count;
}

/**
 * A visit survives reloads and same-tab navigation for 30 minutes of inactivity.
 * Once this document selects a photo, no clock tick or rerender can change it.
 * Per-day counters advance only for days actually viewed, covering all ten before
 * repeating. Storage contains no identity, birthdate, or journal information.
 * Dependency injection keeps the policy testable without a browser or account.
 */
export function createPhotoSelector({ collection, version, sessionStorage, localStorage, now = Date.now }) {
  const chosen = new Map();
  let visit;
  function startVisit() {
    if (visit) return visit;
    const saved = read(sessionStorage, PHOTO_VISIT_KEY);
    const age = now() - saved?.lastUsed;
    visit = saved?.version === version && Number.isFinite(age) && age >= 0 && age < PHOTO_VISIT_IDLE_MS
      && saved?.indices && typeof saved.indices === 'object' && !Array.isArray(saved.indices)
      ? saved : { version, lastUsed: now(), indices: {} };
    return visit;
  }
  return function selectDayPhoto(day) {
    if (!Number.isInteger(day) || day < 1 || day > 18) return null;
    if (chosen.has(day)) {
      visit.lastUsed = now();
      write(sessionStorage, PHOTO_VISIT_KEY, visit);
      return chosen.get(day);
    }
    const photos = collection[day];
    if (!Array.isArray(photos) || !photos.length) return null;
    const current = startVisit();
    let index = current.indices[day];
    if (!validIndex(index, photos.length)) {
      const saved = read(localStorage, PHOTO_HISTORY_KEY);
      const history = saved?.version === version && saved?.indices && typeof saved.indices === 'object'
        && !Array.isArray(saved.indices) ? saved : { version, indices: {} };
      const previous = history.indices[day];
      index = validIndex(previous, photos.length) ? (previous + 1) % photos.length : 0;
      history.indices[day] = index;
      current.indices[day] = index;
      write(localStorage, PHOTO_HISTORY_KEY, history);
    }
    current.lastUsed = now();
    write(sessionStorage, PHOTO_VISIT_KEY, current);
    chosen.set(day, photos[index]);
    return photos[index];
  };
}
