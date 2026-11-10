# SineDay introduction video

The homepage `#watch-sineday` panel presents the user-approved 98-second silent portrait cut. It uses native details/video controls and `preload="none"`, without autoplay. Closing the panel pauses playback. The transcript provides the visible captions and describes the app sequence without repeating profile names or journal contents.

The 8,162,231-byte H.264 MP4 is versioned at `/assets/video/sineday-intro-2026-11-09.mp4`. Raw source remains in Drive. The service worker bypasses the entire video asset directory and video requests so native byte-range seeking is not intercepted or placed in Cache Storage. The video is not precached.

## Verification
- Three focused video tests pass: opt-in markup/transcript, range-request SW bypass, close/navigation pause.
- Full suite: 476 pass, seven fail, one skipped. All seven failures also reproduce against unchanged main source (cache-v38 assertions, login copy, Discover cache expectation, and analytics callback assertions). No baseline failures were suppressed.
- MP4 size matches the approved Drive metadata. Duration 98.033 seconds. Git blob identity ab21cc97a098bc1aa1ea0790d786a09b84dd76c8.
- Interactive browser QA could not run: system Chromium fails to create its process socket; the cloud browser cannot reach local preview. Downloading the locked headless shell returned invalid ZIP content. Desktop/mobile appearance, native playback/seek and close/reopen should be verified in the PR preview before merge. Production CDN 206 range response remains to verify after deployment.

Merge/deployment is not performed by this change. Deploy the app before the blog companion change, whose video assets point here.
