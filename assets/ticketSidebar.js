/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* global ZAFClient */
'use strict';

class Sidebar {
  constructor() {
    this.#show('state-loading');

    this.#init().catch((err) => {
      console.error('[AMO widget] init error:', err);
    });
  }

  #show(state) {
    ['state-loading', 'state-no-credentials', 'state-not-found', 'state-error', 'profile-card'].forEach(id => document.getElementById(id).classList.add('hidden'));
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

    const baseUrl = (settings.amoBaseUrl || 'https://addons.mozilla.org').replace(/\/$/, '');
    const amo = new AMOClient(client, baseUrl, settings.amoApiKeyId);

    let user;
    try {
      user = await amo.lookupByEmail(requesterEmail);
    } catch (err) {
      this.#text('error-detail', err.message);
      this.#show('state-error');
      return;
    }

    if (!user) {
      this.#text('not-found-detail', `No AMO account found for "${requesterEmail}".`);
      this.#show('state-not-found');
      return;
    }

    const avatar = document.getElementById('profile-avatar');
    if (user.picture_url) {
      avatar.src = user.picture_url;
      avatar.alt = user.name;
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

    document.getElementById('amo-profile-link').href = `${baseUrl}/en-US/firefox/user/${user.id}/`;

    this.#show('profile-card');
  }

  #text(id, value) {
    document.getElementById(id).textContent = value;
  }
}

new Sidebar();
