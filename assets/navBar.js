/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* global ZAFClient */
'use strict';

class NavBar {
  #client;
  #amo;
  #baseUrl;
  #currentPage = 1;
  #currentParams = {};
  #totalCount = 0;
  /** Selected add-ons, by add-on id — kept across pages and searches. */
  #selected = new Map();
  /** Last resolved author/email rows, ready for CSV download. */
  #exportRows = [];

  constructor() {
    this.#init().catch((err) => {
      console.error('[AMO outreach] init error:', err);
    });
  }

  async #init() {
    // Outside Zendesk (plain browser, for layout debugging) there is no client:
    // search still works, it only uses the public AMO API.
    this.#client = ZAFClient.init() || null;

    let settings = {};
    if (this.#client) {
      const metaData = await this.#client.metadata();
      settings = metaData.settings || {};
      await this.#client.invoke('resize', { width: '100%' });
    }
    this.#baseUrl = (settings.amoBaseUrl || 'https://addons.mozilla.org').replace(/\/$/, '');

    if (!settings.amoApiKeyId) {
      document.getElementById('state-no-credentials').classList.remove('hidden');
    }

    this.#amo = new AMOClient(this.#client, this.#baseUrl, settings.amoApiKeyId);

    await this.#loadBrands();

    document.getElementById('search-btn').addEventListener('click', () => this.#performSearch(1));
    document.getElementById('search-q').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.#performSearch(1);
    });
    document.getElementById('page-prev').addEventListener('click', () => this.#performSearch(this.#currentPage - 1));
    document.getElementById('page-next').addEventListener('click', () => this.#performSearch(this.#currentPage + 1));
    document.getElementById('create-btn').addEventListener('click', () => this.#performCreateTickets());
    document.getElementById('clear-selection').addEventListener('click', () => this.#clearSelection());
    document.getElementById('export-btn').addEventListener('click', () => this.#performExportEmails());
    document.getElementById('export-download').addEventListener('click', () => this.#downloadCsv());
  }

  async #loadBrands() {
    const select = document.getElementById('ticket-brand');
    try {
      if (!this.#client) throw new Error('no ZAF client');
      const data = await this.#client.request({ url: '/api/v2/brands.json', type: 'GET' });
      const brands = (data.brands || []).filter((b) => b.active);
      for (const brand of brands) {
        const opt = document.createElement('option');
        opt.value = brand.id;
        opt.textContent = brand.name;
        select.appendChild(opt);
      }
    } catch (_) {
      // brands unavailable, fall back to default
    }
    const saved = localStorage.getItem('amo-outreach-brand');
    if (saved) select.value = saved;
    select.addEventListener('change', () => {
      localStorage.setItem('amo-outreach-brand', select.value);
    });
  }

  async #performSearch(page = 1) {
    this.#currentPage = page;
    this.#currentParams = { ...this.#getSearchParams(), page };

    document.getElementById('results-section').classList.add('hidden');
    document.getElementById('search-error').classList.add('hidden');
    document.getElementById('search-loading').classList.remove('hidden');

    try {
      const data = await this.#amo.searchAddons(this.#currentParams);
      this.#totalCount = data.count || 0;

      const totalPages = Math.ceil(this.#totalCount / 20) || 1;

      document.getElementById('search-loading').classList.add('hidden');
      document.getElementById('results-section').classList.remove('hidden');
      document.getElementById('results-count').textContent = `${this.#totalCount.toLocaleString()} add-on${this.#totalCount !== 1 ? 's' : ''} found`;
      document.getElementById('page-info').textContent = `${page} / ${totalPages}`;
      document.getElementById('page-prev').disabled = page <= 1;
      document.getElementById('page-next').disabled = page >= totalPages;

      this.#renderResultsList(data.results || []);
      this.#updateComposeSection();
    } catch (err) {
      document.getElementById('search-loading').classList.add('hidden');
      document.getElementById('search-error').classList.remove('hidden');
      document.getElementById('search-error-detail').textContent = err.message;
    }
  }

  #getSearchParams() {
    return {
      q:          document.getElementById('search-q').value.trim(),
      type:       document.getElementById('filter-type').value,
      app:        document.getElementById('filter-app').value,
      sort:       document.getElementById('filter-sort').value,
      promoted:   document.getElementById('filter-promoted').value,
      min_users:  document.getElementById('filter-min-users').value,
      min_rating: document.getElementById('filter-min-rating').value,
    };
  }

  #renderResultsList(addons) {
    const list = document.getElementById('results-list');
    list.innerHTML = '';

    if (addons.length === 0) {
      list.insertAdjacentHTML('beforeend', '<div class="hint" style="padding:12px 0">No add-ons found.</div>');
      return;
    }

    for (const addon of addons) {
      const author = addon.authors?.[0];
      if (!author) continue;

      const addonId    = String(addon.id ?? addon.slug);
      const addonName  = this.#addonDisplayName(addon);
      const addonUrl   = `${this.#baseUrl}/addon/${this.#escapeAttr(addon.slug)}/`;
      const profileUrl = author.url || `${this.#baseUrl}/user/${author.id}/`;
      const users      = this.#formatNumber(addon.average_daily_users);
      const rating     = addon.ratings?.average != null
        ? Number(addon.ratings.average).toFixed(1) : '—';

      list.insertAdjacentHTML('beforeend', `
        <label class="addon-item">
          <input type="checkbox" class="addon-checkbox"
            data-addon-id="${this.#escapeAttr(addonId)}"
            data-author-id="${this.#escapeAttr(String(author.id))}"
            data-author-username="${this.#escapeAttr(author.username)}"
            data-author-name="${this.#escapeAttr(author.name)}"
            data-addon-name="${this.#escapeAttr(addonName)}"
            data-addon-url="${this.#escapeAttr(addonUrl)}"
            data-amo-profile-url="${this.#escapeAttr(profileUrl)}"
            ${this.#selected.has(addonId) ? 'checked' : ''}
          >
          <div class="addon-info">
            <div class="addon-name">${this.#escapeHtml(addonName)}</div>
            <div class="addon-meta">
              <span class="addon-author">${this.#escapeHtml(author.name)}</span>
              <span class="addon-stat">${users} users</span>
              <span class="addon-stat">★ ${rating}</span>
            </div>
          </div>
        </label>
      `);
    }

    list.querySelectorAll('.addon-checkbox').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) {
          this.#selected.set(cb.dataset.addonId, {
            authorId:       cb.dataset.authorId,
            authorUsername: cb.dataset.authorUsername,
            authorName:     cb.dataset.authorName,
            addonName:      cb.dataset.addonName,
            addonUrl:       cb.dataset.addonUrl,
            amoProfileUrl:  cb.dataset.amoProfileUrl,
          });
        } else {
          this.#selected.delete(cb.dataset.addonId);
        }
        this.#updateComposeSection();
      });
    });
  }

  #updateComposeSection() {
    const sel = this.#getSelectedItems();
    const unique = this.#getUniqueAuthors(sel);

    document.getElementById('create-btn').disabled = unique.length === 0;
    document.getElementById('export-btn').disabled = unique.length === 0;
    document.getElementById('clear-selection').classList.toggle('hidden', sel.length === 0);
    document.getElementById('selected-count').textContent = unique.length === 0
      ? 'No add-ons selected.'
      : `${unique.length} unique author${unique.length > 1 ? 's' : ''} selected` +
        ` (${sel.length} add-on${sel.length > 1 ? 's' : ''})`;
  }

  #clearSelection() {
    this.#selected.clear();
    document.querySelectorAll('.addon-checkbox:checked').forEach((cb) => {
      cb.checked = false;
    });
    document.getElementById('export-results').classList.add('hidden');
    this.#updateComposeSection();
  }

  /**
   * Resolves the email address of every selected author, without creating any
   * ticket. The result is shown as a plain list and offered as a CSV download.
   */
  async #performExportEmails() {
    const sel = this.#getSelectedItems();
    const authors = this.#getUniqueAuthors(sel);
    if (authors.length === 0) return;

    document.getElementById('export-results').classList.add('hidden');
    document.getElementById('export-loading').classList.remove('hidden');
    document.getElementById('export-btn').disabled = true;

    const rows = [];
    const failures = [];
    for (const author of authors) {
      const addons = sel
        .filter((item) => item.authorId === author.authorId)
        .map((item) => item.addonName);

      try {
        const profile = await this.#amo.getAccount(author.authorUsername);
        const email = profile?.email;

        if (!email) {
          failures.push({ author, msg: 'Email not available (requires Users:Lookup permission on AMO)' });
          continue;
        }

        rows.push({
          name:       author.authorName,
          username:   author.authorUsername,
          email,
          profileUrl: author.amoProfileUrl,
          addons:     addons.join('; '),
        });
      } catch (err) {
        failures.push({ author, msg: err.message });
      }
    }

    document.getElementById('export-loading').classList.add('hidden');
    this.#updateComposeSection();
    this.#renderExportResults(rows, failures);
  }

  #renderExportResults(rows, failures) {
    this.#exportRows = rows;

    document.getElementById('export-count').textContent =
      `${rows.length} email address${rows.length === 1 ? '' : 'es'}`;
    document.getElementById('export-download').disabled = rows.length === 0;
    document.getElementById('export-list').value = rows.map((r) => r.email).join('\n');

    document.getElementById('export-errors').innerHTML = failures.map(({ author, msg }) => `
      <div class="create-result create-result-err">
        ✗ <strong>${this.#escapeHtml(author.authorName)}</strong> — ${this.#escapeHtml(msg)}
      </div>
    `).join('');

    document.getElementById('export-results').classList.remove('hidden');
  }

  #downloadCsv() {
    if (this.#exportRows.length === 0) return;

    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [
      ['name', 'username', 'email', 'amo_profile_url', 'selected_addons'].join(','),
      ...this.#exportRows.map((r) => [r.name, r.username, r.email, r.profileUrl, r.addons].map(esc).join(',')),
    ].join('\n');

    // Leading BOM so spreadsheets read the file as UTF-8.
    const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `amo-outreach-emails-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Give the download a chance to start before dropping the blob.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  #getSelectedItems() {
    return Array.from(this.#selected.values());
  }

  #getUniqueAuthors(items) {
    const seen = new Set();
    return items.filter(({ authorId }) => {
      if (seen.has(authorId)) return false;
      seen.add(authorId);
      return true;
    });
  }

  async #performCreateTickets() {
    const authors = this.#getUniqueAuthors(this.#getSelectedItems());
    if (authors.length === 0) return;

    const subjectTmpl = document.getElementById('ticket-subject').value;
    const bodyTmpl    = document.getElementById('ticket-body').value;

    document.getElementById('create-results').classList.add('hidden');
    document.getElementById('create-loading').classList.remove('hidden');
    document.getElementById('create-btn').disabled = true;

    const results = [];
    for (const author of authors) {
      try {
        const profile = await this.#amo.getAccount(author.authorUsername);
        const email = profile?.email;

        if (!email) {
          results.push({ author, ok: false, msg: 'Email not available (requires Users:Lookup permission on AMO)' });
          continue;
        }

        const vars = {
          author_name:     author.authorName,
          author_username: author.authorUsername,
          addon_name:      author.addonName,
          addon_url:       author.addonUrl,
          amo_profile_url: author.amoProfileUrl,
        };

        await this.#client.request({
          url: '/api/v2/tickets.json',
          type: 'POST',
          contentType: 'application/json',
          data: JSON.stringify({
            ticket: {
              requester: { email, name: author.authorName },
              subject:   this.#applyTemplate(subjectTmpl, vars),
              comment:   { body: this.#applyTemplate(bodyTmpl, vars) },
              tags:      ['amo-outreach'],
              ...(document.getElementById('ticket-brand').value
                ? { brand_id: Number(document.getElementById('ticket-brand').value) }
                : {}),
            },
          }),
        });

        results.push({ author, ok: true });
      } catch (err) {
        results.push({ author, ok: false, msg: err.message });
      }
    }

    document.getElementById('create-loading').classList.add('hidden');
    this.#updateComposeSection();

    const resultsEl = document.getElementById('create-results');
    resultsEl.innerHTML = results.map(({ author, ok, msg }) => `
      <div class="create-result ${ok ? 'create-result-ok' : 'create-result-err'}">
        ${ok ? '✓' : '✗'} <strong>${this.#escapeHtml(author.authorName)}</strong>
        ${ok ? '— ticket created' : `— ${this.#escapeHtml(msg)}`}
      </div>
    `).join('');
    resultsEl.classList.remove('hidden');
  }

  #applyTemplate(tmpl, vars) {
    return tmpl
      .replace(/\{\{author_name\}\}/g,     vars.author_name     || '')
      .replace(/\{\{author_username\}\}/g, vars.author_username || '')
      .replace(/\{\{addon_name\}\}/g,      vars.addon_name      || '')
      .replace(/\{\{addon_url\}\}/g,       vars.addon_url       || '')
      .replace(/\{\{amo_profile_url\}\}/g, vars.amo_profile_url || '');
  }

  #escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  #escapeAttr(str) {
    return String(str).replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  #formatNumber(n) {
    if (n == null) return '—';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}k`;
    return String(n);
  }

  #addonDisplayName(addon) {
    if (!addon.name) return addon.slug;
    return typeof addon.name === 'object'
      ? (addon.name['en-US'] || addon.name.en_US || Object.values(addon.name)[0])
      : addon.name;
  }
}

new NavBar();
