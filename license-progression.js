(() => {
  'use strict';
  const tasks = [...document.querySelectorAll('[data-license-task]')];
  let userId = null;
  let revision = 0;
  const decode = value => {
    try {
      const data = JSON.parse(value || '{}');
      if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
      // Existing Israeli jump/time tasks now form one requirement. Preserve
      // completion only if both old tasks were complete; explicit new values win.
      for (const license of ['a', 'b', 'c', 'd']) {
        const prefix = 'il-' + license;
        const combined = prefix + '-jumps-freefall';
        if (!(combined in data) && (prefix + '-jumps' in data || prefix + '-freefall' in data)) data[combined] = data[prefix + '-jumps'] === true && data[prefix + '-freefall'] === true;
      }
      if (!('il-a-jump-count' in data) && ('il-a-jumps-freefall' in data || 'il-a-jumps' in data)) {
        data['il-a-jump-count'] = data['il-a-jumps-freefall'] === true || data['il-a-jumps'] === true;
      }
      for (const key of ['a-check-dive', 'a-written', 'a-oral']) {
        if (!(key in data) && data['a-exams'] === true) data[key] = true;
      }
      return data;
    } catch { return {}; }
  };
  const key = () => userId ? 'sequence-license-checklist-v1:' + userId : null;
  const read = () => { try { return key() ? decode(localStorage.getItem(key())) : {}; } catch { return {}; } };
  const restore = progress => tasks.forEach(task => { task.checked = progress[task.dataset.licenseTask] === true; });
  function setAccount(id) {
    userId = id;
    document.documentElement.dataset.licenseTracking = id ? 'true' : 'false';
    tasks.forEach(task => { task.hidden = !id; task.disabled = !id; });
    restore(read());
  }
  setAccount(null);
  tasks.forEach(task => task.addEventListener('change', () => {
    if (!userId) { task.checked = false; return; }
    const progress = read();
    progress[task.dataset.licenseTask] = task.checked;
    try { localStorage.setItem(key(), JSON.stringify(progress)); } catch { /* Keep interaction available when storage is blocked. */ }
  }));
  window.addEventListener('storage', event => {
    if (userId && event.key === key()) restore(decode(event.newValue));
    if (event.key === null) restore({});
  });
  async function verifyAccount(client) {
    const current = ++revision;
    setAccount(null);
    try {
      // Use the same server-verified admin access policy as the main page.
      const { data: { user }, error } = await client.auth.getUser();
      if (error || !user) {
        const person = window.SequenceParticipant ? await window.SequenceParticipant.restore() : null;
        if (current === revision) setAccount(person ? 'participant:' + person.participant_id : null);
        return;
      }
      const { data: admin, error: roleError } = await client.rpc('is_admin');
      if (current === revision) setAccount(!roleError && admin === true ? user.id : null);
    } catch { if (current === revision) setAccount(null); }
  }
  const config = window.SEQUENCE_CONFIG;
  if (!window.supabase || !config) return;
  const client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
  if (window.SequenceParticipant) window.SequenceParticipant.setup(client);
  client.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT') { ++revision; setAccount(null); return; }
    if (['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) {
      // Avoid performing Supabase requests inside its auth lock.
      setTimeout(() => verifyAccount(client), 0);
    }
  });
  verifyAccount(client);
})();
