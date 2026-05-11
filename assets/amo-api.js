/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* exported AMOClient */
'use strict';

class AMOClient {
  #zafClient;
  #baseUrl;
  #keyId;

  constructor(zafClient, baseUrl, keyId) {
    this.#zafClient = zafClient;
    this.#baseUrl = baseUrl;
    this.#keyId = keyId;
  }

  async #request(path, options = {}) {
    try {
      return await this.#zafClient.request({
        url: `${this.#baseUrl}${path}`,
        type: 'GET',
        ...options,
        secure: true,
        jwt: {
          algorithm: 'HS256',
          secret_key: '{{setting.amoApiSecret}}',
          claims: { iss: this.#keyId, jti: crypto.randomUUID() },
        },
        headers: { Authorization: 'JWT {{jwt.token}}', ...(options.headers || {}) },
      });
    } catch (err) {
      if (err.status === 404) return null;
      throw new Error(`AMO API ${err.status}: ${String(err.responseText || '').slice(0, 200)}`);
    }
  }

  async lookupByEmail(email) {
    const data = await this.#request(`/api/v5/accounts/account/lookup/?email=${encodeURIComponent(email)}`);
    return Array.isArray(data) ? data : [];
  }

  async getAccount(username) {
    return this.#request(`/api/v5/accounts/account/${encodeURIComponent(username)}/`);
  }

  async getAddonsByAuthor(author, { pageSize = 50, sort = 'users' } = {}) {
    const qs = new URLSearchParams({
      author: String(author),
      page_size: String(pageSize),
      sort,
    });
    return this.#request(`/api/v5/addons/search/?${qs}`);
  }

  async searchAddons(params) {
    const qs = new URLSearchParams({ page_size: '20', page: String(params.page || 1) });
    if (params.q)          qs.set('q', params.q);
    if (params.type)       qs.set('type', params.type);
    if (params.app)        qs.set('app', params.app);
    if (params.sort)       qs.set('sort', params.sort);
    if (params.promoted)   qs.set('promoted', params.promoted);
    if (params.min_users)  qs.set('users__gte', params.min_users);
    if (params.min_rating) qs.set('ratings__gte', params.min_rating);
    return this.#request(`/api/v5/addons/search/?${qs}`);
  }
}
