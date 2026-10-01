const REFRESH_MS = 5 * 60 * 1000;
const emptyMembership = () => ({ enabled: false, regionKey: null, cityKey: null });
const locationKey = group => `${group.regionKey}:${group.cityKey || ''}`;
const cityLabel = city => city.adminName && city.adminName !== city.name ? `${city.name}, ${city.adminName}` : city.name;
const searchText = value => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

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
      this.renderer.onCitiesUnavailable = () => { this.status.textContent = 'City lights are temporarily unavailable.'; };
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
      this.cityKey = this.membership.cityKey || null;
      this.locationChanged = false;
      this.restoreCity();
      this.checkbox.checked = this.membership.enabled;
      this.removeButton.hidden = !this.membership.enabled;
      this.message.textContent = '';
      this.dialog.showModal();
      this.select.focus();
      this.loadCities();
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
      <p>Choose a country and, optionally, a city. Other members see an approximate light, without your name or exact location.</p>
      <label for="globe-region">Country or territory</label><select id="globe-region"><option value="">Choose a region</option></select>
      <label for="globe-city">City <span>(optional)</span></label>
      <input id="globe-city" type="search" role="combobox" autocomplete="off" spellcheck="false" aria-autocomplete="list" aria-expanded="false" aria-controls="globe-city-list" aria-describedby="globe-city-help globe-city-status" placeholder="Search cities" disabled>
      <ul id="globe-city-list" class="origin-globe-city-list" role="listbox" aria-label="Cities" hidden></ul>
      <p id="globe-city-status" class="origin-globe-city-status" role="status"></p>
      <button type="button" data-country-only>Use country only</button><button type="button" data-retry-cities hidden>Retry cities</button>
      <p id="globe-city-help">Choose the city you’d like your light to represent. The light uses an approximate public city location, not your exact location. If your city isn’t listed, you can use your country only.</p>
      <label class="origin-globe-consent"><input type="checkbox"> Show my light</label>
      <p class="origin-globe-note">Your chosen country or city appears as an anonymous grouped light to signed-in members. Optional, for your account only; family profiles and online status stay private. A city is more specific than a country and does not guarantee anonymity or verify residency. Other viewers’ snapshots refresh within five minutes while visible.</p>
      <p data-message role="status"></p><div class="origin-globe-dialog-actions"><button type="submit">Save light</button><button type="button" data-remove>Remove my light</button><button type="button" data-close>Cancel</button></div></form>`;
    this.select = this.dialog.querySelector('select');
    for (const region of this.catalog.GLOBE_REGIONS) this.select.add(new Option(region.name, region.key));
    this.checkbox = this.dialog.querySelector('input[type="checkbox"]');
    this.cityInput = this.dialog.querySelector('#globe-city');
    this.cityList = this.dialog.querySelector('#globe-city-list');
    this.cityStatus = this.dialog.querySelector('#globe-city-status');
    this.retryCities = this.dialog.querySelector('[data-retry-cities]');
    this.select.onchange = () => { this.chooseCity(null); this.restoreCity(); };
    this.cityInput.oninput = () => {
      this.cityKey = null;
      this.locationChanged = true;
      this.checkbox.checked = false;
      this.renderCities();
    };
    this.cityInput.onfocus = () => this.renderCities();
    this.cityInput.onkeydown = event => {
      if (event.key === 'Escape' && !this.cityList.hidden) {
        event.preventDefault(); event.stopPropagation(); this.closeCities(); return;
      }
      if (event.key === 'Tab') { this.closeCities(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
      event.preventDefault();
      if (this.cityList.hidden) this.renderCities();
      if (event.key === 'Enter') {
        if (this.cityOptions[this.cityIndex]) this.chooseCity(this.cityOptions[this.cityIndex]);
        return;
      }
      const count = this.cityOptions.length;
      if (!count) return;
      this.cityIndex = (this.cityIndex + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
      [...this.cityList.querySelectorAll('[role="option"]')].forEach((option, index) => {
        option.setAttribute('aria-selected', String(index === this.cityIndex));
        if (index === this.cityIndex) { this.cityInput.setAttribute('aria-activedescendant', option.id); option.scrollIntoView({ block: 'nearest' }); }
      });
    };
    this.cityInput.onblur = () => this.closeCities();
    this.dialog.querySelector('[data-country-only]').onclick = () => { this.chooseCity(null); this.restoreCity(); };
    this.retryCities.onclick = () => this.loadCities(true);
    this.message = this.dialog.querySelector('[data-message]');
    this.removeButton = this.dialog.querySelector('[data-remove]');
    this.dialog.querySelector('form').onsubmit = event => {
      event.preventDefault();
      if (!this.checkbox.checked && (this.locationChanged || !this.membership.enabled)) {
        this.message.textContent = 'Check “Show my light” to share your chosen country or city.';
        this.checkbox.focus();
        return;
      }
      this.save(!this.checkbox.checked);
    };
    this.removeButton.onclick = () => this.save(true);
    this.dialog.querySelector('[data-close]').onclick = () => this.dialog.close();
    this.dialog.addEventListener('cancel', event => { if (this.saving) event.preventDefault(); });
    this.dialog.addEventListener('close', () => { if (this.active && !this.destroyed) this.participateButton.focus(); });
    document.body.append(this.dialog);
  }

  async loadCities(retry = false) {
    if (this.cities || this.loadingCities) return;
    this.cityStatus.textContent = 'Loading cities…';
    this.retryCities.hidden = true;
    this.citiesUnavailable = false;
    this.loadingCities = true;
    try {
      // Failed native-module fetches can stay cached for this page. Only an explicit
      // retry gets a new URL; successful normal loads share the renderer's module.
      const catalog = await import(retry ? `../shared/globe-cities.js?retry=${this.cityRetry = (this.cityRetry || 0) + 1}` : '../shared/globe-cities.js');
      if (this.destroyed) return;
      this.cities = catalog;
      if (this.renderer) {
        this.renderer.cities = catalog.GLOBE_CITY_BY_KEY;
        this.renderer.setData(this.groups);
        if (this.status.textContent === 'City lights are temporarily unavailable.') this.status.textContent = '';
      }
      if (!this.saving) this.restoreCity();
    } catch {
      if (!this.destroyed) {
        this.citiesUnavailable = true;
        this.cityStatus.textContent = 'Cities are temporarily unavailable. Your saved light is preserved; country-only selection still works.';
        this.retryCities.hidden = false;
      }
    } finally { this.loadingCities = false; }
  }

  restoreCity() {
    this.closeCities();
    const city = this.cities?.GLOBE_CITY_BY_KEY.get(this.cityKey);
    this.cityInput.value = city ? cityLabel(city) : '';
    this.cityInput.placeholder = this.cityKey && !this.cities ? (this.citiesUnavailable ? 'Saved city · unavailable' : 'Saved city · loading…') : 'Search cities';
    const available = this.cities?.GLOBE_CITIES_BY_REGION.get(this.select.value) || [];
    this.cityInput.disabled = !available.length;
    this.cityStatus.textContent = !this.select.value ? 'Choose a country or territory first.'
      : !this.cities ? (this.citiesUnavailable ? 'Cities are temporarily unavailable. Country-only selection still works.' : 'Loading cities…')
      : !available.length ? 'No cities are listed here yet. You can use your country or territory only.'
      : city ? `Selected: ${cityLabel(city)}.` : 'Country-only light unless you select a city.';
  }

  closeCities() {
    this.cityList.hidden = true;
    this.cityInput.setAttribute('aria-expanded', 'false');
    this.cityInput.removeAttribute('aria-activedescendant');
  }

  renderCities() {
    if (!this.cities || this.cityInput.disabled) return;
    const query = this.cityKey ? '' : searchText(this.cityInput.value.trim());
    const matches = (this.cities.GLOBE_CITIES_BY_REGION.get(this.select.value) || [])
      .filter(city => searchText(cityLabel(city)).includes(query));
    this.cityOptions = matches.slice(0, 20);
    this.cityIndex = -1;
    this.cityInput.removeAttribute('aria-activedescendant');
    this.cityList.replaceChildren();
    this.cityOptions.forEach((city, index) => {
      const item = document.createElement('li');
      item.setAttribute('role', 'presentation');
      const option = document.createElement('button');
      option.type = 'button'; option.tabIndex = -1; option.id = `globe-city-option-${index}`;
      option.setAttribute('role', 'option'); option.setAttribute('aria-selected', 'false');
      option.textContent = cityLabel(city);
      option.onmousedown = event => event.preventDefault();
      option.onclick = () => this.chooseCity(city);
      item.append(option); this.cityList.append(item);
    });
    this.cityList.hidden = false;
    this.cityInput.setAttribute('aria-expanded', 'true');
    this.cityStatus.textContent = !matches.length ? 'No matching city. You can use your country only.'
      : matches.length > 20 ? 'Showing the first 20 matches. Type more to narrow the list.'
      : `${matches.length} ${matches.length === 1 ? 'city' : 'cities'} available. Select one or use country only.`;
  }

  chooseCity(city) {
    this.cityKey = city?.key || null;
    this.cityInput.value = city ? cityLabel(city) : '';
    this.locationChanged = this.cityKey !== (this.membership.cityKey || null) || this.select.value !== this.membership.regionKey;
    if (this.locationChanged) this.checkbox.checked = false;
    this.closeCities();
    this.cityStatus.textContent = city ? `Selected: ${cityLabel(city)}. Check “Show my light” to save.` : 'Country-only light.';
  }

  async save(remove) {
    if (this.saving || this.destroyed) return;
    if (!remove && !this.catalog.GLOBE_REGION_BY_KEY.has(this.select.value)) {
      this.message.textContent = 'Choose a country or territory before showing your light.';
      this.select.focus();
      return;
    }
    if (!remove && this.cityInput.value.trim() && !this.cityKey) {
      this.message.textContent = 'Select a city from the list, or choose “Use country only”.';
      this.cityInput.focus();
      return;
    }
    this.saving = true;
    this.revision += 1;
    // A pre-save response must never restore an opted-out light.
    for (const request of this.requests) if (request.read) request.controller.abort();
    const controls = [...this.dialog.querySelectorAll('button, input, select')].map(control => ({ control, disabled: control.disabled }));
    controls.forEach(({ control }) => { control.disabled = true; });
    this.message.textContent = 'Saving…';
    const previous = this.membership || emptyMembership();
    try {
      const result = await this.request('me', remove ? { method: 'DELETE' } : {
        method: 'PUT', body: { enabled: true, regionKey: this.select.value, cityKey: this.cityKey,
          consentVersion: this.cityKey ? this.catalog.GLOBE_CITY_CONSENT_VERSION : this.catalog.GLOBE_CONSENT_VERSION }
      });
      if (this.destroyed) return;
      this.membership = result.membership;
      // Apply only a confirmed account change to the caller's in-memory snapshot.
      const counts = new Map(this.groups.map(group => [locationKey(group), { ...group }]));
      const adjust = (member, delta) => {
        if (!member.enabled) return;
        const key = locationKey(member);
        const group = counts.get(key) || { precision: member.cityKey ? 'city' : 'region', regionKey: member.regionKey, cityKey: member.cityKey || null, count: 0 };
        counts.set(key, { ...group, count: Math.max(0, group.count + delta) });
      };
      adjust(previous, -1); adjust(this.membership, 1);
      this.groups = [...counts.values()].filter(group => group.count > 0);
      this.renderer?.setData(this.groups);
      this.participateButton.textContent = this.membership.enabled ? 'Manage my light' : 'Add my light';
      this.status.textContent = remove ? 'Your light has been removed.' : 'Your light is saved. Thank you for being here.';
      this.lastAttempt = Date.now();
      this.dialog.close();
    } catch {
      if (!this.destroyed) this.message.textContent = 'We could not confirm the change. Please try again; your saved state has not been replaced here.';
    } finally {
      this.saving = false;
      controls.forEach(({ control, disabled }) => { control.disabled = disabled; });
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
