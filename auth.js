(() => {
  const el = id => document.getElementById(id);
  const status = (id, message) => { el(id).textContent = message; };
  const dialog = el('loginDialog');
  const form = el('loginForm');
  let client;
  let revision = 0;
  let verifiedAdmin = false;
  let participants = [];
  let participantRecords = [];
  function normalizedParticipantPhone(value) {
    return String(value || '').replace(/\D/g, '').replace(/^0+/, '');
  }
  function groupParticipantRecords(records) {
    const groups = new Map();
    for (const person of records) {
      const phone = normalizedParticipantPhone(person.phone);
      // Never combine unrelated records with no usable phone number.
      const key = phone ? 'phone:' + phone : 'id:' + person.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(person);
    }
    return [...groups.values()].map(group => {
      group.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      return { ...group[0], recordIds: group.map(person => person.id),
        searchText: group.map(person => [person.display_name, person.surname, person.phone, person.email].filter(Boolean).join(' ')).join(' ') };
    }).sort((a, b) => [a.display_name, a.surname].join(' ').localeCompare([b.display_name, b.surname].join(' '), undefined, { sensitivity: 'base' }));
  }
  let selectedParticipantId = null;
  let participantLoad = 0;
  let activePage = 'home';
  let activeParticipantTab = 'skill';
  function readRoute() {
    let parts;
    try { parts = window.location.hash.slice(1).split('/').map(decodeURIComponent); }
    catch { return { page: 'home', participant: null, tab: 'skill' }; }
    const page = ['participants', 'requests', 'events'].includes(parts[0]) ? parts[0] : 'home';
    return { page: page === 'requests' ? 'request' : page,
      participant: page === 'participants' ? parts[1] || null : null,
      tab: parts[2] === 'info' ? 'info' : 'skill' };
  }
  function writeRoute() {
    let hash = activePage === 'request' ? '#requests' : '#' + activePage;
    if (activePage === 'participants' && selectedParticipantId) {
      hash += '/' + encodeURIComponent(selectedParticipantId) + '/' + activeParticipantTab;
    }
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
  }
  function restoreRoute() {
    const route = readRoute();
    if (!verifiedAdmin) { setPage('home', false); return; }
    setPage(route.page, false);
  }
  window.addEventListener('popstate', restoreRoute);
  window.addEventListener('hashchange', restoreRoute);
  function setPage(page, updateUrl = true) {
    if (!verifiedAdmin && page !== 'home') return;
    activePage = page;
    for (const name of ['home', 'participants', 'request', 'events']) {
      el(name + 'Page').hidden = name !== page;
    }
    document.querySelectorAll('[data-page]').forEach(button => {
      if (button.dataset.page === page) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (updateUrl) writeRoute();
    if (page === 'participants') loadParticipants();
    if (page === 'events') { loadEventParticipants(); loadTravelEvents(); }
  }
  function setParticipantTab(tab, focus = false, updateUrl = true) {
    activeParticipantTab = tab;
    for (const name of ['Skill', 'Info']) {
      const selected = name.toLowerCase() === tab;
      const button = el('participant' + name + 'Tab');
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      el('participant' + name + 'Panel').hidden = !selected;
      if (selected && focus) button.focus();
    }
    if (updateUrl && selectedParticipantId) writeRoute();
  }
  for (const name of ['Skill', 'Info']) {
    const button = el('participant' + name + 'Tab');
    button.addEventListener('click', () => setParticipantTab(name.toLowerCase()));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const tab = event.key === 'Home' ? 'skill' : event.key === 'End' ? 'info' : name === 'Info' ? 'skill' : 'info';
      setParticipantTab(tab, true);
    });
  }
  el('newRequest').addEventListener('click', () => {
    if (verifiedAdmin) el('requestDialog').showModal();
  });
  el('closeRequest').addEventListener('click', () => el('requestDialog').close());
  let skillRequest = 0;
  let manualSkillRequest = 0;
  let manualSkillParticipant = null;
  let savingManualSkill = false;
  async function loadManualSkills(participantId) {
    if (!verifiedAdmin) return;
    const request = ++manualSkillRequest;
    const ids = participants.find(person => person.id === participantId)?.recordIds || [participantId];
    el('manualSkillHistory').replaceChildren();
    status('manualSkillStatus', 'Loading manual skills…');
    try {
      const rows = [];
      for (let start = 0; ; start += 500) {
        const { data, error } = await client.from('participant_manual_skills')
          .select('id,skill_name,skill_date,notes').in('participant_id', ids)
          .order('skill_date', { ascending: false, nullsFirst: false }).order('id').range(start, start + 499);
        if (error) throw error;
        if (!verifiedAdmin || request !== manualSkillRequest || selectedParticipantId !== participantId) return;
        rows.push(...data);
        if (data.length < 500) break;
      }
      status('manualSkillStatus', '');
      if (rows.length) el('manualSkillHistory').append(historyTable(`Manual Skills (${rows.length})`,
        ['Skill', 'Date', 'Notes'], rows.map(row => [row.skill_name,
          row.skill_date ? row.skill_date.split('-').reverse().join('/') : '—', row.notes])));
    } catch (error) {
      if (verifiedAdmin && request === manualSkillRequest && selectedParticipantId === participantId) {
        status('manualSkillStatus', error.code === 'PGRST205' || error.code === '42P01'
          ? 'Manual skills need database setup: run database/participant-manual-skills.sql in Supabase.'
          : 'Unable to load manual skills. Use Refresh above.');
      }
    }
  }
  el('addManualSkill').addEventListener('click', () => {
    if (!verifiedAdmin || !selectedParticipantId) return;
    manualSkillParticipant = selectedParticipantId;
    el('manualSkillForm').reset();
    status('manualSkillFormStatus', '');
    el('manualSkillDialog').showModal();
  });
  el('cancelManualSkill').addEventListener('click', () => {
    if (!savingManualSkill) el('manualSkillDialog').close();
  });
  el('manualSkillDialog').addEventListener('cancel', event => {
    if (savingManualSkill) event.preventDefault();
  });
  el('manualSkillDialog').addEventListener('close', () => {
    manualSkillParticipant = null;
    el('manualSkillForm').reset();
    status('manualSkillFormStatus', '');
  });
  el('manualSkillForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!verifiedAdmin || !manualSkillParticipant || savingManualSkill) return;
    if (!el('manualSkillForm').reportValidity()) return;
    const skill = el('manualSkillName').value.trim();
    const notes = el('manualSkillNotes').value.trim();
    const date = el('manualSkillDate').value;
    if (!skill || skill.length > 150 || notes.length > 5000) {
      status('manualSkillFormStatus', 'Enter a skill name of up to 150 characters and notes of up to 5000 characters.');
      return;
    }
    const participantId = manualSkillParticipant;
    const accountRevision = revision;
    savingManualSkill = true;
    el('saveManualSkill').disabled = true;
    el('cancelManualSkill').disabled = true;
    status('manualSkillFormStatus', 'Saving…');
    try {
      const { data, error } = await client.from('participant_manual_skills').insert({
        participant_id: participantId, skill_name: skill, skill_date: date || null, notes: notes || null
      }).select('id').single();
      if (error) throw error;
      if (!data) throw new Error('Unable to verify that the skill was saved.');
      if (!verifiedAdmin || revision !== accountRevision) return;
      el('manualSkillDialog').close();
      if (selectedParticipantId === participantId) await loadManualSkills(participantId);
    } catch (error) {
      if (verifiedAdmin && revision === accountRevision) status('manualSkillFormStatus',
        error.code === 'PGRST205' || error.code === '42P01'
          ? 'Run database/participant-manual-skills.sql in Supabase before saving skills.'
          : error.message || 'Unable to save. Please try again.');
    } finally {
      savingManualSkill = false;
      el('saveManualSkill').disabled = false;
      el('cancelManualSkill').disabled = false;
    }
  });
  function historyTable(title, headers, rows) {
    const section = document.createElement('section');
    const heading = document.createElement('h3');
    heading.textContent = title;
    section.append(heading);
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No records found.';
      section.append(empty);
      return section;
    }
    const table = document.createElement('table');
    table.className = 'skill-history-table';
    const head = document.createElement('thead');
    const header = document.createElement('tr');
    for (const label of headers) {
      const cell = document.createElement('th');
      cell.scope = 'col'; cell.textContent = label; header.append(cell);
    }
    head.append(header); table.append(head);
    const body = document.createElement('tbody');
    for (const values of rows) {
      const row = document.createElement('tr');
      for (const value of values) {
        const cell = document.createElement('td');
        cell.textContent = value || '—'; row.append(cell);
      }
      body.append(row);
    }
    table.append(body); section.append(table);
    return section;
  }
  async function loadSkillHistory(participantId) {
    if (!verifiedAdmin) return;
    const recordIds = participants.find(person => person.id === participantId)?.recordIds || [participantId];
    const request = ++skillRequest;
    const current = () => verifiedAdmin && selectedParticipantId === participantId && request === skillRequest;
    el('skillHistory').replaceChildren();
    status('skillStatus', 'Loading event and canopy history…');
    try {
      const memberships = [];
      for (let start = 0; ; start += 500) {
        const { data, error } = await client.from('event_participants')
          .select('id,event_id,participant_status,events(id,name,start_date,end_date,status,event_type)')
          .in('participant_id', recordIds).order('id').range(start, start + 499);
        if (error) throw error;
        if (!current()) return;
        memberships.push(...data);
        if (data.length < 500) break;
      }
      const dateParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(new Date());
      const datePart = type => dateParts.find(part => part.type === type).value;
      const today = `${datePart('year')}-${datePart('month')}-${datePart('day')}`;
      const eventsById = new Map();
      const rank = { invited: 1, active: 2, completed: 3 };
      for (const row of memberships) {
        if (!row.events || row.participant_status === 'cancelled' || row.events.status === 'cancelled') continue;
        const eventId = row.event_id || row.events.id;
        const existing = eventsById.get(eventId);
        if (!existing || (rank[row.participant_status] || 0) > (rank[existing.participant_status] || 0)) eventsById.set(eventId, row);
      }
      const valid = [...eventsById.values()];
      const past = valid.filter(row => row.participant_status === 'completed' ||
        row.events.status === 'completed' ||
        (row.events.end_date && row.events.end_date < today));
      const other = valid.filter(row => !past.includes(row));
      past.sort((a, b) => (b.events.start_date || '').localeCompare(a.events.start_date || ''));
      const date = value => value ? value.split('-').reverse().join('/') : '—';
      const eventRow = row => [row.events.name, row.events.event_type,
        `${date(row.events.start_date)} – ${date(row.events.end_date)}`];
      const host = el('skillHistory');
      host.append(historyTable(`SHAKSHUKA Travel history (${past.length})`,
        ['Event', 'Type', 'Dates'], past.map(eventRow)));
      const courseRows = [];
      let courseErrors = 0;
      // Reuse the same admin endpoints as Shakshuka, including custom courses.
      // Process one event at a time to keep requests bounded.
      for (const row of past) {
        if (String(row.events.event_type).toLowerCase() === 'tunnel') continue;
        const results = await Promise.all([
          client.rpc('admin_get_canopy_training_v100', { p_event_id: row.event_id }),
          client.rpc('admin_get_custom_canopy_training_v149', { p_event_id: row.event_id })
        ]);
        if (!current()) return;
        const levels = new Set();
        for (const result of results) {
          if (result.error) { ++courseErrors; continue; }
          for (const assignment of result.data?.assignments || []) {
            if (recordIds.some(id => String(id) === String(assignment.participant_id))) levels.add(assignment.course_level);
          }
        }
        for (const level of levels) courseRows.push([level, row.events.name, date(row.events.end_date)]);
      }
      if (!current()) return;
      host.append(historyTable(`Canopy Training history (${courseRows.length})`, ['Course', 'Event', 'Event end'], courseRows));
      if (other.length) host.append(historyTable('Upcoming, current or unconfirmed registrations',
        ['Event', 'Type', 'Dates'], other.map(eventRow)));
      status('skillStatus', courseErrors ? 'Some canopy history could not be loaded. Counts may be incomplete; use Refresh above.' : '');
    } catch (error) {
      if (current()) {
        el('skillHistory').replaceChildren();
        status('skillStatus', 'Unable to load history. Please use Refresh above.');
      }
    }
  }
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
      participantRecords = participantRecords.map(person => person.id === data.id ? data : person);
      participants = groupParticipantRecords(participantRecords);
      const savedGroup = participants.find(person => person.recordIds.includes(data.id));
      if (savedGroup) selectedParticipantId = savedGroup.id;
      el('participantSearch').value = '';
      renderParticipants();
      if (savedGroup) { renderParticipantDetails(savedGroup); writeRoute(); loadSkillHistory(savedGroup.id); }
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
    ++skillRequest;
    ++manualSkillRequest;
    el('manualSkillHistory').replaceChildren();
    status('manualSkillStatus', '');
    el('skillHistory').replaceChildren();
    status('skillStatus', '');
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
      (person.searchText || [person.display_name, person.surname, person.phone, person.email]
        .filter(Boolean).join(' ')).toLowerCase().includes(query) ||
      (normalizedParticipantPhone(query) && normalizedParticipantPhone(person.phone).includes(normalizedParticipantPhone(query))));
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
        if (changed) { setParticipantTab('skill', false, false); loadSkillHistory(person.id); loadManualSkills(person.id); }
        writeRoute();
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
      participantRecords = rows;
      participants = groupParticipantRecords(participantRecords);
      const route = readRoute();
      if (activePage === 'participants' && route.page === 'participants') {
        selectedParticipantId = participants.find(person => person.recordIds.includes(route.participant))?.id || null;
        el('participantSearch').value = '';
        setParticipantTab(route.tab, false, false);
      }
      renderParticipants();
      const selected = participants.find(person => person.id === selectedParticipantId);
      if (selected) { renderParticipantDetails(selected); loadSkillHistory(selected.id); loadManualSkills(selected.id); }
    } catch (error) {
      if (!verifiedAdmin || request !== participantLoad) return;
      participants = [];
      participantRecords = [];
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
    resetBasicEvent();
    ++eventPeopleLoad;
    ++travelEventsLoad;
    el('upcomingEventsList').replaceChildren();
    el('pastEventsList').replaceChildren();
    status('travelEventsStatus', '');
    eventPeople = [];
    el('eventParticipantChoices').replaceChildren();
    ++participantLoad;
    participants = [];
    participantRecords = [];
    el('participantsList').replaceChildren();
    clearParticipantDetails();
    el('participantSearch').value = '';
    status('participantsStatus', '');
    el('requestDialog').close();
    el('editParticipantDialog').close();
    el('manualSkillDialog').close();
    manualSkillParticipant = null;
    el('manualSkillForm').reset();
    editingParticipant = null;
    el('editParticipantForm').reset();
    el('accountMenu').hidden = true;
    setPage('home', false);
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
    restoreRoute();
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
      window.history.replaceState(null, '', '#home');
      status('accountStatus', '');
    } catch (error) { status('accountStatus', error.message || 'Unable to log out.'); }
    finally { el('signOut').disabled = false; }
  });
  let travelEventsLoad = 0;
  function eventIsPast(event, today) {
    return event.status === 'completed' || Boolean(event.end_date && event.end_date < today);
  }
  async function loadTravelEvents() {
    if (!verifiedAdmin) return;
    const request = ++travelEventsLoad;
    status('travelEventsStatus', 'Loading events…');
    try {
      const rows = [];
      for (let start = 0; ; start += 500) {
        const { data, error } = await client.from('events').select('id,name,event_type,start_date,end_date,status')
          .order('start_date').order('id').range(start, start + 499);
        if (error) throw error;
        if (!verifiedAdmin || request !== travelEventsLoad) return;
        rows.push(...data);
        if (data.length < 500) break;
      }
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
      const part = type => parts.find(p => p.type === type).value;
      const today = `${part('year')}-${part('month')}-${part('day')}`;
      const past = rows.filter(event => eventIsPast(event, today)).sort((a,b) => (b.start_date || '').localeCompare(a.start_date || ''));
      const upcoming = rows.filter(event => !eventIsPast(event, today));
      for (const [group, events] of [['upcoming', upcoming], ['past', past]]) {
        const host = el(group + 'EventsList'); host.replaceChildren();
        el(group + 'EventsTitle').textContent = `${group === 'past' ? 'Past' : 'Upcoming'} (${events.length})`;
        if (!events.length) { const empty = document.createElement('p'); empty.textContent = 'No events.'; host.append(empty); }
        for (const event of events) {
          const row = document.createElement('div'); row.className = 'travel-event-row';
          const info = document.createElement('div'); const title = document.createElement('strong'); title.textContent = event.name;
          const meta = document.createElement('span');
          const date = value => value ? value.split('-').reverse().join('/') : '—';
          meta.textContent = `${event.event_type === 'tunnel' ? 'Tunnel' : 'Skydive'} · ${date(event.start_date)} – ${date(event.end_date)} · ${event.status}`;
          info.append(title, meta);
          const link = document.createElement('a'); link.textContent = 'Open in Travel ↗'; link.target = '_blank'; link.rel = 'noopener';
          link.href = 'https://shakshuka-travel.pages.dev/admin.html?event=' + encodeURIComponent(event.id);
          row.append(info, link); host.append(row);
        }
      }
      status('travelEventsStatus', '');
    } catch {
      if (verifiedAdmin && request === travelEventsLoad) status('travelEventsStatus', 'Unable to load events. Use Refresh events to retry.');
    }
  }
  el('refreshTravelEvents').addEventListener('click', loadTravelEvents);

  let eventPeople = [];
  let eventPeopleLoad = 0;
  let eventPeopleReady = false;
  let savingBasicEvent = false;
  let eventRequestId = null;
  const eventSelection = new Map();
  const personName = person => [person.display_name, person.surname].filter(Boolean).join(' ');
  const nameKey = name => name.trim().replace(/\s+/g, ' ').toLowerCase();
  function renderEventSelection() {
    el('eventSelectionCount').textContent = `${eventSelection.size} participant(s) selected`;
    el('eventSelectedParticipants').replaceChildren();
    for (const [key, person] of eventSelection) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `Remove ${person.name}${person.id ? '' : ' (new)'}`;
      button.setAttribute('aria-label', `Remove ${person.name}`);
      button.addEventListener('click', () => {
        if (savingBasicEvent) return;
        eventSelection.delete(key); renderEventSelection(); renderEventChoices();
      });
      const row = document.createElement('div'); row.className = 'event-selected-person';
      const label = document.createElement('label'); label.textContent = person.id ? person.name : `${person.name} — phone (optional)`;
      const phone = document.createElement('input'); phone.type = 'tel'; phone.maxLength = 40;
      phone.value = person.phone || ''; phone.setAttribute('aria-label', `Phone for ${person.name}`);
      phone.addEventListener('input', () => { person.phone = phone.value; });
      if (!person.id) label.append(phone);
      row.append(label, button);
      el('eventSelectedParticipants').append(row);
    }
  }
  function renderEventChoices() {
    const query = el('eventParticipantSearch').value.trim().toLowerCase();
    const host = el('eventParticipantChoices'); host.replaceChildren();
    for (const person of eventPeople.filter(person => person.searchText.toLowerCase().includes(query))) {
      const label = document.createElement('label');
      const input = document.createElement('input'); input.type = 'checkbox';
      input.checked = eventSelection.has(person.id);
      input.addEventListener('change', () => {
        if (savingBasicEvent) return;
        if (input.checked) eventSelection.set(person.id, { id: person.id, name: personName(person), phone: person.phone || '', originalPhone: person.phone ?? null });
        else eventSelection.delete(person.id);
        renderEventSelection();
      });
      const text = document.createElement('span');
      text.textContent = personName(person) + (person.phone ? ` · ${person.phone}` : '');
      label.append(input, text);
      const row = document.createElement('div'); row.className = 'event-search-person';
      const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = '✎';
      edit.setAttribute('aria-label', `Edit phone for ${personName(person)}`);
      const editor = document.createElement('div'); editor.className = 'event-phone-editor'; editor.hidden = true;
      const phone = document.createElement('input'); phone.type = 'tel'; phone.maxLength = 40;
      phone.value = person.phone || ''; phone.setAttribute('aria-label', `Phone for ${personName(person)}`);
      const save = document.createElement('button'); save.type = 'button'; save.textContent = '✓';
      save.setAttribute('aria-label', `Save phone for ${personName(person)}`);
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '×'; cancel.setAttribute('aria-label', 'Cancel phone edit');
      const message = document.createElement('span'); message.setAttribute('role', 'status');
      edit.addEventListener('click', () => { editor.hidden = false; edit.hidden = true; phone.focus(); });
      cancel.addEventListener('click', () => { editor.hidden = true; edit.hidden = false; phone.value = person.phone || ''; message.textContent = ''; });
      let saving = false;
      save.addEventListener('click', async () => {
        if (!verifiedAdmin || saving || savingBasicEvent) return;
        const value = phone.value.trim();
        if (value && (value.length > 40 || !/^[+0-9().\s-]+$/.test(value) || !/\d/.test(value))) {
          message.textContent = 'Enter a valid phone number.'; return;
        }
        const accountRevision = revision;
        saving = true; save.disabled = true; cancel.disabled = true; phone.disabled = true;
        message.textContent = 'Saving…';
        try {
          const { error } = await client.rpc('admin_update_participant_phone', {
            p_participant_id: person.id, p_original_phone: person.phone ?? null, p_phone: value || null
          });
          if (error) throw error;
          if (!verifiedAdmin || revision !== accountRevision) return;
          person.phone = value || null;
          person.searchText = [personName(person), person.phone, person.email].filter(Boolean).join(' ');
          const selected = eventSelection.get(person.id);
          if (selected) { selected.phone = value; selected.originalPhone = value || null; }
          text.textContent = personName(person) + (value ? ` · ${value}` : '');
          editor.hidden = true; edit.hidden = false; message.textContent = 'Saved';
          renderEventSelection();
        } catch (error) {
          if (verifiedAdmin && revision === accountRevision) message.textContent = error.code === 'PGRST202'
            ? 'Run the updated database/basic-events.sql in Supabase.' : error.message || 'Unable to save. Try again.';
        } finally { saving = false; save.disabled = false; cancel.disabled = false; phone.disabled = false; }
      });
      editor.append(phone, save, cancel); row.append(label, edit, editor, message); host.append(row);
    }
    if (!host.children.length) host.textContent = eventPeopleReady ? 'No matching participants.' : 'Loading participants…';
  }
  async function loadEventParticipants() {
    if (!verifiedAdmin) return;
    const request = ++eventPeopleLoad;
    eventPeopleReady = false;
    el('saveBasicEvent').disabled = true;
    status('eventParticipantsStatus', 'Loading participants…');
    try {
      const rows = [];
      for (let start = 0; ; start += 500) {
        const { data, error } = await client.from('participants')
          .select('id,display_name,surname,phone,email').order('display_name').order('id').range(start, start + 499);
        if (error) throw error;
        if (!verifiedAdmin || request !== eventPeopleLoad) return;
        rows.push(...data);
        if (data.length < 500) break;
      }
      eventPeople = groupParticipantRecords(rows);
      eventPeopleReady = true;
      renderEventChoices();
      status('eventParticipantsStatus', 'Select everyone who attended or will attend.');
    } catch {
      if (verifiedAdmin && request === eventPeopleLoad) status('eventParticipantsStatus', 'Unable to load participants. Open Events again to retry.');
    } finally {
      if (verifiedAdmin && request === eventPeopleLoad) el('saveBasicEvent').disabled = !eventPeopleReady || savingBasicEvent;
    }
  }
  function resetBasicEvent() {
    eventSelection.clear(); eventRequestId = null; eventPeopleReady = false;
    el('basicEventForm').reset(); renderEventSelection();
    status('basicEventStatus', ''); el('basicEventTravelLink').hidden = true;
  }
  el('eventParticipantSearch').addEventListener('input', renderEventChoices);
  el('queueEventParticipant').addEventListener('click', () => {
    if (!verifiedAdmin || !eventPeopleReady || savingBasicEvent) return;
    const name = el('newEventParticipant').value.trim().replace(/\s+/g, ' ');
    if (!name || name.length > 150) { status('basicEventStatus', 'Enter a participant name (up to 150 characters).'); return; }
    const matches = eventPeople.filter(person => nameKey(personName(person)) === nameKey(name));
    if (matches.length > 1) {
      el('eventParticipantSearch').value = name; renderEventChoices();
      status('basicEventStatus', 'Several participants have this name. Select the correct person from the list.'); return;
    }
    const enteredPhone = el('newEventParticipantPhone').value.trim();
    if (enteredPhone && (!/^[+0-9().\s-]+$/.test(enteredPhone) || !/\d/.test(enteredPhone))) {
      status('basicEventStatus', 'Enter a valid phone number.'); return;
    }
    const phoneMatches = enteredPhone ? eventPeople.filter(person => normalizedParticipantPhone(person.phone) === normalizedParticipantPhone(enteredPhone)) : [];
    if (phoneMatches.length && (!matches[0] || matches[0].id !== phoneMatches[0].id)) {
      el('eventParticipantSearch').value = enteredPhone; renderEventChoices();
      status('basicEventStatus', 'This phone belongs to an existing participant. Select them from the list.'); return;
    }
    const person = matches[0];
    eventSelection.set(person ? person.id : 'new:' + nameKey(name), person ? { id: person.id, name: personName(person), phone: person.phone || '', originalPhone: person.phone ?? null } : { name, phone: enteredPhone });
    el('newEventParticipant').value = '';
    el('newEventParticipantPhone').value = '';
    status('basicEventStatus', ''); renderEventSelection(); renderEventChoices();
  });
  el('basicEventForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!verifiedAdmin || !eventPeopleReady || savingBasicEvent || !el('basicEventForm').reportValidity()) return;
    const name = el('basicEventName').value.trim();
    const start = el('basicEventStart').value, end = el('basicEventEnd').value;
    if (!name || end < start) { status('basicEventStatus', 'Enter a name and an end date on or after the start date.'); return; }
    if (!eventSelection.size) { status('basicEventStatus', 'Select at least one participant.'); return; }
    if (el('newEventParticipant').value.trim()) { status('basicEventStatus', 'Click Add participant to include the name you entered.'); return; }
    if ([...eventSelection.values()].some(person => person.phone && (person.phone.length > 40 || !/^[+0-9().\s-]+$/.test(person.phone) || !/\d/.test(person.phone)))) {
      status('basicEventStatus', 'Enter valid phone numbers of up to 40 characters.'); return;
    }
    const accountRevision = revision;
    eventRequestId ||= crypto.randomUUID();
    savingBasicEvent = true; el('basicEventFields').disabled = true;
    status('basicEventStatus', 'Saving event and participants…');
    el('basicEventTravelLink').hidden = true;
    try {
      const { data, error } = await client.rpc('admin_create_basic_event_v2', {
        p_event_id: eventRequestId, p_name: name, p_event_type: el('basicEventType').value,
        p_start_date: start, p_end_date: end,
        p_participant_ids: [...eventSelection.values()].filter(person => person.id).map(person => person.id),
        p_new_names: [...eventSelection.values()].filter(person => !person.id).map(person => person.name),
        p_new_phones: [...eventSelection.values()].filter(person => !person.id).map(person => person.phone.trim() || null),
        p_participant_phones: [...eventSelection.values()].filter(person => person.id && (person.phone.trim() || null) !== person.originalPhone)
          .map(person => ({ id: person.id, phone: person.phone.trim() || null, original_phone: person.originalPhone }))
      });
      if (error) throw error;
      if (!data) throw new Error('Unable to verify the saved event. Retry with the same details.');
      if (!verifiedAdmin || accountRevision !== revision) return;
      resetBasicEvent();
      status('basicEventStatus', 'Event saved. Attendance is available in participants’ Skills history.');
      el('basicEventTravelLink').href = 'https://shakshuka-travel.pages.dev/admin.html?event=' + encodeURIComponent(data);
      el('basicEventTravelLink').hidden = false;
      await Promise.all([loadEventParticipants(), loadTravelEvents()]);
    } catch (error) {
      if (verifiedAdmin && accountRevision === revision) status('basicEventStatus',
        error.code === 'PGRST202' ? 'Database setup is needed: run database/basic-events.sql in Supabase.' : error.message || 'Unable to save. Your entries are still here; try again.');
    } finally {
      savingBasicEvent = false; el('basicEventFields').disabled = false;
      el('saveBasicEvent').disabled = !eventPeopleReady;
    }
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
