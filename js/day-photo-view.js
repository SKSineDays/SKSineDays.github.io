import { DAY_PHOTOS, DAY_PHOTO_COLLECTION_VERSION } from './day-photo-collection.js';
import { createPhotoSelector } from './day-photo-selection.js';

function browserStorage(name) {
  try { return globalThis[name]; } catch { return undefined; }
}
const select = createPhotoSelector({
  collection: DAY_PHOTOS, version: DAY_PHOTO_COLLECTION_VERSION,
  sessionStorage: browserStorage('sessionStorage'), localStorage: browserStorage('localStorage'),
});
export const selectDayPhoto = select;

/** Keep the API-provided Unsplash URL (especially ixid); change delivery size only. */
export function photoImageUrl(photo, width = 960) {
  const url = new URL(photo.url);
  url.searchParams.delete('fm');
  url.searchParams.set('auto', 'format');
  url.searchParams.set('fit', 'max');
  url.searchParams.set('w', String(width));
  url.searchParams.set('q', '80');
  return url.href;
}
export function photoSrcSet(photo) {
  return [480, 768, 960, 1440].map(width => `${photoImageUrl(photo, width)} ${width}w`).join(', ');
}
function attributedLink(document, label, href) {
  const link = document.createElement('a');
  link.textContent = label;
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}
export function renderPhotoCredit(container, photo) {
  if (!container) return;
  container.replaceChildren();
  container.hidden = !photo;
  if (!photo) return;
  const doc = container.ownerDocument;
  container.append('Photo by ', attributedLink(doc, photo.photographer, photo.photographerUrl),
    ' on ', attributedLink(doc, 'Unsplash', photo.photoUrl));
}

const presentations = new WeakMap();
export function cancelDayPhoto(image, credit) {
  if (image) {
    presentations.delete(image);
    image.onload = null;
    image.onerror = null;
  }
  renderPhotoCredit(credit, null);
}
/**
 * One selected hotlink, never a preloaded gallery. Network failure falls back to
 * the existing local AVIF/JPEG without advancing the visit or retaining false
 * credits. The same successfully decoded URL feeds the homepage backdrop.
 */
export function presentDayPhoto({ image, credit, result, sizes, onLoad, onUnavailable }) {
  if (!image) return;
  const photo = selectDayPhoto(result.day);
  const candidates = [
    ...(photo ? [{ src: photoImageUrl(photo), photo }] : []),
    ...[result.imageAvifUrl, result.imageUrl].filter(Boolean).map(src => ({ src: src.startsWith('/') ? src : `/${src}` })),
  ];
  const signature = JSON.stringify(candidates.map(candidate => candidate.src));
  const previous = presentations.get(image);
  if (previous?.signature === signature && previous.credit === credit) {
    // A profile/auth rerender must not blink a still photo or restart its request.
    // Refresh ownership so a pending decode can notify the newest result object.
    previous.onLoad = onLoad;
    previous.onUnavailable = onUnavailable;
    if (previous.loadedUrl) onLoad?.(previous.loadedUrl);
    else if (previous.unavailable) onUnavailable?.();
    return;
  }
  const state = { index: 0, signature, credit, onLoad, onUnavailable };
  presentations.set(image, state);
  renderPhotoCredit(credit, null);
  image.style.opacity = '0';
  image.referrerPolicy = 'strict-origin-when-cross-origin';
  image.sizes = sizes || '(max-width: 500px) calc(100vw - 40px), 460px';
  const active = () => presentations.get(image) === state;
  function apply() {
    state.loadedUrl = null;
    image.style.opacity = '0';
    renderPhotoCredit(credit, null);
    const candidate = candidates[state.index];
    if (!candidate) {
      image.style.opacity = '0';
      renderPhotoCredit(credit, null);
      state.unavailable = true;
      state.onUnavailable?.();
      return;
    }
    image.alt = candidate.photo?.alt || result.imageAlt || `Scene for SineDay ${result.day}`;
    if (candidate.photo) {
      image.srcset = photoSrcSet(candidate.photo);
      image.dataset.photoId = candidate.photo.id;
    } else {
      image.removeAttribute('srcset');
      delete image.dataset.photoId;
    }
    image.src = candidate.src;
  }
  image.onerror = () => {
    if (!active()) return;
    state.index++;
    apply();
  };
  image.onload = async () => {
    const index = state.index;
    try { await image.decode(); } catch { /* Already loaded images can still display. */ }
    if (!active() || index !== state.index || !image.naturalWidth) return;
    image.style.opacity = '1';
    renderPhotoCredit(credit, candidates[index].photo || null);
    state.loadedUrl = image.currentSrc || image.src;
    state.onLoad?.(state.loadedUrl);
  };
  apply();
}
