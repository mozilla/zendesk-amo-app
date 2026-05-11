/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* global ZAFClient */
'use strict';

class Sidebar {
  #amo;
  #baseUrl;
  #matches;

  constructor() {
    this.#show('state-loading');

    this.#init().catch((err) => {
      console.error('[AMO widget] init error:', err);
    });
  }

  #show(state) {
    ['state-loading', 'state-no-credentials', 'state-not-found', 'state-error', 'state-multi-match', 'profile-card'].forEach(id => document.getElementById(id).classList.add('hidden'));
    document.getElementById(state).classList.remove('hidden');
  }

  async #init() {
    const client = ZAFClient.init();
    await client.invoke('resize', { width: '100%', height: '500px' });

    const metaData = await client.metadata();
    const settings = metaData.settings || {};

    let requesterEmail = '';
    try {
      const data = await client.get('ticket.requester.email');
      requesterEmail = data['ticket.requester.email'] || '';
    } catch (_) {
      // ticket context might not be available yet
    }

    document.getElementById('requester-email').textContent = requesterEmail || '(no email)';

    if (!requesterEmail) {
      this.#text('not-found-detail', 'This ticket has no requester email.');
      this.#show('state-not-found');
      return;
    }

    if (!settings.amoApiKeyId) {
      this.#show('state-no-credentials');
      return;
    }

    this.#baseUrl = (settings.amoBaseUrl || 'https://addons.mozilla.org').replace(/\/$/, '');
    this.#amo = new AMOClient(client, this.#baseUrl, settings.amoApiKeyId);

    let users;
    try {
      users = await this.#amo.lookupByEmail(requesterEmail);
    } catch (err) {
      this.#text('error-detail', err.message);
      this.#show('state-error');
      return;
    }

    if (users.length === 0) {
      this.#text('not-found-detail', `No AMO account found for "${requesterEmail}".`);
      this.#show('state-not-found');
      return;
    }

    if (users.length === 1) {
      this.#renderProfile(users[0], false);
      return;
    }

    this.#matches = users;
    this.#renderMatchList();
  }

  #renderMatchList() {
    const users = this.#matches;
    this.#text('multi-match-count', `${users.length} AMO accounts`);

    const list = document.getElementById('multi-match-list');
    list.innerHTML = '';
    users.forEach((user, idx) => {
      list.insertAdjacentHTML('beforeend', this.#matchRowHtml(user, idx));
    });

    const activate = (ev) => {
      const row = ev.target.closest('[data-match-index]');
      if (!row) return;
      if (ev.type === 'keydown' && ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      const user = users[Number(row.dataset.matchIndex)];
      if (user) this.#renderProfile(user, true);
    };
    list.onclick = activate;
    list.onkeydown = activate;

    this.#show('state-multi-match');
  }

  #matchRowHtml(user, idx) {
    const name = this.#esc(user.name || user.username || '(no name)');
    const addons = user.num_addons_listed ?? 0;
    const since = user.created ? new Date(user.created).getFullYear() : '—';
    const avatar = user.picture_url
      ? `<img class="match-avatar" src="${this.#esc(user.picture_url)}" alt="">`
      : `<div class="match-avatar"></div>`;

    const meta = [];
    if (user.username) meta.push(`@${this.#esc(user.username)}`);
    meta.push(`${addons} add-on${addons === 1 ? '' : 's'}`);
    meta.push(`since ${since}`);
    meta.push(`id ${user.id}`);

    return `
      <div class="match-row" data-match-index="${idx}" role="button" tabindex="0">
        ${avatar}
        <div class="match-body">
          <div class="match-name">${name}</div>
          <div class="match-meta">${meta.join(' · ')}</div>
        </div>
      </div>
    `;
  }

  #renderProfile(user, showBackLink) {
    const backLink = document.getElementById('back-to-matches');
    if (showBackLink) {
      backLink.classList.remove('hidden');
      backLink.onclick = (ev) => {
        ev.preventDefault();
        this.#renderMatchList();
      };
    } else {
      backLink.classList.add('hidden');
      backLink.onclick = null;
    }

    const avatar = document.getElementById('profile-avatar');
    if (user.picture_url) {
      avatar.src = user.picture_url;
      avatar.alt = user.name;
      avatar.style.display = '';
    } else {
      avatar.src = '';
      avatar.alt = '';
      avatar.style.display = 'none';
    }

    this.#text('profile-name', user.name);

    const badgesEl = document.getElementById('profile-badges');
    badgesEl.innerHTML = '';
    if (user.is_addon_developer) badgesEl.insertAdjacentHTML('beforeend', '<span class="badge badge-dev">Add-on developer</span>');
    if (user.is_artist) badgesEl.insertAdjacentHTML('beforeend', '<span class="badge badge-artist">Theme artist</span>');

    this.#text('stat-addons', user.num_addons_listed ?? '—');
    this.#text('stat-rating', user.average_addon_rating != null
      ? Number(user.average_addon_rating).toFixed(1)
      : '—');
    this.#text('stat-since', user.created
      ? new Date(user.created).getFullYear()
      : '—');

    const bioEl = document.getElementById('profile-bio');
    if (user.biography) {
      bioEl.textContent = user.biography;
      bioEl.classList.remove('hidden');
    } else {
      bioEl.classList.add('hidden');
    }

    const linksEl = document.getElementById('profile-links');
    linksEl.innerHTML = '';
    if (user.homepage) {
      const escapedHomepage = String(user.homepage).replace(/"/g, '&quot;').replace(/</g, '&lt;');
      linksEl.insertAdjacentHTML(
        'beforeend',
        `<a href="${escapedHomepage}" target="_blank" rel="noopener">🔗 Homepage</a>`,
      );
    }

    document.getElementById('amo-profile-link').href = `${this.#baseUrl}/en-US/firefox/user/${user.id}/`;

    this.#show('profile-card');

    this.#renderAddons(this.#amo, user, this.#baseUrl).catch((err) => {
      console.error('[AMO widget] addon list error:', err);
    });
  }

  async #renderAddons(amo, user, baseUrl) {
    const section  = document.getElementById('addons-section');
    const list     = document.getElementById('addons-list');
    const empty    = document.getElementById('addons-empty');
    const errorEl  = document.getElementById('addons-error');
    const badge    = document.getElementById('addons-count-badge');

    section.classList.remove('hidden');
    list.innerHTML = '';
    empty.classList.add('hidden');
    errorEl.classList.add('hidden');
    badge.textContent = '…';

    let data;
    try {
      data = await amo.getAddonsByAuthor(user.id);
    } catch (err) {
      badge.textContent = '!';
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
      return;
    }

    const results = (data && data.results) || [];
    badge.textContent = String(results.length);

    if (results.length === 0) {
      empty.classList.remove('hidden');
      return;
    }

    for (const addon of results) {
      list.insertAdjacentHTML('beforeend', this.#addonRowHtml(addon, baseUrl));
    }
  }

  #addonRowHtml(addon, baseUrl) {
    const name    = this.#localized(addon.name) || addon.slug || '(unnamed)';
    const url     = addon.url || `${baseUrl}/en-US/firefox/addon/${encodeURIComponent(addon.slug)}/`;
    const icon    = addon.icon_url || '';
    const type    = this.#typeLabel(addon.type);
    const users   = (addon.average_daily_users ?? 0).toLocaleString();
    const ratingAvg   = addon.ratings && addon.ratings.average != null
      ? Number(addon.ratings.average).toFixed(1) : null;
    const ratingCount = addon.ratings && addon.ratings.count != null
      ? addon.ratings.count : 0;
    const version = addon.current_version && addon.current_version.version;
    const updated = addon.last_updated
      ? new Date(addon.last_updated).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
      : null;
    const status  = (addon.status && addon.status !== 'public') ? addon.status : null;

    const meta = [];
    meta.push(`<span>${users} users</span>`);
    if (ratingAvg) meta.push(`<span>★ ${ratingAvg} (${ratingCount.toLocaleString()})</span>`);
    if (version)   meta.push(`<span>v${this.#esc(version)}</span>`);
    if (updated)   meta.push(`<span>${this.#esc(updated)}</span>`);

    const iconImg = icon
      ? `<img class="addons-list-icon" src="${this.#esc(icon)}" alt="">`
      : `<div class="addons-list-icon"></div>`;

    const statusBadge = status
      ? `<span class="addons-status-badge">${this.#esc(status)}</span>`
      : '';

    return `
      <div class="addons-list-row">
        ${iconImg}
        <div class="addons-list-body">
          <div class="addons-list-title">
            <a class="addons-list-name" href="${this.#esc(url)}" target="_blank" rel="noopener" title="${this.#esc(name)}">${this.#esc(name)}</a>
            <span class="addons-type-badge">${this.#esc(type)}</span>
            ${statusBadge}
          </div>
          <div class="addons-list-meta">${meta.join('<span class="sep">·</span>')}</div>
        </div>
      </div>
    `;
  }

  #localized(field) {
    if (!field) return '';
    if (typeof field === 'string') return field;
    return field['en-US'] ?? Object.values(field)[0] ?? '';
  }

  #typeLabel(type) {
    const map = {
      extension: 'Extension',
      statictheme: 'Theme',
      dictionary: 'Dictionary',
      language: 'Language pack',
      lpapp: 'Language pack',
      search: 'Search',
      siteperm: 'Site permission',
    };
    return map[type] || type || '—';
  }

  #esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  #text(id, value) {
    document.getElementById(id).textContent = value;
  }
}

new Sidebar();
