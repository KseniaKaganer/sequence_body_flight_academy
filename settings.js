(() => {
  'use strict';
  const root = document.documentElement;
  document.body.dataset.sequencePage = location.pathname.split('/').pop() || 'index.html';
  const dictionary = window.sequenceTranslations || {};
  const read = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
  const save = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Preferences still work when storage is blocked. */ } };
  let language = read('sequence-language', 'en');
  if (!['en', 'he', 'ru'].includes(language)) language = 'en';
  let theme = read('sequence-theme', 'dark') === 'light' ? 'light' : 'dark';
  const translate = text => dictionary[text]?.[language] || text;

  const host = document.createElement('div');
  host.className = 'sequence-settings';
  host.innerHTML = `<button type="button" class="settings-trigger" aria-haspopup="dialog" aria-controls="sequenceSettingsDialog"><span aria-hidden="true">⚙</span> <span>Settings</span></button>
    <dialog id="sequenceSettingsDialog" aria-labelledby="sequenceSettingsTitle">
      <form method="dialog"><button class="settings-close" aria-label="Close">×</button></form>
      <h2 id="sequenceSettingsTitle">Settings</h2>
      <label for="sequenceLanguage">Language</label>
      <select id="sequenceLanguage"><option value="en" lang="en">English</option><option value="he" lang="he">עברית</option><option value="ru" lang="ru">Русский</option></select>
      <p id="sequenceAppearance">Appearance</p>
      <div class="settings-themes" role="group" aria-labelledby="sequenceAppearance">
        <button type="button" data-theme-choice="light"><span aria-hidden="true">☀</span> <span>Light</span></button>
        <button type="button" data-theme-choice="dark"><span aria-hidden="true">☾</span> <span>Dark</span></button>
      </div>
    </dialog>`;
  const header = document.querySelector('.account-panel') || document.querySelector('header');
  (header || document.body).append(host);
  const dialog = host.querySelector('dialog');
  const trigger = host.querySelector('.settings-trigger');
  const select = host.querySelector('select');

  // Capture only interface text present at startup. Never translate participant
  // names, notes, or other records subsequently rendered by the admin application.
  const texts = [];
  const attributes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement.closest('script, style, [translate="no"], input, textarea')) continue;
    const key = node.nodeValue.trim();
    if (dictionary[key]) texts.push({ node, key, prefix: node.nodeValue.match(/^\s*/)[0], suffix: node.nodeValue.match(/\s*$/)[0] });
  }
  document.querySelectorAll('[placeholder], [aria-label], [title]').forEach(element => {
    for (const name of ['placeholder', 'aria-label', 'title']) {
      const key = element.getAttribute(name);
      if (dictionary[key]) attributes.push({ element, name, key });
    }
  });
  function applyLanguage() {
    root.lang = language;
    root.dir = language === 'he' ? 'rtl' : 'ltr';
    for (const item of texts) {
      // A replaced node belongs to the renderer now; leave application data alone.
      if (item.node.isConnected) item.node.nodeValue = item.prefix + translate(item.key) + item.suffix;
    }
    for (const item of attributes) item.element.setAttribute(item.name, translate(item.key));
    select.value = language;
  }
  function applyTheme() {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'light' ? '#f7f7f8' : '#000000';
    host.querySelectorAll('[data-theme-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme)));
  }
  trigger.addEventListener('click', () => dialog.showModal());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  select.addEventListener('change', () => { language = select.value; save('sequence-language', language); applyLanguage(); });
  host.querySelectorAll('[data-theme-choice]').forEach(button => button.addEventListener('click', () => { theme = button.dataset.themeChoice; save('sequence-theme', theme); applyTheme(); }));
  window.addEventListener('storage', event => {
    if (event.key === 'sequence-language') { language = ['en', 'he', 'ru'].includes(event.newValue) ? event.newValue : 'en'; applyLanguage(); }
    if (event.key === 'sequence-theme') { theme = event.newValue === 'light' ? 'light' : 'dark'; applyTheme(); }
  });
  applyLanguage();
  applyTheme();
})();
