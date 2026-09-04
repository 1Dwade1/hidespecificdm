/**
 * @name HideSpecificDM
 * @author QUANTIK
 * @description Скрывает выбранных пользователей из списка личных сообщений.
 * @version 1.0.0
 */

module.exports = class HideSpecificDM {
    constructor() {
        this.observer = null;
        this.interval = null;
        this.retryInterval = null;
        this.defaultSettings = { hiddenUsers: [] };
        this.ChannelStore = null;
        this.UserStore = null;
    }

    log(...args) {
        console.log('%c[HideSpecificDM]', 'color: #7289da; font-weight: bold;', ...args);
    }

    getSettings() {
        const raw = BdApi.Data.load('HideSpecificDM', 'settings');
        return Object.assign({}, this.defaultSettings, raw);
    }

    saveSettings(settings) {
        BdApi.Data.save('HideSpecificDM', 'settings', settings);
    }

    isHidden(userId) {
        return this.getSettings().hiddenUsers.some(u => u.id === userId);
    }

    addHiddenUser(userId) {
        const settings = this.getSettings();
        if (settings.hiddenUsers.some(u => u.id === userId)) return;
        const user = this.UserStore?.getUser?.(userId);
        settings.hiddenUsers.push({
            id: userId,
            username: user ? (user.globalName || user.username) : null,
            avatar: user?.avatar ? `https://cdn.discordapp.com/avatars/${userId}/${user.avatar}.png?size=64` : null
        });
        this.saveSettings(settings);
        this.refresh();
    }

    removeHiddenUser(userId) {
        const settings = this.getSettings();
        settings.hiddenUsers = settings.hiddenUsers.filter(u => u.id !== userId);
        this.saveSettings(settings);
        this.refresh();
    }

    refresh() {
        this.updateCSS();
        this.applyHidingFallback();
    }

    findStore(names, predicate) {
        for (const name of names) {
            try {
                const s = BdApi.Webpack.getStore?.(name);
                if (s) return s;
            } catch (e) {}
        }
        if (predicate) {
            try { return BdApi.Webpack.getModule(predicate); } catch (e) {}
        }
        return null;
    }

    start() {
        this.ChannelStore = this.findStore(['ChannelStore'], m => m?.getChannel && m?.getDMFromUserId);
        this.UserStore = this.findStore(['UserStore'], m => m?.getUser && m?.getCurrentUser);
        this.log('ChannelStore найден:', !!this.ChannelStore, '| UserStore найден:', !!this.UserStore);

        this.injectBaseCSS();
        this.updateCSS();

        this.observer = new MutationObserver(() => this.applyHidingFallback());
        this.tryAttachObserver();

        this.interval = setInterval(() => this.refresh(), 2000);
    }

    stop() {
        if (this.observer) this.observer.disconnect();
        if (this.interval) clearInterval(this.interval);
        if (this.retryInterval) clearInterval(this.retryInterval);

        BdApi.DOM.removeStyle('HideSpecificDM');
        BdApi.DOM.removeStyle('HideSpecificDM-base');
        document.querySelectorAll('.hsdm-hidden, .hsdm-fading')
            .forEach(el => el.classList.remove('hsdm-hidden', 'hsdm-fading'));
    }

    tryAttachObserver() {
        const container = this.getContainer();
        if (container) {
            this.observer.observe(container, { childList: true, subtree: true });
            this.applyHidingFallback();
            this.log('Наблюдатель подключён к списку ЛС.');
        } else {
            this.retryInterval = setInterval(() => {
                const c = this.getContainer();
                if (c) {
                    clearInterval(this.retryInterval);
                    this.retryInterval = null;
                    this.observer.observe(c, { childList: true, subtree: true });
                    this.applyHidingFallback();
                    this.log('Наблюдатель подключён к списку ЛС (после ожидания).');
                }
            }, 1000);
        }
    }

    getContainer() {
        return document.querySelector('[data-list-id="private-channels"]')
            || document.querySelector('nav[aria-label] ul[class*="scroller"]')
            || document.querySelector('[class*="privateChannels"]');
    }

    injectBaseCSS() {
        BdApi.DOM.addStyle('HideSpecificDM-base', `
            .hsdm-fading {
                transition: opacity .15s ease, max-height .2s ease, margin .2s ease, transform .2s ease;
                opacity: 0;
                max-height: 0 !important;
                overflow: hidden;
                transform: scaleY(0.9);
            }
        `);
    }

    updateCSS() {
        const settings = this.getSettings();
        if (!this.ChannelStore) this.ChannelStore = this.findStore(['ChannelStore'], m => m?.getChannel && m?.getDMFromUserId);

        let css = `.hsdm-hidden { display: none !important; }`;

        if (this.ChannelStore && settings.hiddenUsers.length) {
            settings.hiddenUsers.forEach(({ id }) => {
                const channelId = this.ChannelStore.getDMFromUserId?.(id);
                if (channelId) {
                    css += `\nli:has(a[href$="/channels/@me/${channelId}"]) { display: none !important; }`;
                }
            });
        }

        BdApi.DOM.addStyle('HideSpecificDM', css);
    }

    applyHidingFallback() {
        const settings = this.getSettings();
        const container = this.getContainer();
        if (!container || !this.ChannelStore) return;

        const hiddenIds = settings.hiddenUsers.map(u => u.id);
        const links = container.querySelectorAll('a[href*="/channels/@me/"]');
        links.forEach(link => {
            const match = link.href.match(/\/channels\/@me\/(\d+)/);
            if (!match) return;

            const channel = this.ChannelStore.getChannel(match[1]);
            if (!channel) return;

            const recipientIds = channel.recipients || [];
            const shouldHide = recipientIds.some(id => hiddenIds.includes(id));

            const row = link.closest('li') || link.closest('[role="listitem"]') || link.parentElement;
            if (row) row.classList.toggle('hsdm-hidden', shouldHide);
        });
    }

    getSettingsPanel() {
        const settings = this.getSettings();

        const panel = document.createElement('div');
        panel.style.cssText = 'padding: 4px 2px; color: var(--text-normal); font-size: 14px;';

        const heading = document.createElement('div');
        heading.textContent = 'Скрытые пользователи';
        heading.style.cssText = 'font-weight: 600; font-size: 16px; margin-bottom: 4px;';
        panel.appendChild(heading);

        const hint = document.createElement('div');
        hint.textContent = 'Найдите пользователя по имени или ID и добавьте в список скрытых.';
        hint.style.cssText = 'color: var(--text-muted); font-size: 12px; margin-bottom: 14px; line-height: 1.5;';
        panel.appendChild(hint);

        const searchWrap = document.createElement('div');
        searchWrap.style.cssText = 'position: relative; margin-bottom: 16px;';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Имя пользователя или ID…';
        input.style.cssText = `
            width: 100%; box-sizing: border-box; padding: 10px 12px;
            border-radius: 8px; border: 1px solid var(--background-modifier-accent);
            background: var(--background-secondary); color: var(--text-normal);
            outline: none; font-size: 14px;
        `;
        searchWrap.appendChild(input);

        const suggestions = document.createElement('div');
        suggestions.style.cssText = `
            position: absolute; top: calc(100% + 4px); left: 0; right: 0;
            background: var(--background-floating, var(--background-secondary));
            border-radius: 8px; box-shadow: var(--elevation-high, 0 4px 12px rgba(0,0,0,.3));
            max-height: 220px; overflow-y: auto; z-index: 100; display: none;
        `;
        searchWrap.appendChild(suggestions);
        panel.appendChild(searchWrap);

        const renderSuggestions = (query) => {
            suggestions.innerHTML = '';
            if (!query) { suggestions.style.display = 'none'; return; }

            if (/^\d{15,20}$/.test(query)) {
                suggestions.appendChild(this.buildSuggestionRow(
                    { id: query, username: this.UserStore?.getUser?.(query)?.username || `ID: ${query}`, avatar: null },
                    () => { this.addHiddenUser(query); input.value = ''; suggestions.style.display = 'none'; renderList(); }
                ));
                suggestions.style.display = 'block';
                return;
            }

            let matches = [];
            try {
                const all = this.UserStore?.getUsers?.() || {};
                const q = query.toLowerCase();
                matches = Object.values(all)
                    .filter(u => u?.username?.toLowerCase().includes(q) || u?.globalName?.toLowerCase().includes(q))
                    .slice(0, 8);
            } catch (e) {}

            if (!matches.length) { suggestions.style.display = 'none'; return; }

            matches.forEach(u => {
                suggestions.appendChild(this.buildSuggestionRow(
                    {
                        id: u.id,
                        username: u.globalName || u.username,
                        avatar: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=32` : null
                    },
                    () => { this.addHiddenUser(u.id); input.value = ''; suggestions.style.display = 'none'; renderList(); }
                ));
            });
            suggestions.style.display = 'block';
        };

        input.addEventListener('input', () => renderSuggestions(input.value.trim()));
        input.addEventListener('blur', () => setTimeout(() => { suggestions.style.display = 'none'; }, 150));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && /^\d{15,20}$/.test(input.value.trim())) {
                this.addHiddenUser(input.value.trim());
                input.value = '';
                suggestions.style.display = 'none';
                renderList();
            }
        });

        const listWrap = document.createElement('div');
        listWrap.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
        panel.appendChild(listWrap);

        const emptyState = document.createElement('div');
        emptyState.textContent = 'Пока никто не скрыт.';
        emptyState.style.cssText = 'color: var(--text-muted); font-size: 13px; padding: 12px 0;';

        const renderList = () => {
            const current = this.getSettings().hiddenUsers;
            listWrap.innerHTML = '';

            if (!current.length) {
                listWrap.appendChild(emptyState);
                return;
            }

            current.forEach(u => {
                const row = document.createElement('div');
                row.style.cssText = `
                    display: flex; align-items: center; gap: 10px;
                    padding: 8px 10px; border-radius: 8px;
                    background: var(--background-secondary-alt, var(--background-secondary));
                `;

                const avatar = document.createElement('div');
                avatar.style.cssText = `
                    width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;
                    background: var(--background-modifier-accent) center/cover no-repeat;
                    ${u.avatar ? `background-image: url(${u.avatar});` : ''}
                `;
                row.appendChild(avatar);

                const label = document.createElement('div');
                label.style.cssText = 'flex: 1; min-width: 0;';
                const name = document.createElement('div');
                name.textContent = u.username || 'Неизвестный пользователь';
                name.style.cssText = 'font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
                const id = document.createElement('div');
                id.textContent = u.id;
                id.style.cssText = 'font-size: 11px; color: var(--text-muted); font-family: var(--font-code, monospace);';
                label.appendChild(name);
                label.appendChild(id);
                row.appendChild(label);

                const removeBtn = document.createElement('button');
                removeBtn.textContent = '✕';
                removeBtn.title = 'Показать снова';
                removeBtn.style.cssText = `
                    background: transparent; border: none; color: var(--text-muted);
                    cursor: pointer; font-size: 14px; padding: 6px 8px; border-radius: 6px;
                `;
                removeBtn.onmouseenter = () => { removeBtn.style.background = 'var(--background-modifier-hover)'; removeBtn.style.color = 'var(--status-danger, #ed4245)'; };
                removeBtn.onmouseleave = () => { removeBtn.style.background = 'transparent'; removeBtn.style.color = 'var(--text-muted)'; };
                removeBtn.onclick = () => {
                    this.removeHiddenUser(u.id);
                    renderList();
                    BdApi.UI.showToast('Пользователь снова виден', { type: 'info' });
                };
                row.appendChild(removeBtn);

                listWrap.appendChild(row);
            });
        };

        renderList();
        return panel;
    }

    buildSuggestionRow(user, onClick) {
        const row = document.createElement('div');
        row.style.cssText = `
            display: flex; align-items: center; gap: 8px;
            padding: 8px 10px; cursor: pointer;
        `;
        row.onmouseenter = () => { row.style.background = 'var(--background-modifier-hover)'; };
        row.onmouseleave = () => { row.style.background = 'transparent'; };
        row.onmousedown = (e) => { e.preventDefault(); onClick(); };

        const avatar = document.createElement('div');
        avatar.style.cssText = `
            width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0;
            background: var(--background-modifier-accent) center/cover no-repeat;
            ${user.avatar ? `background-image: url(${user.avatar});` : ''}
        `;
        row.appendChild(avatar);

        const label = document.createElement('span');
        label.textContent = user.username;
        label.style.cssText = 'font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
        row.appendChild(label);

        return row;
    }
};
