// Leave media unloaded until the visitor opens the panel and starts playback.
// The native details/video controls remain usable without JavaScript.
for (const panel of document.querySelectorAll('[data-intro-video]')) {
  const video = panel.querySelector('video');
  panel.addEventListener('toggle', () => {
    if (!panel.open) video?.pause();
  });
  window.addEventListener('pagehide', () => video?.pause());
}
