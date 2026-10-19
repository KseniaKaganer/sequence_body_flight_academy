/* Admin session handoff between the two owned production sites.
 * Session tokens travel only in an origin- and window-checked postMessage.
 * URLs contain a short-lived nonce, never access or refresh tokens.
 */
(() => {
  const SEQUENCE = 'https://sequence-body-flight-academy.pages.dev';
  const TRAVEL = 'https://shakshuka-travel.pages.dev';
  const PROTOCOL = 'sequence-admin-session-v1';
  const pending = new Map();
  const receiverTimeout = 30000;
  function openTravel(client, isAdmin, destination) {
    if (window.location.origin !== SEQUENCE || !isAdmin()) return null;
    const url = new URL(destination, TRAVEL);
    if (url.origin !== TRAVEL || !['/', '/index.html', '/admin.html'].includes(url.pathname)) return null;
    url.pathname = '/admin.html';
    const nonce = crypto.randomUUID(); url.hash = 'sequence-admin-handoff=' + nonce;
    const child = window.open(url.href, '_blank');
    if (!child) return null;
    const expire = setTimeout(() => pending.delete(nonce), receiverTimeout);
    const entry = { child, expire, client, isAdmin }; pending.set(nonce, entry);
    return child;
  }
  window.addEventListener('message', async event => {
    if (window.location.origin !== SEQUENCE || event.origin !== TRAVEL) return;
    const message = event.data;
    if (!message || message.protocol !== PROTOCOL || message.action !== 'ready' || typeof message.nonce !== 'string') return;
    const entry = pending.get(message.nonce);
    if (!entry || event.source !== entry.child) return;
    // Consume before awaiting so a second message cannot race this one.
    pending.delete(message.nonce); clearTimeout(entry.expire);
    try {
      if (!entry.isAdmin()) return;
      const { data: { session }, error } = await entry.client.auth.getSession();
      if (error || !session || !entry.isAdmin()) return;
      entry.child.postMessage({ protocol: PROTOCOL, action: 'session', nonce: message.nonce,
        access_token: session.access_token, refresh_token: session.refresh_token }, TRAVEL);
    } catch { /* The destination falls back to its usual login. */ }
  });
  function receive(client) {
    if (window.location.origin !== TRAVEL) return Promise.resolve(false);
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const nonce = fragment.get('sequence-admin-handoff');
    if (!nonce || !/^[0-9a-f-]{36}$/i.test(nonce)) return Promise.resolve(false);
    // Remove the nonce before routing, sharing or reloading this page.
    const clean = new URL(window.location.href); clean.hash = '';
    window.history.replaceState(null, '', clean.pathname + clean.search);
    if (!window.opener) return Promise.resolve(false);
    const parent = window.opener;
    return new Promise(resolve => {
      let finished = false, claimed = false;
      const cleanup = result => {
        if (finished) return; finished = true; clearTimeout(timer);
        window.removeEventListener('message', listener);
        try { window.opener = null; } catch {}
        resolve(result);
      };
      const listener = async event => {
        if (claimed || event.origin !== SEQUENCE || event.source !== parent) return;
        const message = event.data;
        if (!message || message.protocol !== PROTOCOL || message.action !== 'session' || message.nonce !== nonce
          || typeof message.access_token !== 'string' || !message.access_token
          || typeof message.refresh_token !== 'string' || !message.refresh_token) return;
        claimed = true; clearTimeout(timer);
        try {
          const { error } = await client.auth.setSession({ access_token: message.access_token, refresh_token: message.refresh_token });
          if (error) throw error;
          const { data: { user }, error: userError } = await client.auth.getUser();
          if (userError || !user) throw new Error('Invalid session');
          const { data: admin, error: adminError } = await client.rpc('is_admin');
          if (adminError || admin !== true) throw new Error('Not an admin');
          cleanup(true);
        } catch {
          await client.auth.signOut({ scope: 'local' }).catch(() => {}); cleanup(false);
        }
      };
      const timer = setTimeout(() => cleanup(false), receiverTimeout);
      window.addEventListener('message', listener);
      parent.postMessage({ protocol: PROTOCOL, action: 'ready', nonce }, SEQUENCE);
    });
  }
  window.SequenceAdminSession = Object.freeze({ openTravel, receive });
})();
