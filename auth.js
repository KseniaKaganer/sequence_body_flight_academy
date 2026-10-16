(() => {
  const el = id => document.getElementById(id);
  const status = (id, message) => { el(id).textContent = message; };
  const dialog = el('loginDialog');
  const form = el('loginForm');
  let client;
  let revision = 0;
  let verifiedAdmin = false;
  let participants = [];
  let selectedParticipantId = null;
  let participantLoad = 0;
  let activePage = 'home';
  function setPage(page) {
    if (!verifiedAdmin && page !== 'home') return;
    activePage = page;
    for (const name of ['home', 'participants', 'request']) {
      el(name + 'Page').hidden = name !== page;
    }
    document.querySelectorAll('[data-page]').forEach(button => {
      if (button.dataset.page === page) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (page === 'participants') loadParticipants();
  }
  function clearParticipantDetails() {
    selectedParticipantId = null;
    el('participantTitle').textContent = 'Participant details';
    el('participantDetails').replaceChildren();
    el('participantTable').hidden = true;
    el('participantEmpty').hidden = false;
  }
  function renderParticipantDetails(person) {
    el('participantTitle').textContent = [person.display_name, person.surname].filter(Boolean).join(' ');
    el('participantDetails').replaceChildren();
    el('participantEmpty').hidden = true;
    el('participantTable').hidden = false;
    for (const [label, value] of [
      ['Name', person.display_name], ['Surname', person.surname],
      ['Phone', person.phone], ['Email', person.email],
      ['Passport number', person.passport_number], ['Notes', person.notes]
    ]) {
      const row = document.createElement('tr');
      const term = document.createElement('th');
      const detail = document.createElement('td');
      term.scope = 'row';
      term.textContent = label;
      detail.textContent = value || '—';
      row.append(term, detail);
      el('participantDetails').append(row);
    }
  }
  function renderParticipants() {
    const query = el('participantSearch').value.trim().toLowerCase();
    const matches = participants.filter(person =>
      [person.display_name, person.surname, person.phone, person.email]
        .filter(Boolean).join(' ').toLowerCase().includes(query));
    if (!matches.some(person => person.id === selectedParticipantId)) clearParticipantDetails();
    el('participantsList').replaceChildren();
    for (const person of matches) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'participant-card';
      button.setAttribute('aria-pressed', String(person.id === selectedParticipantId));
      const name = document.createElement('span');
      name.className = 'participant-name';
      name.textContent = [person.display_name, person.surname].filter(Boolean).join(' ') || 'Unnamed participant';
      const contact = document.createElement('span');
      contact.className = 'participant-contact';
      contact.textContent = person.phone || person.email || 'No contact details';
      button.append(name, contact);
      button.addEventListener('click', () => {
        if (!verifiedAdmin) return;
        selectedParticipantId = person.id;
        // Update selection without replacing the focused list button.
        for (const row of el('participantsList').children) row.setAttribute('aria-pressed', 'false');
        button.setAttribute('aria-pressed', 'true');
        renderParticipantDetails(person);
      });
      el('participantsList').append(button);
    }
    status('participantsStatus', `${matches.length} of ${participants.length} participants`);
    if (!matches.length) {
      const empty = document.createElement('p');
      empty.className = 'participant-list-empty';
      empty.textContent = query ? 'No participants match your search.' : 'No participants found.';
      el('participantsList').append(empty);
    }
  }
  async function loadParticipants() {
    if (!verifiedAdmin) return;
    const request = ++participantLoad;
    status('participantsStatus', 'Loading participants…');
    try {
      const rows = [];
      // Page through all records instead of silently truncating at the API limit.
      for (let start = 0; ; start += 500) {
        const { data, error } = await client.from('participants')
          .select('id,display_name,surname,phone,email,passport_number,notes')
          .order('display_name').order('id').range(start, start + 499);
        if (error) throw error;
        if (!verifiedAdmin || request !== participantLoad) return;
        rows.push(...data);
        if (data.length < 500) break;
      }
      participants = rows;
      renderParticipants();
      const selected = participants.find(person => person.id === selectedParticipantId);
      if (selected) renderParticipantDetails(selected);
    } catch (error) {
      if (!verifiedAdmin || request !== participantLoad) return;
      participants = [];
      clearParticipantDetails();
      el('participantsList').replaceChildren();
      status('participantsStatus', 'Unable to load participants. Please refresh or log in again.');
    }
  }
  document.querySelectorAll('[data-page]').forEach(button => {
    button.addEventListener('click', () => setPage(button.dataset.page));
  });
  el('participantSearch').addEventListener('input', renderParticipants);
  el('refreshParticipants').addEventListener('click', loadParticipants);
  function showSignedOut() {
    verifiedAdmin = false;
    ++participantLoad;
    participants = [];
    el('participantsList').replaceChildren();
    clearParticipantDetails();
    el('participantSearch').value = '';
    status('participantsStatus', '');
    el('accountMenu').hidden = true;
    setPage('home');
    el('adminAccount').hidden = true;
    el('adminName').textContent = '';
    el('openLogin').hidden = false;
  }
  async function refreshAccount() {
    const current = ++revision;
    // Never trust a locally stored account or role to grant admin access.
    const { data: { session }, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!session) { showSignedOut(); return false; }
    const { data: { user }, error: userError } = await client.auth.getUser();
    if (userError) throw userError;
    const { data: admin, error } = await client.rpc('is_admin');
    if (error) throw error;
    if (current !== revision) return false;
    if (!user || admin !== true) {
      await client.auth.signOut({ scope: 'local' });
      showSignedOut();
      throw new Error('This account is not an administrator.');
    }
    const { data: record } = await client.from('admin_users')
      .select('display_name').eq('user_id', user.id).maybeSingle();
    if (current !== revision) return false;
    el('adminName').textContent = record?.display_name || user.user_metadata?.name
      || user.user_metadata?.full_name || user.user_metadata?.display_name || user.email;
    verifiedAdmin = true;
    el('accountMenu').hidden = false;
    el('openLogin').hidden = true;
    el('adminAccount').hidden = false;
    status('accountStatus', '');
    return true;
  }
  el('openLogin').addEventListener('click', () => dialog.showModal());
  el('closeLogin').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    el('loginPassword').value = '';
    status('loginStatus', '');
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    el('submitLogin').disabled = true;
    status('loginStatus', 'Signing in…');
    try {
      const { error } = await client.auth.signInWithPassword({
        email: el('loginEmail').value.trim(), password: el('loginPassword').value
      });
      if (error) throw error;
      if (await refreshAccount()) { form.reset(); dialog.close(); }
    } catch (error) {
      showSignedOut();
      status('loginStatus', error.message || 'Unable to log in. Please try again.');
    } finally { el('submitLogin').disabled = false; }
  });
  el('signOut').addEventListener('click', async () => {
    el('signOut').disabled = true;
    try {
      // Local logout does not unexpectedly revoke sessions on the other site.
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw error;
      ++revision;
      showSignedOut();
      status('accountStatus', '');
    } catch (error) { status('accountStatus', error.message || 'Unable to log out.'); }
    finally { el('signOut').disabled = false; }
  });
  async function init() {
    try {
      const config = window.SEQUENCE_CONFIG;
      if (!window.supabase || !config) throw new Error('Login is unavailable. Please refresh and try again.');
      client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
      // Defer API calls outside the auth callback to avoid the SDK's auth lock.
      client.auth.onAuthStateChange(event => {
        if (event === 'SIGNED_OUT') { ++revision; showSignedOut(); }
        if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          setTimeout(() => refreshAccount().catch(() => {
            showSignedOut(); status('accountStatus', 'Please log in again to verify your account.');
          }), 0);
        }
      });
      el('openLogin').disabled = false;
      await refreshAccount();
    } catch (error) {
      showSignedOut();
      status('accountStatus', error.message || 'Unable to check your login. Please try again.');
    }
  }
  init();
})();
