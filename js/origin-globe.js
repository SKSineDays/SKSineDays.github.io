const REFRESH_MS = 5 * 60 * 1000;
const emptyMembership = () => ({ enabled: false, regionKey: null });

// Owns only the ambient Earth and account participation; never reads private profiles.
export class OriginGlobe {
  constructor(host, controlsHost, { getAccessToken } = {}) {
    this.host = host;
    this.getAccessToken = getAccessToken;
    this.active = false;
    this.inViewport = false;
    this.destroyed = false;
    this.groups = [];
    this.requests = new Set();
    this.lastAttempt = 0;
    this.revision = 0;
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.paused = this.motion.matches;
    this.controls = document.createElement('div');
    this.controls.className = 'origin-globe-controls';
    this.controls.innerHTML = `
      <div class="origin-globe-actions"><button type="button" data-rotation disabled>Pause rotation</button><button type="button" data-participate disabled>Add my light</button></div>
      <p class="origin-globe-caption">Lights represent members who choose to appear. Locations are approximate.</p>
      <p class="origin-globe-status" data-status></p>
      <a class="origin-globe-credit" href="/docs/globe/credits.html" target="_blank" rel="noopener">Earth imagery: NASA · Map data: Natural Earth</a>`;
    controlsHost.append(this.controls);
    this.rotationButton = this.controls.querySelector('[data-rotation]');
    this.participateButton = this.controls.querySelector('[data-participate]');
    this.status = this.controls.querySelector('[data-status]');
    this.rotationButton.onclick = () => { this.paused = !this.paused; this.sync(); };
    this.participateButton.onclick = () => this.openMembership();
    this.onVisibility = () => this.sync();
    this.onMotion = () => { if (this.motion.matches) this.paused = true; this.sync(); };
    document.addEventListener('visibilitychange', this.onVisibility);
    this.motion.addEventListener('change', this.onMotion);
    this.observer = new IntersectionObserver(entries => {
      this.inViewport = entries[0].isIntersecting;
      this.sync();
    });
    this.observer.observe(host);
  }

  setActive(active) {
    this.active = Boolean(active);
    if (!this.active && this.dialog?.open) this.dialog.close();
    this.sync();
  }

  get visible() {
    return this.active && this.inViewport && document.visibilityState === 'visible' && !this.destroyed;
  }

  sync() {
    if (this.destroyed) return;
    clearTimeout(this.refreshTimer);
    const visible = this.visible;
    if (visible && !this.started) {
      this.started = true;
      this.start();
    }
    const rotating = !this.paused && !this.motion.matches;
    this.rotationButton.textContent = rotating ? 'Pause rotation' : 'Play rotation';
    this.rotationButton.setAttribute('aria-label', rotating ? 'Pause Earth rotation' : 'Play Earth rotation');
    this.rotationButton.disabled = !this.renderer?.ready || this.motion.matches;
    if (this.motion.matches) {
      this.rotationButton.textContent = 'Rotation paused';
      this.rotationButton.setAttribute('aria-label', 'Earth rotation paused for reduced motion');
    }
    if (this.rendererUnavailable) {
      this.rotationButton.textContent = 'Still Earth';
      this.rotationButton.setAttribute('aria-label', 'Still Earth');
    }
    this.renderer?.setState(visible, rotating);
    if (!visible) {
      for (const request of this.requests) if (request.read) request.controller.abort();
      return;
    }
    if (this.started && this.getAccessToken) {
      const wait = Math.max(0, REFRESH_MS - (Date.now() - this.lastAttempt));
      this.refreshTimer = setTimeout(() => this.refresh(), wait);
    }
  }

  async start() {
    const fallback = new Image();
    fallback.alt = '';
    fallback.src = '/assets/globe/earth-still.webp';
    fallback.decoding = 'async';
    fallback.className = 'origin-earth-fallback';
    this.host.append(fallback);
    // Failure of either branch must not block the other or dashboard initialization.
    this.startRenderer();
    try {
      const catalog = await import('../shared/globe-regions.js');
      if (this.destroyed) return;
      this.catalog = catalog;
      this.participateButton.disabled = !this.getAccessToken;
    } catch {
      if (!this.destroyed) this.status.textContent = 'Member lights are temporarily unavailable.';
    }
  }

  async startRenderer() {
    try {
      const { EarthRenderer } = await import('./globe-renderer.js');
      if (this.destroyed) return;
      this.renderer = new EarthRenderer(this.host, { onUnavailable: () => {
        this.renderer = null;
        this.rendererUnavailable = true;
        this.sync();
      } });
      this.renderer.setData(this.groups);
      this.renderer.setState(this.visible, !this.paused && !this.motion.matches);
      await this.renderer.load();
      if (!this.destroyed) this.sync();
    } catch {
      this.renderer?.destroy();
      this.renderer = null;
      if (!this.destroyed) {
        this.rendererUnavailable = true;
        this.sync();
      }
    }
  }

  async request(path, { method = 'GET', body } = {}) {
    const controller = new AbortController();
    const request = { controller, read: method === 'GET' };
    this.requests.add(request);
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const token = await Promise.race([
        this.getAccessToken(),
        new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Request stopped')), { once: true }))
      ]);
      if (this.destroyed || controller.signal.aborted || !token) throw new Error('Request stopped');
      const response = await fetch(`/api/globe/${path}`, {
        method, signal: controller.signal, cache: 'no-store',
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      if (!response.ok) throw new Error('Member lights unavailable');
      const result = await response.json();
      if (this.destroyed || controller.signal.aborted) throw new Error('Request stopped');
      return result;
    } finally { clearTimeout(timeout); this.requests.delete(request); }
  }

  async refresh() {
    if (!this.visible || this.refreshing || this.saving) return;
    this.refreshing = true;
    const revision = this.revision;
    this.lastAttempt = Date.now();
    try {
      const snapshot = await this.request('groups');
      if (!Array.isArray(snapshot.groups)) throw new Error('Invalid snapshot');
      if (this.destroyed || !this.visible || revision !== this.revision) return;
      this.groups = snapshot.groups;
      this.renderer?.setData(this.groups);
      this.status.textContent = this.groups.some(g => g.count > 0) ? '' : 'No member lights yet. Participation is optional.';
    } catch {
      if (!this.destroyed && this.visible && revision === this.revision) {
        this.groups = [];
        this.renderer?.setData([]);
        this.status.textContent = 'Member lights are temporarily unavailable.';
      }
    } finally {
      this.refreshing = false;
      if (!this.membership && this.visible) await this.loadMembership();
      if (!this.destroyed) this.sync();
    }
  }

  async loadMembership() {
    if (this.loadingMembership) return this.loadingMembership;
    this.loadingMembership = (async () => {
      try {
        const result = await this.request('me');
        this.membership = result.membership;
        this.participateButton.textContent = this.membership.enabled ? 'Manage my light' : 'Add my light';
        return true;
      } catch { return false; }
      finally { this.loadingMembership = null; }
    })();
    return this.loadingMembership;
  }

  async openMembership() {
    if (this.destroyed || !this.catalog || this.opening) return;
    this.opening = true;
    this.participateButton.disabled = true;
    if (!this.membership && !await this.loadMembership()) {
      if (!this.destroyed) this.status.textContent = 'Unable to load your light. Please try again.';
    } else if (!this.destroyed && this.active) {
      this.buildDialog();
      this.select.value = this.membership.regionKey || '';
      this.checkbox.checked = this.membership.enabled;
      this.removeButton.hidden = !this.membership.enabled;
      this.message.textContent = '';
      this.dialog.showModal();
      this.select.focus();
    }
    if (!this.destroyed) this.participateButton.disabled = false;
    this.opening = false;
  }

  buildDialog() {
    if (this.dialog) return;
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'origin-globe-dialog';
    this.dialog.setAttribute('aria-labelledby', 'globe-dialog-title');
    this.dialog.innerHTML = `
      <form><h2 id="globe-dialog-title">Add a light to the SineDay globe.</h2>
      <p>Choose a broad region. Other members will see a light nearby, without your name or exact location.</p>
      <label for="globe-region">Country or territory</label><select id="globe-region"><option value="">Choose a region</option></select>
      <label class="origin-globe-consent"><input type="checkbox"> Show my light</label>
      <p class="origin-globe-note">Optional, for your account only. This does not share your family profiles or indicate that you are online. Locations are self-selected and approximate; they do not verify residency or guarantee anonymity. Other viewers’ snapshots refresh within five minutes while visible.</p>
      <p data-message role="status"></p><div class="origin-globe-dialog-actions"><button type="submit">Save light</button><button type="button" data-remove>Remove my light</button><button type="button" data-close>Cancel</button></div></form>`;
    this.select = this.dialog.querySelector('select');
    for (const region of this.catalog.GLOBE_REGIONS) this.select.add(new Option(region.name, region.key));
    this.checkbox = this.dialog.querySelector('input');
    this.message = this.dialog.querySelector('[data-message]');
    this.removeButton = this.dialog.querySelector('[data-remove]');
    this.dialog.querySelector('form').onsubmit = event => { event.preventDefault(); this.save(!this.checkbox.checked); };
    this.removeButton.onclick = () => this.save(true);
    this.dialog.querySelector('[data-close]').onclick = () => this.dialog.close();
    this.dialog.addEventListener('cancel', event => { if (this.saving) event.preventDefault(); });
    this.dialog.addEventListener('close', () => { if (this.active && !this.destroyed) this.participateButton.focus(); });
    document.body.append(this.dialog);
  }

  async save(remove) {
    if (this.saving || this.destroyed) return;
    if (!remove && !this.catalog.GLOBE_REGION_BY_KEY.has(this.select.value)) {
      this.message.textContent = 'Choose a country or territory before showing your light.';
      this.select.focus();
      return;
    }
    this.saving = true;
    this.revision += 1;
    // A pre-save response must never restore an opted-out light.
    for (const request of this.requests) if (request.read) request.controller.abort();
    const controls = [...this.dialog.querySelectorAll('button, input, select')];
    controls.forEach(control => { control.disabled = true; });
    this.message.textContent = 'Saving…';
    const previous = this.membership || emptyMembership();
    try {
      const result = await this.request('me', remove ? { method: 'DELETE' } : {
        method: 'PUT', body: { enabled: true, regionKey: this.select.value, consentVersion: this.catalog.GLOBE_CONSENT_VERSION }
      });
      if (this.destroyed) return;
      this.membership = result.membership;
      // Apply only a confirmed account change to the caller's in-memory snapshot.
      const counts = new Map(this.groups.map(group => [group.regionKey, group.count]));
      if (previous.enabled) counts.set(previous.regionKey, Math.max(0, (counts.get(previous.regionKey) || 0) - 1));
      if (this.membership.enabled) counts.set(this.membership.regionKey, (counts.get(this.membership.regionKey) || 0) + 1);
      this.groups = [...counts].filter(([,count]) => count > 0).map(([regionKey,count]) => ({ regionKey,count }));
      this.renderer?.setData(this.groups);
      this.participateButton.textContent = this.membership.enabled ? 'Manage my light' : 'Add my light';
      this.status.textContent = remove ? 'Your light has been removed.' : 'Your light is saved. Thank you for being here.';
      this.lastAttempt = Date.now();
      this.dialog.close();
    } catch {
      if (!this.destroyed) this.message.textContent = 'We could not confirm the change. Please try again; your saved state has not been replaced here.';
    } finally {
      this.saving = false;
      controls.forEach(control => { control.disabled = false; });
      if (!this.destroyed) this.sync();
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this.refreshTimer);
    for (const request of this.requests) request.controller.abort();
    this.requests.clear();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.motion.removeEventListener('change', this.onMotion);
    this.observer.disconnect();
    this.renderer?.destroy();
    this.dialog?.remove();
    this.controls.remove();
    this.host.replaceChildren();
    this.groups = [];
    this.membership = null;
  }
}
