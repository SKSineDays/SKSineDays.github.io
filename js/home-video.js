// Progressive enhancement: without dialog support/JS, links open the MP4 directly.
const dialog = document.getElementById('home-video-dialog');
const player = document.getElementById('home-video-player');
const title = document.getElementById('home-video-title');
const textLink = document.getElementById('home-video-text');
const directLink = document.getElementById('home-video-direct');
let opener = null;

if (dialog && player && typeof dialog.showModal === 'function') {
  const clearPlayer = () => {
    player.pause();
    player.removeAttribute('src');
    player.load();
  };
  for (const link of document.querySelectorAll('[data-home-video]')) {
    link.addEventListener('click', event => {
      // Keep browser-native modified-link interactions working.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      opener = link;
      clearPlayer();
      title.textContent = link.dataset.videoTitle;
      player.setAttribute('aria-label', link.dataset.videoTitle);
      player.poster = link.dataset.videoPoster;
      player.src = link.href;
      textLink.href = link.dataset.videoTranscript;
      directLink.href = link.href;
      dialog.showModal();
      dialog.querySelector('[data-video-close]').focus();
      // Do not autoplay. The visitor starts playback with the native controls.
    });
  }
  dialog.querySelector('[data-video-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    clearPlayer();
    opener?.focus();
  });
  window.addEventListener('pagehide', () => { if (dialog.open) dialog.close(); else clearPlayer(); });
}
