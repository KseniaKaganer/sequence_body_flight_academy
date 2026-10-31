(() => {
  'use strict';
  const tabs = [...document.querySelectorAll('[data-license-tab]')];
  function select(tab, focus = false) {
    tabs.forEach(item => {
      const active = item === tab;
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
      document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
    });
    if (focus) tab.focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', event => {
      let target;
      const rtl = document.documentElement.dir === 'rtl';
      if (event.key === 'ArrowRight') target = (index + (rtl ? -1 : 1) + tabs.length) % tabs.length;
      if (event.key === 'ArrowLeft') target = (index + (rtl ? 1 : -1) + tabs.length) % tabs.length;
      if (event.key === 'Home') target = 0;
      if (event.key === 'End') target = tabs.length - 1;
      if (target === undefined) return;
      event.preventDefault();
      select(tabs[target], true);
    });
  });
})();
