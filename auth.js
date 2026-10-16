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
  function setParticipantTab(tab, focus = false) {
    for (const name of ['Info', 'Skill']) {
      const selected = name.toLowerCase() === tab;
      const button = el('participant' + name + 'Tab');
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      el('participant' + name + 'Panel').hidden = !selected;
      if (selected && focus) button.focus();
    }
  }
  for (const name of ['Info', 'Skill']) {
    const button = el('participant' + name + 'Tab');
    button.addEventListener('click', () => setParticipantTab(name.toLowerCase()));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const tab = event.key === 'Home' ? 'info' : event.key === 'End' ? 'skill' : name === 'Info' ? 'skill' : 'info';
      setParticipantTab(tab, true);
    });
  }
  el('newRequest').addEventListener('click', () => {
    if (verifiedAdmin) el('requestDialog').showModal();
  });
  el('closeRequest').addEventListener('click', () => el('requestDialog').close());
  const participantFields = {
    display_name: 'editName', surname: 'editSurname', phone: 'editPhone',
    email: 'editEmail', passport_number: 'editPassport', notes: 'editNotes'
  };
  let editingParticipant = null;
  let savingParticipant = false;
  el('editParticipant').addEventListener('click', () => {
    const person = participants.find(person => person.id === selectedParticipantId);
    if (!verifiedAdmin || !person) return;
    editingParticipant = { ...person };
    for (const [field, input] of Object.entries(participantFields)) el(input).value = person[field] || '';
    status('editParticipantStatus', '');
    el('editParticipantDialog').showModal();
  });
  el('cancelParticipantEdit').addEventListener('click', () => {
    if (!savingParticipant) el('editParticipantDialog').close();
  });
  el('editParticipantDialog').addEventListener('cancel', event => {
    if (savingParticipant) event.preventDefault();
  });
  el('editParticipantDialog').addEventListener('close', () => {
    editingParticipant = null;
    el('editParticipantForm').reset();
    status('editParticipantStatus', '');
  });
  el('editParticipantForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!verifiedAdmin || !editingParticipant || savingParticipant) return;
    if (!el('editParticipantForm').reportValidity()) return;
    const original = { ...editingParticipant };
    const accountRevision = revision;
    const payload = {};
    const limits = { display_name: 150, surname: 150, phone: 40, email: 254, passport_number: 50, notes: 5000 };
    for (const [field, input] of Object.entries(participantFields)) {
      const value = el(input).value.trim();
      if (value.length > limits[field]) {
        status('editParticipantStatus', 'One of the fields is too long. Please shorten it.');
        return;
      }
      payload[field] = value || null;
    }
    if (!payload.display_name) {
      status('editParticipantStatus', 'Name is required.');
      el('editName').focus();
      return;
    }
    if (payload.phone && (!/^[+0-9().\s-]+$/.test(payload.phone) || !/\d/.test(payload.phone))) {
      status('editParticipantStatus', 'Please enter a valid phone number.');
      return;
    }
    savingParticipant = true;
    el('saveParticipant').disabled = true;
    el('cancelParticipantEdit').disabled = true;
    status('editParticipantStatus', 'Saving…');
    try {
      // RLS enforces admin access. Match the original values to avoid overwriting
      // changes saved from Shakshuka or another open browser tab.
      let update = client.from('participants').update(payload).eq('id', original.id);
      for (const field of Object.keys(participantFields)) {
        update = original[field] == null ? update.is(field, null) : update.eq(field, original[field]);
      }
      const { data, error } = await update
        .select('id,display_name,surname,phone,email,passport_number,notes').maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('The participant changed or is no longer available. Cancel, refresh the list, and try again.');
      if (!verifiedAdmin || revision !== accountRevision) return;
      ++participantLoad;
      participants = participants.map(person => person.id === data.id ? data : person);
      el('participantSearch').value = '';
      renderParticipants();
      if (selectedParticipantId === data.id) renderParticipantDetails(data);
      el('editParticipantDialog').close();
      status('participantsStatus', 'Participant details saved to the server.');
    } catch (error) {
      if (verifiedAdmin && revision === accountRevision) {
        status('editParticipantStatus', error.message || 'Unable to save. Your changes are still here; please try again.');
      }
    } finally {
      savingParticipant = false;
      el('saveParticipant').disabled = false;
      el('cancelParticipantEdit').disabled = false;
    }
  });
  function clearParticipantDetails() {
    el('participantTabs').hidden = true;
    el('participantInfoPanel').hidden = true;
    el('participantSkillPanel').hidden = true;
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
    el('participantTabs').hidden = false;
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
        const changed = selectedParticipantId !== person.id;
        selectedParticipantId = person.id;
        if (changed) setParticipantTab('info');
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
    el('requestDialog').close();
    el('editParticipantDialog').close();
    editingParticipant = null;
    el('editParticipantForm').reset();
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
