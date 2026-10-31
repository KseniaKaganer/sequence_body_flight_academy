(() => {
  'use strict';
  window.SequenceGoogleLogin = {
    setup(client) {
      const button = document.getElementById('googleLogin');
      const status = document.getElementById('loginStatus');
      if (!button) return;
      button.disabled = false;
      button.addEventListener('click', async () => {
        if (button.disabled) return;
        button.disabled = true;
        status.textContent = 'Opening Google sign-in…';
        try {
          const config = window.SEQUENCE_CONFIG;
          const response = await fetch(new URL('/auth/v1/settings', config.supabaseUrl).href, {
            headers: { apikey: config.supabaseAnonKey }
          });
          if (!response.ok) throw new Error('Unable to check Google sign-in availability.');
          const settings = await response.json();
          if (settings.external?.google !== true) throw new Error('Google provider is not enabled.');
          // Return only to this site's login page, never forward query strings or
          // auth hashes to Google. Supabase processes the returned session and
          // refreshAccount still verifies getUser() and is_admin server-side.
          const redirectTo = new URL('index.html', window.location.href);
          const { error } = await client.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: redirectTo.href, queryParams: { prompt: 'select_account' } }
          });
          if (error) throw error;
        } catch (error) {
          const unavailable = /provider.*(?:not enabled|disabled)|unsupported provider/i.test(error.message || '');
          status.textContent = unavailable
            ? 'Google sign-in is not available yet. Please use email and password.'
            : 'Unable to open Google sign-in. Please try again or use email and password.';
        } finally { button.disabled = false; }
      });
      const query = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(window.location.hash.slice(1));
      if (query.has('error') || hash.has('error')) {
        const cancelled = (query.get('error') || hash.get('error')) === 'access_denied';
        document.getElementById('loginDialog').showModal();
        status.textContent = cancelled ? 'Google sign-in was cancelled. Please try again or use email and password.' : 'Google sign-in could not be completed. Please try again or use email and password.';
        // Do not leave OAuth error parameters in navigation history.
        const clean = new URL(window.location.href);
        for (const key of ['error', 'error_code', 'error_description']) clean.searchParams.delete(key);
        if (hash.has('error')) clean.hash = '';
        window.history.replaceState(null, '', clean.href);
      }
    }
  };
})();
