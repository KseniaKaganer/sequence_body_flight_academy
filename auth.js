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
  const statisticsViews = ['overview','types','participation','coaches','months','requests'];
  let activeStatisticsView = 'overview';
  let activeParticipantTab = 'participation';
  const activityTabs = ['travel', 'skydive', 'theory', 'flybox', 'social'];
  let activeActivityTab = 'travel';
  function readRoute() {
    let parts;
    try { parts = window.location.hash.slice(1).split('/').map(decodeURIComponent); }
    catch { return { page: 'home', participant: null, tab: 'participation' }; }
    const requestedPage = parts[0] === 'events' ? 'activities' : parts[0];
    const page = ['participants', 'requests', 'activities', 'statistics'].includes(requestedPage) ? requestedPage : 'home';
    return { page: page === 'requests' ? 'request' : page,
      statisticsView: statisticsViews.includes(parts[1]) ? parts[1] : 'overview',
      activity: activityTabs.includes(parts[1]) ? parts[1] : 'travel',
      participant: page === 'participants' ? parts[1] || null : null,
      tab: ['participation','skill','info','gear'].includes(parts[2]) ? parts[2] : 'participation' };
  }
  function writeRoute() {
    let hash = activePage === 'request' ? '#requests' : '#' + activePage;
    if (activePage === 'statistics') hash += '/' + activeStatisticsView;
    if (activePage === 'activities') hash += '/' + activeActivityTab;
    if (activePage === 'participants' && selectedParticipantId) {
      hash += '/' + encodeURIComponent(selectedParticipantId) + '/' + activeParticipantTab;
    }
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
  }
  function restoreRoute() {
    const route = readRoute();
    if (!verifiedAdmin) { setPage('home', false); return; }
    activeActivityTab = route.activity || 'travel';
    activeStatisticsView = route.statisticsView || 'overview';
    setPage(route.page, false);
  }
  window.addEventListener('popstate', restoreRoute);
  window.addEventListener('hashchange', restoreRoute);
  function setPage(page, updateUrl = true) {
    if (!verifiedAdmin && page !== 'home') return;
    activePage = page;
    for (const name of ['home', 'participants', 'request', 'activities', 'statistics']) {
      el(name + 'Page').hidden = name !== page;
    }
    document.querySelectorAll('[data-page]').forEach(button => {
      if (button.dataset.page === page) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (updateUrl) writeRoute();
    if (page === 'participants') loadParticipants();
    if (page === 'request') loadRequests();
    if (page === 'statistics') { setStatisticsView(activeStatisticsView, false, false); loadStatistics(); }
    if (page === 'activities') setActivityTab(activeActivityTab, false, false);
  }

  function setActivityTab(tab, focus = false, updateUrl = true) {
    if (!verifiedAdmin) return;
    if (localActivityCategory && localActivityCategory !== tab) {
      if (localActivitySaving) return;
      closeLocalActivity(false);
    }
    activeActivityTab = activityTabs.includes(tab) ? tab : 'travel';
    for (const name of activityTabs) {
      const title = name[0].toUpperCase() + name.slice(1);
      const selected = name === activeActivityTab;
      const button = el('activity' + title + 'Tab');
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      el('activity' + title + 'Panel').hidden = !selected;
      if (selected && focus) button.focus();
    }
    if (activePage === 'activities') {
      if (updateUrl) writeRoute();
      if (activeActivityTab === 'travel') { loadEventParticipants(); loadTravelEvents(); }
      else loadLocalActivities(activeActivityTab);
    }
  }
  for (const [index, tab] of activityTabs.entries()) {
    const title = tab[0].toUpperCase() + tab.slice(1);
    const button = el('activity' + title + 'Tab');
    button.addEventListener('click', () => setActivityTab(tab));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? activityTabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + activityTabs.length) % activityTabs.length;
      setActivityTab(activityTabs[next], true);
    });
  }

  const participantTabNames = ['Participation','Skill','Info','Gear'];
  function setParticipantTab(tab, focus = false, updateUrl = true) {
    activeParticipantTab = participantTabNames.some(name=>name.toLowerCase()===tab) ? tab : 'participation';
    for (const name of participantTabNames) {
      const selected = name.toLowerCase() === activeParticipantTab;
      const button = el('participant' + name + 'Tab');
      button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
      el('participant' + name + 'Panel').hidden = !selected;
      if (selected && focus) button.focus();
    }
    if (updateUrl && selectedParticipantId) writeRoute();
  }
  for (const [index,name] of participantTabNames.entries()) {
    const button = el('participant' + name + 'Tab');
    button.addEventListener('click', () => setParticipantTab(name.toLowerCase()));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const next=event.key==='Home'?0:event.key==='End'?participantTabNames.length-1:(index+(event.key==='ArrowRight'?1:-1)+participantTabNames.length)%participantTabNames.length;
      setParticipantTab(participantTabNames[next].toLowerCase(),true);
    });
  }
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
    loadParticipantActivitySkills(participantId);
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
    for (const [field, input] of Object.entries(participantFields)) el(input).value = participantInfo(person)[field] || '';
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
      if (activePage === 'request') {
        const selectedRequest = requestParticipantSelection.get(data.id);
        if (selectedRequest) { selectedRequest.name = personName(data); selectedRequest.phone = data.phone || ''; selectedRequest.originalPhone = data.phone ?? null; }
        requestPeople = requestPeople.map(person => person.id === data.id ? { ...person, ...data, searchText: [data.display_name, data.surname, data.phone, data.email].filter(Boolean).join(' ') } : person);
        renderRequestSelection(); renderRequestPeople();
      }
      status('participantsStatus', 'Participant details saved to the server.');
      if (activePage === 'activities') {
        const selected = eventSelection.get(data.id);
        if (selected) { selected.name = personName(data); selected.phone = data.phone || ''; selected.originalPhone = data.phone ?? null; }
        if (localActivityCategory) {
          const selectedLocal = localActivitySelection.get(data.id);
          if (selectedLocal) { selectedLocal.name = personName(data); selectedLocal.phone = data.phone || ''; selectedLocal.originalPhone = data.phone ?? null; }
          localActivityPeople = localActivityPeople.map(person => person.id === data.id ? {
            ...person, ...data, searchText: [data.display_name, data.surname, data.phone, data.email].filter(Boolean).join(' ')
          } : person);
          renderLocalActivitySelection(); renderLocalActivityPeople();
          status('localActivityStatus', 'Participant details saved.');
        }
        renderEventSelection(); await loadEventParticipants();
        status('basicEventStatus', 'Participant details saved.');
      }
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
    ++activitySkillRequest;
    profileDataCache = null;
    for (const id of ['participationHistory','participantExperience','gearHistory']) el(id).replaceChildren();
    status('profileDataStatus',''); status('gearStatus','');
    el('participantParticipationPanel').hidden = true; el('participantGearPanel').hidden = true;
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
    person = participantInfo(person);
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
    const filtersActive = Boolean(el('participantCategoryFilter').value || el('participantActivityFilter').value || el('participantMissingPhone').checked);
    const matches = participants.filter(person => participantMatchesActivityFilters(person) && (
      (person.searchText || [person.display_name, person.surname, person.phone, person.email]
        .filter(Boolean).join(' ')).toLowerCase().includes(query) ||
      (normalizedParticipantPhone(query) && normalizedParticipantPhone(person.phone).includes(normalizedParticipantPhone(query)))));
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
        if (changed) { setParticipantTab('participation', false, false); loadSkillHistory(person.id); loadManualSkills(person.id); }
        writeRoute();
        // Update selection without replacing the focused list button.
        for (const row of el('participantsList').children) row.setAttribute('aria-pressed', 'false');
        button.setAttribute('aria-pressed', 'true');
        renderParticipantDetails(person);
      });
      el('participantsList').append(button);
    }
    el('participantsListTitle').textContent = query || filtersActive
      ? `Participants (${matches.length} / ${participants.length})` : `Participants (${participants.length})`;
    status('participantsStatus', '');
    if (!matches.length) {
      const empty = document.createElement('p');
      empty.className = 'participant-list-empty';
      empty.textContent = query || filtersActive ? 'No participants match your filters.' : 'No participants found.';
      el('participantsList').append(empty);
    }
  }
  async function loadParticipants() {
    if (!verifiedAdmin) return;
    const request = ++participantLoad;
    ++participantFilterRequest;
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
      loadParticipantActivityFilters();
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
    el('participantGearDialog').close(); gearEditing = null; profileDataCache = null;
    el('participantMissingPhone').checked = false;
    ++statisticsLoad; statisticsData = null; el('statisticsContent').hidden = true; status('statisticsStatus', '');
    for (const id of ['statisticsCards','statisticsOverviewPeople','statisticsTypes','statisticsPeople','statisticsCoaches','statisticsMonths','statisticsRequestCards','statisticsRequests']) el(id).replaceChildren();
    ++requestPeopleLoad; ++requestsLoad;
    requestPeople = []; requestParticipantSelection.clear();
    el('requestsList').replaceChildren(); status('requestsListStatus', ''); el('requestsListTitle').textContent = 'Requests';
    ++participantFilterRequest; participantActivityIndex.clear();
    el('participantCategoryFilter').value = ''; el('participantActivityFilter').value = '';
    el('participantCategoryFilter').disabled = true; el('participantActivityFilter').disabled = true;
    renderParticipantActivityOptions(); status('participantFiltersStatus', '');
    ++localActivityPeopleRequest;
    closeLocalActivity(); localActivityDrafts.clear();
    localActivityPeople = []; localActivitySelection.clear(); localActivityCategory = null;
    for (const category of Object.keys(localActivityLoads)) { ++localActivityLoads[category]; el(category + 'ActivitiesList').replaceChildren(); status(category + 'ActivitiesStatus', ''); }
    resetBasicEvent();
    ++eventPeopleLoad;
    ++travelEventsLoad;
    el('upcomingEventsList').replaceChildren();
    el('pastEventsList').replaceChildren();
    status('travelEventsStatus', '');
    el('travelEventsCount').textContent = 'Travel Events';
    eventPeople = [];
    el('eventParticipantChoices').replaceChildren();
    ++participantLoad;
    participants = [];
    participantRecords = [];
    el('participantsListTitle').textContent = 'Participants';
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
        const { data, error } = await client.from('events').select('id,name,event_type,start_date,end_date,status,sequence_activity_types(name)')
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
      el('travelEventsCount').textContent = `Travel Events (${rows.length})`;
      for (const [group, events] of [['upcoming', upcoming], ['past', past]]) {
        const host = el(group + 'EventsList'); host.replaceChildren();
        el(group + 'EventsTitle').textContent = `${group === 'past' ? 'Past' : 'Upcoming'} (${events.length})`;
        if (!events.length) { const empty = document.createElement('p'); empty.textContent = 'No events.'; host.append(empty); }
        if (!events.length) continue;
        const table = document.createElement('table'); table.className = 'travel-events-table';
        const caption = document.createElement('caption'); caption.className = 'visually-hidden';
        caption.textContent = group === 'past' ? 'Past Travel Events' : 'Upcoming Travel Events';
        const head = document.createElement('thead'); const header = document.createElement('tr');
        for (const text of ['Name', 'Dates', 'Status', 'Event Travel']) {
          const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = text; header.append(cell);
        }
        head.append(header); const body = document.createElement('tbody');
        for (const event of events) {
          const row = document.createElement('tr');
          const name = document.createElement('td'); name.textContent = event.name + (event.sequence_activity_types?.name ? ' · ' + event.sequence_activity_types.name : '');
          const dates = document.createElement('td');
          const date = value => value ? value.split('-').reverse().join('/') : '—';
          dates.textContent = `${date(event.start_date)} – ${date(event.end_date)}`;
          const statusCell = document.createElement('td'); const badge = document.createElement('span');
          badge.className = 'travel-event-status'; badge.textContent = event.status || '—'; statusCell.append(badge);
          const action = document.createElement('td');
          const link = document.createElement('a'); link.className = 'event-travel-button';
          link.textContent = 'Event Travel ↗'; link.target = '_blank'; link.rel = 'noopener';
          link.setAttribute('aria-label', `Open ${event.name} in Travel`);
          link.href = 'https://shakshuka-travel.pages.dev/admin.html?event=' + encodeURIComponent(event.id);
          action.append(link); row.append(name, dates, statusCell, action); body.append(row);
        }
        table.append(caption, head, body);
        const scroll = document.createElement('div'); scroll.className = 'travel-events-scroll';
        scroll.tabIndex = 0; scroll.setAttribute('role', 'region');
        scroll.setAttribute('aria-label', group === 'past' ? 'Past events table' : 'Upcoming events table');
        scroll.append(table); host.append(scroll);
      }
      status('travelEventsStatus', '');
    } catch {
      if (verifiedAdmin && request === travelEventsLoad) status('travelEventsStatus', 'Unable to load events. Reopen Travel to retry.');
    }
  }

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
      button.textContent = '×'; button.className = 'event-remove-icon';
      button.title = `Remove ${person.name}`;
      const row = document.createElement('div'); row.className = 'event-selected-person';
      const name = document.createElement('span'); name.className = 'event-selected-name';
      name.textContent = person.name + (person.id ? '' : ' (new)');
      const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = '✎';
      edit.setAttribute('aria-label', `Edit ${person.name}`); edit.title = `Edit ${person.name}`;
      edit.addEventListener('click', async () => {
        if (!verifiedAdmin || savingBasicEvent) return;
        if (person.id) {
          const accountRevision = revision; edit.disabled = true;
          try {
            const { data, error } = await client.from('participants')
              .select('id,display_name,surname,phone,email,passport_number,notes').eq('id', person.id).maybeSingle();
            if (error) throw error;
            if (!verifiedAdmin || revision !== accountRevision) return;
            if (!data) throw new Error('Participant no longer exists. Refresh Events.');
            editingParticipant = { ...data };
            for (const [field, input] of Object.entries(participantFields)) el(input).value = data[field] || '';
            status('editParticipantStatus', ''); el('editParticipantDialog').showModal();
          } catch (error) {
            if (verifiedAdmin && revision === accountRevision) status('basicEventStatus', error.message || 'Unable to open participant details.');
          } finally { edit.disabled = false; }
        } else { editor.hidden = !editor.hidden; if (!editor.hidden) first.focus(); }
      });
      const editor = document.createElement('div'); editor.className = 'event-new-person-editor'; editor.hidden = true;
      const first = document.createElement('input'); first.value = person.firstName || ''; first.maxLength = 150;
      first.setAttribute('aria-label', 'Name'); first.placeholder = 'Name';
      const last = document.createElement('input'); last.value = person.surname || ''; last.maxLength = 150;
      last.setAttribute('aria-label', 'Surname'); last.placeholder = 'Surname';
      const phone = document.createElement('input'); phone.type = 'tel'; phone.maxLength = 40; phone.value = person.phone || '';
      phone.setAttribute('aria-label', 'Phone'); phone.placeholder = 'Phone (optional)';
      const save = document.createElement('button'); save.type = 'button'; save.textContent = '✓'; save.setAttribute('aria-label', 'Apply participant edits');
      save.addEventListener('click', () => {
        if (savingBasicEvent) return;
        const firstName = first.value.trim().replace(/\s+/g, ' '), surname = last.value.trim().replace(/\s+/g, ' ');
        if (!firstName || firstName.length > 150 || surname.length > 150) {
          status('basicEventStatus', 'Enter a name; name and surname can each contain up to 150 characters.'); return;
        }
        const full = [firstName, surname].filter(Boolean).join(' ');
        if ([...eventSelection].some(([otherKey, other]) => otherKey !== key && nameKey(other.name) === nameKey(full)) ||
            eventPeople.some(other => nameKey(personName(other)) === nameKey(full))) {
          status('basicEventStatus', 'This participant is already listed. Select their existing record.'); return;
        }
        const phoneValue = phone.value.trim();
        if (phoneValue && (phoneValue.length > 40 || !/^[+0-9().\s-]+$/.test(phoneValue) || !/\d/.test(phoneValue))) {
          status('basicEventStatus', 'Enter a valid phone number.'); return;
        }
        person.firstName = firstName; person.surname = surname; person.name = full; person.phone = phoneValue;
        const updatedKey = 'new:' + nameKey(full);
        if (updatedKey !== key) { eventSelection.delete(key); eventSelection.set(updatedKey, person); }
        status('basicEventStatus', ''); renderEventSelection();
      });
      editor.append(first, last, phone, save);
      row.append(button, name, edit, editor);
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
    const firstName = el('newEventParticipant').value.trim().replace(/\s+/g, ' ');
    const surname = el('newEventParticipantSurname').value.trim().replace(/\s+/g, ' ');
    const name = [firstName, surname].filter(Boolean).join(' ');
    if (!firstName || firstName.length > 150 || surname.length > 150) { status('basicEventStatus', 'Enter a name; name and surname can each contain up to 150 characters.'); return; }
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
    eventSelection.set(person ? person.id : 'new:' + nameKey(name), person ? { id: person.id, name: personName(person), phone: person.phone || '', originalPhone: person.phone ?? null } : { name, firstName, surname, phone: enteredPhone });
    el('newEventParticipant').value = '';
    el('newEventParticipantSurname').value = '';
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
    if (el('newEventParticipant').value.trim() || el('newEventParticipantSurname').value.trim() || el('newEventParticipantPhone').value.trim()) { status('basicEventStatus', 'Click Add participant to include the name you entered.'); return; }
    if ([...eventSelection.values()].some(person => person.phone && (person.phone.length > 40 || !/^[+0-9().\s-]+$/.test(person.phone) || !/\d/.test(person.phone)))) {
      status('basicEventStatus', 'Enter valid phone numbers of up to 40 characters.'); return;
    }
    if (el('travelNewType').value.trim()) { status('basicEventStatus', 'Click Add type to save the new type first.'); return; }
    const accountRevision = revision;
    eventRequestId ||= crypto.randomUUID();
    savingBasicEvent = true; el('basicEventFields').disabled = true;
    status('basicEventStatus', 'Saving event and participants…');
    el('basicEventTravelLink').hidden = true;
    try {
      const { data, error } = await client.rpc('admin_create_basic_event_v4', {
        p_activity_type_id: el('travelActivityType').value || null,
        p_event_id: eventRequestId, p_name: name, p_event_type: el('basicEventType').value,
        p_start_date: start, p_end_date: end,
        p_participant_ids: [...eventSelection.values()].filter(person => person.id).map(person => person.id),
        p_new_names: [...eventSelection.values()].filter(person => !person.id).map(person => person.firstName),
        p_new_surnames: [...eventSelection.values()].filter(person => !person.id).map(person => person.surname || null),
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

  const localActivityLabels = { skydive: 'Skydive Coaching', theory: 'Theory', flybox: 'Flybox', social: 'Social' };
  let localActivityCategory = null;
  let localActivityRequestId = null;
  let localActivitySaving = false;
  let localActivityPeopleReady = false;
  let localActivityPeople = [];
  let localActivityPeopleRequest = 0;
  const localActivitySelection = new Map();
  let localActivityCoaches = [];
  const localActivityDrafts = new Map();
  const savedActivityTypes = new Map();
  const typeLoads = new Map();
  const typeCategory = prefix => prefix === 'travel' ? 'travel' : prefix === 'local' ? localActivityCategory : prefix === 'editRequest' ? el('editRequestCategory').value : el('newRequestType').value;
  async function loadActivityTypes(prefix, selected = '') {
    const category = typeCategory(prefix), token = (typeLoads.get(prefix) || 0) + 1;
    typeLoads.set(prefix, token);
    const select = el(prefix + 'ActivityType');
    select.replaceChildren(); select.value = '';
    const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Choose a saved type'; select.append(empty);
    if (!category) return;
    status(prefix === 'editRequest' ? 'editRequestStatus' : prefix + 'TypeStatus', 'Loading types…');
    try {
      const { data, error } = await client.from('sequence_activity_types').select('id,category,name').eq('category', category).order('name');
      if (error) throw error;
      if (!verifiedAdmin || typeLoads.get(prefix) !== token || typeCategory(prefix) !== category) return;
      for (const row of data || []) {
        savedActivityTypes.set(row.id, row.name);
        const option = document.createElement('option'); option.value = row.id; option.textContent = row.name; select.append(option);
      }
      select.value = selected; status(prefix === 'editRequest' ? 'editRequestStatus' : prefix + 'TypeStatus', ''); return true;
    } catch (_) { if (typeLoads.get(prefix) === token) status(prefix === 'editRequest' ? 'editRequestStatus' : prefix + 'TypeStatus', 'Run database/activity-types.sql to enable saved types.'); }
  }
  for (const prefix of ['travel', 'local', 'request']) {
    el(prefix + 'AddType').addEventListener('click', async () => {
      const category = typeCategory(prefix), name = el(prefix + 'NewType').value.trim();
      if (!verifiedAdmin || !category || !name) { status(prefix === 'editRequest' ? 'editRequestStatus' : prefix + 'TypeStatus', 'Choose a category and enter a type name.'); return; }
      const accountRevision = revision;
      el(prefix + 'AddType').disabled = true;
      try {
        const { data, error } = await client.rpc('admin_save_activity_type', { p_category: category, p_name: name });
        if (error) throw error;
        if (!verifiedAdmin || accountRevision !== revision || typeCategory(prefix) !== category) return;
        el(prefix + 'NewType').value = ''; await loadActivityTypes(prefix, data);
      } catch (error) { status(prefix === 'editRequest' ? 'editRequestStatus' : prefix + 'TypeStatus', error.message || 'Unable to save type.'); }
      finally { el(prefix + 'AddType').disabled = false; }
    });
  }
  el('newRequestType').addEventListener('change', () => loadActivityTypes('request'));
  
  el('addEventSection')?.addEventListener('toggle', () => { if (el('addEventSection').open) loadActivityTypes('travel'); });
  let editingRequestTypesReady = false;
  let editingRequest = null, editingType = null, editingRequestSaving = false, renamingType = false;
  async function openEditRequest(row) {
    if (!verifiedAdmin || editingRequestSaving) return;
    editingRequest = row;
    el('editRequestCategory').value = row.request_type;
    el('editRequestNotes').value = row.notes || '';
    el('editRequestState').value = row.status;
    status('editRequestStatus', ''); el('editRequestDialog').showModal();
    editingRequestTypesReady = false;
    editingRequestTypesReady = Boolean(await loadActivityTypes('editRequest', row.sequence_activity_type_id || ''));
  }
  el('editRequestCategory').addEventListener('change', async () => { editingRequestTypesReady = false; editingRequestTypesReady = Boolean(await loadActivityTypes('editRequest')); });
  el('cancelEditRequest').addEventListener('click', () => { if (!editingRequestSaving) el('editRequestDialog').close(); });
  el('editRequestDialog').addEventListener('cancel', event => { if (editingRequestSaving) event.preventDefault(); });
  el('editRequestForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!verifiedAdmin || !editingRequest || !editingRequestTypesReady || editingRequestSaving || !el('editRequestForm').reportValidity()) return;
    const row = editingRequest, accountRevision = revision;
    editingRequestSaving = true; el('editRequestFields').disabled = true;
    try {
      const { data, error } = await client.rpc('admin_edit_sequence_request', {
        p_id: row.id, p_original: { type: row.request_type, activity_type_id: row.sequence_activity_type_id || null, notes: row.notes || null, status: row.status },
        p_type: el('editRequestCategory').value, p_activity_type_id: el('editRequestActivityType').value || null,
        p_notes: el('editRequestNotes').value.trim() || null, p_status: el('editRequestState').value
      });
      if (error) throw error; if (!data) throw new Error('Unable to verify the update. Retry saving.');
      if (!verifiedAdmin || revision !== accountRevision) return;
      el('editRequestDialog').close(); await loadRequests();
    } catch (error) { status('editRequestStatus', error.code === 'PGRST202' ? 'Run database/edit-requests-types.sql to enable editing.' : error.message || 'Unable to save changes.'); }
    finally { editingRequestSaving = false; el('editRequestFields').disabled = false; }
  });
  for (const prefix of ['travel', 'local', 'request']) {
    el(prefix + 'EditType').addEventListener('click', () => {
      if (!verifiedAdmin || renamingType) return;
      const id = el(prefix + 'ActivityType').value, name = savedActivityTypes.get(id);
      if (!name) { status(prefix + 'TypeStatus', 'Select a saved type to edit.'); return; }
      editingType = { id, name, prefix }; el('renameTypeName').value = name;
      status('renameTypeStatus', ''); el('renameTypeDialog').showModal();
    });
  }
  el('cancelRenameType').addEventListener('click', () => { if (!renamingType) el('renameTypeDialog').close(); });
  el('renameTypeDialog').addEventListener('cancel', event => { if (renamingType) event.preventDefault(); });
  el('renameTypeForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!verifiedAdmin || !editingType || renamingType || !el('renameTypeForm').reportValidity()) return;
    const item = editingType, accountRevision = revision;
    renamingType = true; el('renameTypeFields').disabled = true;
    try {
      const { data, error } = await client.rpc('admin_rename_activity_type', { p_id: item.id, p_original_name: item.name, p_name: el('renameTypeName').value.trim() });
      if (error) throw error; if (!data) throw new Error('Unable to verify the update. Retry saving.');
      if (!verifiedAdmin || accountRevision !== revision) return;
      el('renameTypeDialog').close();
      for (const prefix of ['travel', 'local', 'request']) {
        if (typeCategory(prefix)) await loadActivityTypes(prefix, el(prefix + 'ActivityType').value);
      }
      await loadRequests(); await loadTravelEvents();
      if (localActivityCategory) await loadLocalActivities(localActivityCategory);
    } catch (error) { status('renameTypeStatus', error.code === 'PGRST202' ? 'Run database/edit-requests-types.sql to enable editing.' : error.message || 'Unable to rename type.'); }
    finally { renamingType = false; el('renameTypeFields').disabled = false; }
  });
  const localActivityFields = ['Name', 'Start', 'End', 'Location', 'Coach', 'Notes', 'Search'];
  const localActivityLoads = { skydive: 0, theory: 0, flybox: 0, social: 0 };
  function activityToday() {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const part = type => parts.find(p => p.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
  function renderLocalActivitySelection() {
    el('localActivitySelected').textContent = `${localActivitySelection.size} participant(s) selected`;
    el('localActivitySelectedPeople').replaceChildren();
    for (const [key, person] of localActivitySelection) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `Remove ${person.name}${person.id ? '' : ' (new)'}`;
      button.setAttribute('aria-label', `Remove ${person.name}`);
      button.addEventListener('click', () => {
        if (localActivitySaving) return;
        localActivitySelection.delete(key); renderLocalActivitySelection(); renderLocalActivityPeople();
      });
      button.textContent = '×'; button.className = 'event-remove-icon';
      button.title = `Remove ${person.name}`;
      const row = document.createElement('div'); row.className = 'event-selected-person';
      const name = document.createElement('span'); name.className = 'event-selected-name';
      name.textContent = person.name + (person.id ? '' : ' (new)');
      const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = '✎';
      edit.setAttribute('aria-label', `Edit ${person.name}`); edit.title = `Edit ${person.name}`;
      edit.addEventListener('click', async () => {
        if (!verifiedAdmin || localActivitySaving) return;
        if (person.id) {
          const accountRevision = revision; edit.disabled = true;
          try {
            const { data, error } = await client.from('participants')
              .select('id,display_name,surname,phone,email,passport_number,notes').eq('id', person.id).maybeSingle();
            if (error) throw error;
            if (!verifiedAdmin || revision !== accountRevision) return;
            if (!data) throw new Error('Participant no longer exists. Refresh Events.');
            editingParticipant = { ...data };
            for (const [field, input] of Object.entries(participantFields)) el(input).value = data[field] || '';
            status('editParticipantStatus', ''); el('editParticipantDialog').showModal();
          } catch (error) {
            if (verifiedAdmin && revision === accountRevision) status('localActivityStatus', error.message || 'Unable to open participant details.');
          } finally { edit.disabled = false; }
        } else { editor.hidden = !editor.hidden; if (!editor.hidden) first.focus(); }
      });
      const editor = document.createElement('div'); editor.className = 'event-new-person-editor'; editor.hidden = true;
      const first = document.createElement('input'); first.value = person.firstName || ''; first.maxLength = 150;
      first.setAttribute('aria-label', 'Name'); first.placeholder = 'Name';
      const last = document.createElement('input'); last.value = person.surname || ''; last.maxLength = 150;
      last.setAttribute('aria-label', 'Surname'); last.placeholder = 'Surname';
      const phone = document.createElement('input'); phone.type = 'tel'; phone.maxLength = 40; phone.value = person.phone || '';
      phone.setAttribute('aria-label', 'Phone'); phone.placeholder = 'Phone (optional)';
      const save = document.createElement('button'); save.type = 'button'; save.textContent = '✓'; save.setAttribute('aria-label', 'Apply participant edits');
      save.addEventListener('click', () => {
        if (localActivitySaving) return;
        const firstName = first.value.trim().replace(/\s+/g, ' '), surname = last.value.trim().replace(/\s+/g, ' ');
        if (!firstName || firstName.length > 150 || surname.length > 150) {
          status('localActivityStatus', 'Enter a name; name and surname can each contain up to 150 characters.'); return;
        }
        const full = [firstName, surname].filter(Boolean).join(' ');
        if ([...localActivitySelection].some(([otherKey, other]) => otherKey !== key && nameKey(other.name) === nameKey(full)) ||
            localActivityPeople.some(other => nameKey(personName(other)) === nameKey(full))) {
          status('localActivityStatus', 'This participant is already listed. Select their existing record.'); return;
        }
        const phoneValue = phone.value.trim();
        if (phoneValue && (phoneValue.length > 40 || !/^[+0-9().\s-]+$/.test(phoneValue) || !/\d/.test(phoneValue))) {
          status('localActivityStatus', 'Enter a valid phone number.'); return;
        }
        person.firstName = firstName; person.surname = surname; person.name = full; person.phone = phoneValue;
        const updatedKey = 'new:' + nameKey(full);
        if (updatedKey !== key) { localActivitySelection.delete(key); localActivitySelection.set(updatedKey, person); }
        status('localActivityStatus', ''); renderLocalActivitySelection();
      });
      editor.append(first, last, phone, save);
      row.append(button, name, edit, editor);
      el('localActivitySelectedPeople').append(row);
    }
  }
  function renderLocalActivityPeople() {
    const query = el('localActivitySearch').value.trim().toLowerCase();
    const host = el('localActivityPeople'); host.replaceChildren();
    for (const person of localActivityPeople.filter(person => person.searchText.toLowerCase().includes(query))) {
      const label = document.createElement('label');
      const input = document.createElement('input'); input.type = 'checkbox';
      input.checked = localActivitySelection.has(person.id);
      input.addEventListener('change', () => {
        if (localActivitySaving) return;
        if (input.checked) localActivitySelection.set(person.id, { id: person.id, name: personName(person), phone: person.phone || '', originalPhone: person.phone ?? null });
        else localActivitySelection.delete(person.id);
        renderLocalActivitySelection();
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
        if (!verifiedAdmin || saving || localActivitySaving) return;
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
          const selected = localActivitySelection.get(person.id);
          if (selected) { selected.phone = value; selected.originalPhone = value || null; }
          text.textContent = personName(person) + (value ? ` · ${value}` : '');
          editor.hidden = true; edit.hidden = false; message.textContent = 'Saved';
          renderLocalActivitySelection();
        } catch (error) {
          if (verifiedAdmin && revision === accountRevision) message.textContent = error.code === 'PGRST202'
            ? 'Run the updated database/basic-events.sql in Supabase.' : error.message || 'Unable to save. Try again.';
        } finally { saving = false; save.disabled = false; cancel.disabled = false; phone.disabled = false; }
      });
      editor.append(phone, save, cancel); row.append(label, edit, editor, message); host.append(row);
    }
    if (!host.children.length) host.textContent = localActivityPeopleReady ? 'No matching participants.' : 'Loading participants…';
  }
  function closeLocalActivity(discard = true) {
    if (localActivityCategory) {
      const category = localActivityCategory;
      if (discard) localActivityDrafts.delete(category);
      else localActivityDrafts.set(category, {
        activityType: el('localActivityType').value,
        values: Object.fromEntries(localActivityFields.map(name => [name, el('localActivity' + name).value])),
        ids: [...localActivitySelection], requestId: localActivityRequestId,
        pending: ['localNewParticipant', 'localNewParticipantSurname', 'localNewParticipantPhone'].map(id => el(id).value)
      });
      const title = category[0].toUpperCase() + category.slice(1);
      el('add' + title + 'Section').open = false;
    }
    ++localActivityPeopleRequest; localActivityCategory = null; localActivityPeople = [];
    localActivitySelection.clear(); localActivityPeopleReady = false;
    el('localActivityDialog').hidden = true;
    el('localActivityPeople').replaceChildren(); el('localActivitySelectedPeople').replaceChildren(); el('localActivityForm').reset();
  }
  async function openLocalActivity(category) {
    if (!verifiedAdmin || localActivitySaving || !localActivityLabels[category]) return;
    if (localActivityCategory && localActivityCategory !== category) closeLocalActivity(false);
    const title = category[0].toUpperCase() + category.slice(1);
    el('add' + title + 'Section').open = true;
    el(category + 'ActivityFormSlot').append(el('localActivityDialog'));
    el('localActivityDialog').hidden = false;
    if (localActivityCategory === category) return;
    const draft = localActivityDrafts.get(category);
    localActivityCategory = category; localActivityRequestId = draft?.requestId || crypto.randomUUID();
    localActivitySelection.clear();
    for (const [key, person] of draft?.ids || []) localActivitySelection.set(key, person);
    localActivityPeople = []; localActivityPeopleReady = false;
    const request = ++localActivityPeopleRequest;
    el('localActivityForm').reset(); el('localActivityPeople').replaceChildren(); renderLocalActivitySelection();
    el('localActivityTitle').textContent = 'Add Activity · ' + localActivityLabels[category];
    el('localActivityStart').value = activityToday();
    await loadActivityTypes('local', draft?.activityType || '');
    if (!verifiedAdmin || request !== localActivityPeopleRequest) return;
    if (category === 'flybox') el('localActivityLocation').value = 'Flybox';
    if (draft) for (const name of localActivityFields) el('localActivity' + name).value = draft.values[name];
    if (draft?.pending) ['localNewParticipant', 'localNewParticipantSurname', 'localNewParticipantPhone'].forEach((id, index) => { el(id).value = draft.pending[index]; });
    el('localActivitySelected').textContent = localActivitySelection.size + ' selected';
    el('saveLocalActivity').disabled = true; status('localActivityStatus', '');
    status('localActivityPeopleStatus', 'Loading participants…');
    try {
      const rows = [];
      for (let start = 0; ; start += 500) {
        const { data, error } = await client.from('participants').select('id,display_name,surname,phone,email')
          .order('display_name').order('id').range(start, start + 499);
        if (error) throw error;
        if (!verifiedAdmin || request !== localActivityPeopleRequest) return;
        rows.push(...data); if (data.length < 500) break;
      }
      const { data: admins, error: adminError } = await client.rpc('admin_list_sequence_coaches');
      if (adminError) throw adminError;
      if (!verifiedAdmin || request !== localActivityPeopleRequest) return;
      localActivityCoaches = admins || [];
      const select = el('localActivityCoach'); const previous = draft?.values?.Coach || '';
      select.replaceChildren(); const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Select admin'; select.append(empty);
      for (const admin of localActivityCoaches) {
        const option = document.createElement('option'); option.value = admin.user_id; option.textContent = admin.display_name; select.append(option);
      }
      select.value = localActivityCoaches.some(admin => admin.user_id === previous) ? previous : '';
      localActivityPeople = groupParticipantRecords(rows); localActivityPeopleReady = true;
      renderLocalActivitySelection(); renderLocalActivityPeople(); status('localActivityPeopleStatus', 'Select participants, or leave empty to plan the activity first.');
      el('saveLocalActivity').disabled = false;
    } catch (error) {
      if (verifiedAdmin && request === localActivityPeopleRequest) status('localActivityPeopleStatus', error.code === 'PGRST202' ? 'Run the updated database/local-activities.sql to load admins and participants.' : 'Unable to load admins or participants. Close and reopen Add Activity to retry.');
    }
  }
  async function loadLocalActivities(category) {
    if (!verifiedAdmin || !localActivityLabels[category]) return;
    const request = ++localActivityLoads[category];
    status(category + 'ActivitiesStatus', 'Loading activities…');
    try {
      const rows = [];
      for (let start = 0; ; start += 500) {
        const { data, error } = await client.from('sequence_activities')
          .select('id,title,start_date,end_date,location,coach,notes,sequence_activity_types(name),sequence_activity_participants(count)')
          .eq('category', category).order('start_date').order('id').range(start, start + 499);
        if (error) throw error;
        if (!verifiedAdmin || request !== localActivityLoads[category]) return;
        rows.push(...data); if (data.length < 500) break;
      }
      const host = el(category + 'ActivitiesList'); host.replaceChildren();
      const today = activityToday();
      el(category + 'ActivitiesCount').textContent = localActivityLabels[category] + ' (' + rows.length + ')';
      for (const past of [false, true]) {
        const items = rows.filter(row => (row.end_date < today) === past)
          .sort((a,b) => past ? b.start_date.localeCompare(a.start_date) : a.start_date.localeCompare(b.start_date));
        const section = document.createElement('details'); section.open = !past;
        const summary = document.createElement('summary'); summary.textContent = `${past ? 'Past' : 'Upcoming'} (${items.length})`;
        section.append(summary);
        if (!items.length) { const empty = document.createElement('p'); empty.textContent = 'No activities yet.'; section.append(empty); }
        if (items.length) {
          const table = document.createElement('table'); table.className = 'travel-events-table';
          const caption = document.createElement('caption'); caption.className = 'visually-hidden';
          caption.textContent = localActivityLabels[category] + (past ? ' past activities' : ' upcoming activities');
          const head = document.createElement('thead'), header = document.createElement('tr');
          for (const text of ['Name', 'Dates', 'Status', 'Participants']) {
            const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = text; header.append(cell);
          }
          head.append(header); const body = document.createElement('tbody');
          for (const row of items) {
            const tr = document.createElement('tr');
            const name = document.createElement('td'); const title = document.createElement('strong'); title.textContent = row.title + (row.sequence_activity_types?.name ? ' · ' + row.sequence_activity_types.name : ''); name.append(title);
            const info = [row.location, row.coach, row.notes].filter(Boolean).join(' · ');
            if (info) { const details = document.createElement('span'); details.className = 'local-activity-details'; details.textContent = info; name.append(details); }
            const dates = document.createElement('td'); const date = value => value.split('-').reverse().join('/');
            dates.textContent = row.start_date === row.end_date ? date(row.start_date) : date(row.start_date) + ' – ' + date(row.end_date);
            const state = document.createElement('td'), badge = document.createElement('span'); badge.className = 'travel-event-status';
            badge.textContent = past ? 'Past' : row.start_date <= today ? 'Current' : 'Upcoming'; state.append(badge);
            const count = document.createElement('td'); count.textContent = String(row.sequence_activity_participants?.[0]?.count || 0);
            tr.append(name, dates, state, count); body.append(tr);
          }
          table.append(caption, head, body);
          const scroll = document.createElement('div'); scroll.className = 'travel-events-scroll'; scroll.tabIndex = 0;
          scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', caption.textContent);
          scroll.append(table); section.append(scroll);
        }
        host.append(section);
      }
      status(category + 'ActivitiesStatus', '');
    } catch (error) {
      if (verifiedAdmin && request === localActivityLoads[category]) status(category + 'ActivitiesStatus',
        ['PGRST205', '42P01'].includes(error.code) ? 'Run database/local-activities.sql in Supabase to enable activities.' : 'Unable to load activities. Reopen this tab to retry.');
    }
  }
  for (const category of Object.keys(localActivityLabels)) {
    const title = category[0].toUpperCase() + category.slice(1);
    el('add' + title + 'Activity').addEventListener('click', event => {
      event.preventDefault();
      if (localActivitySaving) return;
      if (el('add' + title + 'Section').open) closeLocalActivity(false);
      else return openLocalActivity(category);
    });
  }
  el('queueLocalActivityParticipant').addEventListener('click', () => {
    if (!verifiedAdmin || !localActivityPeopleReady || localActivitySaving) return;
    const firstName = el('localNewParticipant').value.trim().replace(/\s+/g, ' ');
    const surname = el('localNewParticipantSurname').value.trim().replace(/\s+/g, ' ');
    const name = [firstName, surname].filter(Boolean).join(' ');
    if (!firstName || firstName.length > 150 || surname.length > 150) { status('localActivityStatus', 'Enter a name; name and surname can each contain up to 150 characters.'); return; }
    const matches = localActivityPeople.filter(person => nameKey(personName(person)) === nameKey(name));
    if (matches.length > 1) {
      el('localActivitySearch').value = name; renderLocalActivityPeople();
      status('localActivityStatus', 'Several participants have this name. Select the correct person from the list.'); return;
    }
    const enteredPhone = el('localNewParticipantPhone').value.trim();
    if (enteredPhone && (!/^[+0-9().\s-]+$/.test(enteredPhone) || !/\d/.test(enteredPhone))) {
      status('localActivityStatus', 'Enter a valid phone number.'); return;
    }
    const phoneMatches = enteredPhone ? localActivityPeople.filter(person => normalizedParticipantPhone(person.phone) === normalizedParticipantPhone(enteredPhone)) : [];
    if (phoneMatches.length && (!matches[0] || matches[0].id !== phoneMatches[0].id)) {
      el('localActivitySearch').value = enteredPhone; renderLocalActivityPeople();
      status('localActivityStatus', 'This phone belongs to an existing participant. Select them from the list.'); return;
    }
    const person = matches[0];
    localActivitySelection.set(person ? person.id : 'new:' + nameKey(name), person ? { id: person.id, name: personName(person), phone: person.phone || '', originalPhone: person.phone ?? null } : { name, firstName, surname, phone: enteredPhone });
    el('localNewParticipant').value = '';
    el('localNewParticipantSurname').value = '';
    el('localNewParticipantPhone').value = '';
    status('localActivityStatus', ''); renderLocalActivitySelection(); renderLocalActivityPeople();
  });

  el('localActivitySearch').addEventListener('input', renderLocalActivityPeople);
  el('cancelLocalActivity').addEventListener('click', () => { if (!localActivitySaving) closeLocalActivity(); });
  el('localActivityForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!verifiedAdmin || localActivitySaving || !localActivityCategory || !localActivityPeopleReady || !el('localActivityForm').reportValidity()) return;
    const title = el('localActivityName').value.trim();
    const start = el('localActivityStart').value, end = el('localActivityEnd').value || start;
    if (!title || title.length > 150 || end < start) { status('localActivityStatus', 'Enter a title and valid dates. End date cannot be before start date.'); return; }
    if (el('localNewParticipant').value.trim() || el('localNewParticipantSurname').value.trim() || el('localNewParticipantPhone').value.trim()) {
      status('localActivityStatus', 'Click Add participant to include the name you entered.'); return;
    }
    if ([...localActivitySelection.values()].some(person => person.phone && (person.phone.length > 40 || !/^[+0-9().\s-]+$/.test(person.phone) || !/\d/.test(person.phone)))) {
      status('localActivityStatus', 'Enter valid phone numbers of up to 40 characters.'); return;
    }
    if (el('localNewType').value.trim()) { status('localActivityStatus', 'Click Add type to save the new type first.'); return; }
    const category = localActivityCategory, accountRevision = revision;
    localActivitySaving = true; el('localActivityFields').disabled = true;
    status('localActivityStatus', 'Saving…');
    try {
      const { data, error } = await client.rpc('admin_create_sequence_activity_v3', {
        p_activity_type_id: el('localActivityType').value || null,
        p_activity_id: localActivityRequestId, p_category: category, p_title: title,
        p_start_date: start, p_end_date: end, p_location: el('localActivityLocation').value.trim() || null,
        p_coach_user_id: el('localActivityCoach').value || null, p_notes: el('localActivityNotes').value.trim() || null,
        p_participant_ids: [...localActivitySelection.values()].filter(person => person.id).map(person => person.id),
        p_new_participants: [...localActivitySelection.values()].filter(person => !person.id).map(person => ({
          name: person.firstName, surname: person.surname || null, phone: person.phone.trim() || null
        }))
      });
      if (error) throw error;
      if (!data) throw new Error('Unable to verify the saved activity. Retry with the same details.');
      if (!verifiedAdmin || revision !== accountRevision) return;
      closeLocalActivity();
      await loadLocalActivities(category);
      if (selectedParticipantId) loadParticipantActivitySkills(selectedParticipantId);
    } catch (error) {
      if (verifiedAdmin && revision === accountRevision) status('localActivityStatus',
        error.code === 'PGRST202' ? 'Run database/local-activities.sql in Supabase before saving activities.' : error.message || 'Unable to save. Your entries are still here.');
    } finally { localActivitySaving = false; el('localActivityFields').disabled = false; }
  });

  let activitySkillRequest = 0;
  let participantFilterRequest = 0;
  let participantActivityIndex = new Map();
  function participantMatchesActivityFilters(person) {
    const category = el('participantCategoryFilter').value;
    const activity = el('participantActivityFilter').value;
    if (el('participantMissingPhone').checked && normalizedParticipantPhone(person.phone)) return false;
    if (!category && !activity) return true;
    return [...participantActivityIndex].some(([key, item]) => (!activity || key === activity)
      && (!category || item.category === category)
      && person.recordIds.some(id => item.participants.has(id)));
  }
  function renderParticipantActivityOptions() {
    const select = el('participantActivityFilter');
    const previous = select.value;
    const category = el('participantCategoryFilter').value;
    select.replaceChildren();
    const all = document.createElement('option'); all.value = ''; all.textContent = 'All activities / events'; select.append(all);
    const entries = [...participantActivityIndex].filter(([, item]) => !category || item.category === category)
      .sort((a,b) => (b[1].date || '').localeCompare(a[1].date || '') || a[1].name.localeCompare(b[1].name));
    for (const [key, item] of entries) {
      const option = document.createElement('option'); option.value = key;
      option.textContent = item.name + (item.date ? ' · ' + item.date.split('-').reverse().join('/') : '');
      select.append(option);
    }
    select.value = entries.some(([key]) => key === previous) ? previous : '';
  }
  async function loadParticipantActivityFilters() {
    const request = ++participantFilterRequest;
    el('participantCategoryFilter').disabled = true; el('participantActivityFilter').disabled = true;
    status('participantFiltersStatus', 'Loading activity filters…');
    const readMemberships = async local => {
      const rows = [];
      for (let start = 0; ; start += 500) {
        let query = local
          ? client.from('sequence_activity_participants').select('activity_id,participant_id,sequence_activities(id,title,category,start_date)').order('activity_id').order('participant_id')
          : client.from('event_participants').select('id,participant_id,participant_status,events(id,name,start_date,status)').order('id');
        const { data, error } = await query.range(start, start + 499);
        if (error) throw error;
        if (!verifiedAdmin || request !== participantFilterRequest) return null;
        rows.push(...data); if (data.length < 500) return rows;
      }
    };
    try {
      const [travel, local] = await Promise.all([readMemberships(false), readMemberships(true)]);
      if (!verifiedAdmin || request !== participantFilterRequest || !travel || !local) return;
      const index = new Map();
      for (const [rows, isLocal] of [[travel, false], [local, true]]) {
        for (const row of rows) {
          const activity = isLocal ? row.sequence_activities : row.events;
          if (!activity || row.participant_status === 'cancelled' || activity.status === 'cancelled') continue;
          const key = (isLocal ? 'local:' : 'travel:') + activity.id;
          if (!index.has(key)) index.set(key, { name: isLocal ? activity.title : activity.name,
            category: isLocal ? activity.category : 'travel', date: activity.start_date, participants: new Set() });
          index.get(key).participants.add(row.participant_id);
        }
      }
      participantActivityIndex = index;
      renderParticipantActivityOptions();
      el('participantCategoryFilter').disabled = false; el('participantActivityFilter').disabled = false;
      status('participantFiltersStatus', ''); renderParticipants();
    } catch (error) {
      if (!verifiedAdmin || request !== participantFilterRequest) return;
      participantActivityIndex.clear();
      el('participantCategoryFilter').value = ''; el('participantActivityFilter').value = '';
      status('participantFiltersStatus', ['PGRST205', '42P01'].includes(error.code)
        ? 'Run database/local-activities.sql to enable activity filters.' : 'Unable to load activity filters. Refresh participants to retry.');
      renderParticipants();
    }
  }
  async function loadParticipantActivitySkills(participantId) {
    return loadParticipantProfileData(participantId);
  }
  el('participantCategoryFilter').addEventListener('change', () => { renderParticipantActivityOptions(); renderParticipants(); });
  el('participantActivityFilter').addEventListener('change', renderParticipants);
  el('participantMissingPhone').addEventListener('change',renderParticipants);
  el('clearParticipantFilters').addEventListener('click', () => {
    el('participantCategoryFilter').value = ''; el('participantActivityFilter').value = ''; el('participantSearch').value = ''; el('participantMissingPhone').checked = false;
    renderParticipantActivityOptions(); renderParticipants();
  });

  const requestTypeLabels = {travel:'Travel',skydive:'Skydive Coaching',theory:'Theory',flybox:'Flybox',social:'Social',gear:'Gear',other:'Other'};
  let savingRequest = false;
  let requestPeopleReady = false;
  let requestPeopleLoad = 0;
  let requestsLoad = 0;
  let requestPeople = [];
  let newRequestId = null;
  let requestEditingId = null;
  let requestOperationId = null;
  const requestExistingIds = new Set();
  const requestParticipantSelection = new Map();
  async function openNewRequest(existing = null) {
    if (!verifiedAdmin || savingRequest) return;
    const load = ++requestPeopleLoad;
    requestParticipantSelection.clear(); requestPeople = []; requestPeopleReady = false; newRequestId = existing?.id || crypto.randomUUID();
    requestEditingId = existing?.id || null; requestOperationId = crypto.randomUUID(); requestExistingIds.clear();
    for (const link of existing?.sequence_request_participants || []) requestExistingIds.add(link.participant_id);
    el('newRequestForm').reset(); el('requestPeople').replaceChildren(); renderRequestSelection();
    el('requestTitle').textContent = existing ? 'Add participants to request' : 'New Request';
    el('newRequestType').value = existing?.request_type || ''; el('newRequestType').disabled = Boolean(existing);
    await loadActivityTypes('request', existing?.sequence_activity_type_id || '');
    el('requestActivityType').disabled = Boolean(existing);
    el('requestNewType').disabled = Boolean(existing); el('requestAddType').hidden = Boolean(existing);
    el('newRequestNotes').value = existing?.notes || ''; el('newRequestNotes').readOnly = Boolean(existing);
    el('saveNewRequest').textContent = existing ? 'Add participants' : 'Save Request';
    el('requestExistingPeople').hidden = !existing;
    el('requestExistingPeople').textContent = existing ? 'Current participants: ' + ((existing.sequence_request_participants || []).map(link => link.participants ? personName(link.participants) : '').filter(Boolean).join(', ') || 'None yet') : '';
    status('newRequestStatus', ''); status('requestPeopleStatus', 'Loading participants…');
    el('saveNewRequest').disabled = true; el('requestDialog').showModal();
    try {
      const rows = [];
      for (let start=0; ; start+=500) {
        const {data,error} = await client.from('participants').select('id,display_name,surname,phone,email')
          .order('display_name').order('id').range(start,start+499);
        if(error)throw error;
        if(!verifiedAdmin || load!==requestPeopleLoad)return;
        rows.push(...data);if(data.length<500)break;
      }
      requestPeople=groupParticipantRecords(rows);requestPeopleReady=true;
      renderRequestPeople();status('requestPeopleStatus','Select participants, add someone new, or leave empty to add them later.');el('saveNewRequest').disabled=false;
    } catch {
      if(verifiedAdmin && load===requestPeopleLoad) { status('requestPeopleStatus','Participants could not be loaded. You can save a new request without them, or reopen to retry.'); el('saveNewRequest').disabled = Boolean(requestEditingId); }
    }
  }
  const requestGroupOpen = new Map();
  el('editRequestParticipants').addEventListener('click', () => {
    if (!verifiedAdmin || editingRequestSaving || !editingRequest) return;
    const row = editingRequest; el('editRequestDialog').close(); return openNewRequest(row);
  });
  async function loadRequests() {
    if(!verifiedAdmin)return;
    const request=++requestsLoad;status('requestsListStatus','Loading requests…');
    try {
      const rows=[];
      for(let start=0; ; start+=500) {
        const {data,error}=await client.from('sequence_requests')
          .select('id,request_type,notes,status,created_at,sequence_activity_type_id,sequence_activity_types(name),sequence_request_participants(participant_id,participants(display_name,surname))')
          .order('created_at',{ascending:false}).order('id').range(start,start+499);
        if(error)throw error;
        if(!verifiedAdmin || request!==requestsLoad)return;
        rows.push(...data);if(data.length<500)break;
      }
      const host=el('requestsList');host.replaceChildren();el('requestsListTitle').textContent=`Requests (${rows.length})`;
      if(!rows.length){const p=document.createElement('p');p.textContent='No requests yet.';host.append(p);}
      else for (const [category, label] of Object.entries(requestTypeLabels)) {
        const groupRows = rows.filter(row => row.request_type === category);
        if (!groupRows.length) continue;
        const group = document.createElement('details'); group.className = 'travel-events-section';
        group.open = requestGroupOpen.get(category) || false;
        group.addEventListener('toggle', () => requestGroupOpen.set(category, group.open));
        const summary = document.createElement('summary'); summary.textContent = `Activity: ${label} (${groupRows.length})`; group.append(summary);
        const table=document.createElement('table');table.className='travel-events-table';
        const caption=document.createElement('caption');caption.className='visually-hidden';caption.textContent=label + ' requests';
        const head=document.createElement('thead'),headers=document.createElement('tr');
        for(const label of ['Type','Participants','Date','Status','']){const th=document.createElement('th');th.scope='col';th.textContent=label;headers.append(th);}
        head.append(headers);const body=document.createElement('tbody');
        for(const row of groupRows){
          const tr=document.createElement('tr');
          const names=(row.sequence_request_participants||[]).map(link=>link.participants?personName(link.participants):'').filter(Boolean).join(', ');
          const date=row.created_at?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem'}).format(new Date(row.created_at)):'—';
          for(const value of [row.sequence_activity_types?.name,names || 'No participants yet',date,row.status]){
            const td=document.createElement('td');td.textContent=value||'—';tr.append(td);
          }
          const action = document.createElement('td'), edit = document.createElement('button');
          edit.type = 'button'; edit.textContent = '✎'; edit.title = 'Edit request'; edit.setAttribute('aria-label', 'Edit ' + label + ' request');
          edit.addEventListener('click', () => openEditRequest(row)); action.append(edit); tr.append(action);
          body.append(tr);
        }
        table.append(caption,head,body);const scroll=document.createElement('div');scroll.className='travel-events-scroll';scroll.tabIndex=0;
        scroll.setAttribute('role','region');scroll.setAttribute('aria-label',label + ' requests table');scroll.append(table);group.append(scroll);host.append(group);
      }
      status('requestsListStatus','');
    }catch(error){if(verifiedAdmin && request===requestsLoad)status('requestsListStatus',
      ['PGRST205','42P01'].includes(error.code)?'Run database/requests.sql in Supabase to enable requests.':'Unable to load requests. Reopen Requests to retry.');}
  }
  el('newRequest').addEventListener('click',()=>openNewRequest());
  for(const id of ['closeRequest','cancelNewRequest'])el(id).addEventListener('click',()=>{if(!savingRequest)el('requestDialog').close();});
  el('requestDialog').addEventListener('cancel',event=>{if(savingRequest)event.preventDefault();});
  el('requestDialog').addEventListener('close',()=>{
    ++requestPeopleLoad;requestPeopleReady=false;requestPeople=[];newRequestId=null;requestEditingId=null;requestOperationId=null;requestExistingIds.clear();requestParticipantSelection.clear();
    el('newRequestForm').reset();el('requestPeople').replaceChildren();renderRequestSelection();status('newRequestStatus','');
  });
  el('requestParticipantSearch').addEventListener('input',renderRequestPeople);
  el('newRequestForm').addEventListener('submit',async event=>{
    event.preventDefault();
    if(!verifiedAdmin || savingRequest || (requestParticipantSelection.size && !requestPeopleReady) || !el('newRequestForm').reportValidity())return;
    const type=el('newRequestType').value,notes=el('newRequestNotes').value.trim();
    if(!requestTypeLabels[type] || notes.length>5000){status('newRequestStatus','Choose a request type and keep notes under 5000 characters.');return;}
    if(requestEditingId && !requestParticipantSelection.size){status('newRequestStatus','Select a participant or add someone new.');return;}
    if(['requestNewParticipant','requestNewParticipantSurname','requestNewParticipantPhone'].some(id=>el(id).value.trim())){
      status('newRequestStatus','Click Add participant to include the person you entered.');return;
    }
    if (el('requestNewType').value.trim()) { status('newRequestStatus', 'Click Add type to save the new type first.'); return; }
    const accountRevision=revision;
    savingRequest=true;el('newRequestFields').disabled=true;el('closeRequest').disabled=true;status('newRequestStatus','Saving…');
    try{
      const payload = {
        p_request_id:newRequestId,
        p_participant_ids:[...requestParticipantSelection.values()].filter(person=>person.id).map(person=>person.id),
        p_new_participants:[...requestParticipantSelection.values()].filter(person=>!person.id)
          .map(person=>({name:person.firstName,surname:person.surname||null,phone:person.phone.trim()||null}))
      };
      if (requestEditingId) payload.p_operation_id = requestOperationId;
      else { payload.p_activity_type_id = el('requestActivityType').value || null; payload.p_type = type; payload.p_notes = notes || null; }
      const {data,error}=await client.rpc(requestEditingId ? 'admin_add_sequence_request_participants' : 'admin_create_sequence_request_v2',payload);
      if(error)throw error;if(!data)throw new Error('Unable to verify the saved request. Retry with the same details.');
      if(!verifiedAdmin || revision!==accountRevision)return;
      el('requestDialog').close();await loadRequests();
    }catch(error){if(verifiedAdmin && revision===accountRevision)status('newRequestStatus',
      error.code==='PGRST202'?'Run database/requests.sql in Supabase before saving requests.':error.message||'Unable to save. Your entries are still here.');
    }finally{savingRequest=false;el('newRequestFields').disabled=false;el('closeRequest').disabled=false;}
  });

  function renderRequestSelection() {
    el('requestParticipantCount').textContent = `${requestParticipantSelection.size} participant(s) selected`;
    el('requestSelectedParticipants').replaceChildren();
    for (const [key, person] of requestParticipantSelection) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `Remove ${person.name}${person.id ? '' : ' (new)'}`;
      button.setAttribute('aria-label', `Remove ${person.name}`);
      button.addEventListener('click', () => {
        if (savingRequest) return;
        requestParticipantSelection.delete(key); renderRequestSelection(); renderRequestPeople();
      });
      button.textContent = '×'; button.className = 'event-remove-icon';
      button.title = `Remove ${person.name}`;
      const row = document.createElement('div'); row.className = 'event-selected-person';
      const name = document.createElement('span'); name.className = 'event-selected-name';
      name.textContent = person.name + (person.id ? '' : ' (new)');
      const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = '✎';
      edit.setAttribute('aria-label', `Edit ${person.name}`); edit.title = `Edit ${person.name}`;
      edit.addEventListener('click', async () => {
        if (!verifiedAdmin || savingRequest) return;
        if (person.id) {
          const accountRevision = revision; edit.disabled = true;
          try {
            const { data, error } = await client.from('participants')
              .select('id,display_name,surname,phone,email,passport_number,notes').eq('id', person.id).maybeSingle();
            if (error) throw error;
            if (!verifiedAdmin || revision !== accountRevision) return;
            if (!data) throw new Error('Participant no longer exists. Refresh Events.');
            editingParticipant = { ...data };
            for (const [field, input] of Object.entries(participantFields)) el(input).value = data[field] || '';
            status('editParticipantStatus', ''); el('editParticipantDialog').showModal();
          } catch (error) {
            if (verifiedAdmin && revision === accountRevision) status('newRequestStatus', error.message || 'Unable to open participant details.');
          } finally { edit.disabled = false; }
        } else { editor.hidden = !editor.hidden; if (!editor.hidden) first.focus(); }
      });
      const editor = document.createElement('div'); editor.className = 'event-new-person-editor'; editor.hidden = true;
      const first = document.createElement('input'); first.value = person.firstName || ''; first.maxLength = 150;
      first.setAttribute('aria-label', 'Name'); first.placeholder = 'Name';
      const last = document.createElement('input'); last.value = person.surname || ''; last.maxLength = 150;
      last.setAttribute('aria-label', 'Surname'); last.placeholder = 'Surname';
      const phone = document.createElement('input'); phone.type = 'tel'; phone.maxLength = 40; phone.value = person.phone || '';
      phone.setAttribute('aria-label', 'Phone'); phone.placeholder = 'Phone (optional)';
      const save = document.createElement('button'); save.type = 'button'; save.textContent = '✓'; save.setAttribute('aria-label', 'Apply participant edits');
      save.addEventListener('click', () => {
        if (savingRequest) return;
        const firstName = first.value.trim().replace(/\s+/g, ' '), surname = last.value.trim().replace(/\s+/g, ' ');
        if (!firstName || firstName.length > 150 || surname.length > 150) {
          status('newRequestStatus', 'Enter a name; name and surname can each contain up to 150 characters.'); return;
        }
        const full = [firstName, surname].filter(Boolean).join(' ');
        if ([...requestParticipantSelection].some(([otherKey, other]) => otherKey !== key && nameKey(other.name) === nameKey(full)) ||
            requestPeople.some(other => nameKey(personName(other)) === nameKey(full))) {
          status('newRequestStatus', 'This participant is already listed. Select their existing record.'); return;
        }
        const phoneValue = phone.value.trim();
        if (phoneValue && (phoneValue.length > 40 || !/^[+0-9().\s-]+$/.test(phoneValue) || !/\d/.test(phoneValue))) {
          status('newRequestStatus', 'Enter a valid phone number.'); return;
        }
        person.firstName = firstName; person.surname = surname; person.name = full; person.phone = phoneValue;
        const updatedKey = 'new:' + nameKey(full);
        if (updatedKey !== key) { requestParticipantSelection.delete(key); requestParticipantSelection.set(updatedKey, person); }
        status('newRequestStatus', ''); renderRequestSelection();
      });
      editor.append(first, last, phone, save);
      row.append(button, name, edit, editor);
      el('requestSelectedParticipants').append(row);
    }
  }
  function renderRequestPeople() {
    const query = el('requestParticipantSearch').value.trim().toLowerCase();
    const host = el('requestPeople'); host.replaceChildren();
    for (const person of requestPeople.filter(person => person.searchText.toLowerCase().includes(query))) {
      const label = document.createElement('label');
      const input = document.createElement('input'); input.type = 'checkbox';
      const alreadyAdded = person.recordIds.some(id => requestExistingIds.has(id));
      input.checked = alreadyAdded || requestParticipantSelection.has(person.id);
      input.disabled = alreadyAdded;
      input.addEventListener('change', () => {
        if (savingRequest || alreadyAdded) return;
        if (input.checked) requestParticipantSelection.set(person.id, { id: person.id, name: personName(person), phone: person.phone || '', originalPhone: person.phone ?? null });
        else requestParticipantSelection.delete(person.id);
        renderRequestSelection();
      });
      const text = document.createElement('span');
      text.textContent = personName(person) + (person.phone ? ` · ${person.phone}` : '') + (alreadyAdded ? ' · Already added' : '');
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
        if (!verifiedAdmin || saving || savingRequest) return;
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
          const selected = requestParticipantSelection.get(person.id);
          if (selected) { selected.phone = value; selected.originalPhone = value || null; }
          text.textContent = personName(person) + (value ? ` · ${value}` : '');
          editor.hidden = true; edit.hidden = false; message.textContent = 'Saved';
          renderRequestSelection();
        } catch (error) {
          if (verifiedAdmin && revision === accountRevision) message.textContent = error.code === 'PGRST202'
            ? 'Run the updated database/basic-events.sql in Supabase.' : error.message || 'Unable to save. Try again.';
        } finally { saving = false; save.disabled = false; cancel.disabled = false; phone.disabled = false; }
      });
      editor.append(phone, save, cancel); row.append(label, edit, editor, message); host.append(row);
    }
    if (!host.children.length) host.textContent = requestPeopleReady ? 'No matching participants.' : 'Loading participants…';
  }

  el('queueRequestParticipant').addEventListener('click', () => {
    if (!verifiedAdmin || !requestPeopleReady || savingRequest) return;
    const firstName = el('requestNewParticipant').value.trim().replace(/\s+/g, ' ');
    const surname = el('requestNewParticipantSurname').value.trim().replace(/\s+/g, ' ');
    const name = [firstName, surname].filter(Boolean).join(' ');
    if (!firstName || firstName.length > 150 || surname.length > 150) { status('newRequestStatus', 'Enter a name; name and surname can each contain up to 150 characters.'); return; }
    const matches = requestPeople.filter(person => nameKey(personName(person)) === nameKey(name));
    if (matches.length > 1) {
      el('requestParticipantSearch').value = name; renderRequestPeople();
      status('newRequestStatus', 'Several participants have this name. Select the correct person from the list.'); return;
    }
    const enteredPhone = el('requestNewParticipantPhone').value.trim();
    if (enteredPhone && (!/^[+0-9().\s-]+$/.test(enteredPhone) || !/\d/.test(enteredPhone))) {
      status('newRequestStatus', 'Enter a valid phone number.'); return;
    }
    const phoneMatches = enteredPhone ? requestPeople.filter(person => normalizedParticipantPhone(person.phone) === normalizedParticipantPhone(enteredPhone)) : [];
    if (phoneMatches.length && (!matches[0] || matches[0].id !== phoneMatches[0].id)) {
      el('requestParticipantSearch').value = enteredPhone; renderRequestPeople();
      status('newRequestStatus', 'This phone belongs to an existing participant. Select them from the list.'); return;
    }
    const person = matches[0];
    if (person && person.recordIds.some(id => requestExistingIds.has(id))) { status('newRequestStatus', 'This participant is already on the request.'); return; }
    requestParticipantSelection.set(person ? person.id : 'new:' + nameKey(name), person ? { id: person.id, name: personName(person), phone: person.phone || '', originalPhone: person.phone ?? null } : { name, firstName, surname, phone: enteredPhone });
    el('requestNewParticipant').value = '';
    el('requestNewParticipantSurname').value = '';
    el('requestNewParticipantPhone').value = '';
    status('newRequestStatus', ''); renderRequestSelection(); renderRequestPeople();
  });


  let statisticsLoad = 0;
  let statisticsData = null;
  function statisticsRange() {
    const today = activityToday(), preset = el('statisticsRange').value || 'year';
    if (preset === 'all') return { start: null, end: null, label: 'All time' };
    if (preset === 'custom') {
      const start = el('statisticsStart').value, end = el('statisticsEnd').value;
      if (!start || !end || end < start) throw new Error('Choose valid From and To dates.');
      return { start, end, label: start.split('-').reverse().join('/') + ' – ' + end.split('-').reverse().join('/') };
    }
    const year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7));
    if (preset === 'month') {
      const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
      return { start: today.slice(0, 7) + '-01', end: today.slice(0, 7) + '-' + last, label: 'This month' };
    }
    return { start: year + '-01-01', end: year + '-12-31', label: 'This year' };
  }
  // Every activity/person pair contributes at most one attendance, even when
  // several legacy participant records share the same normalized phone.
  function buildStatistics(data, options) {
    const { start, end, scope, today } = options;
    const groups = groupParticipantRecords(data.participants);
    const identity = new Map(), people = new Map();
    for (const group of groups) {
      const records = data.participants.filter(person => group.recordIds.includes(person.id));
      if (records.some(person => person.is_admin_participant)) continue;
      people.set(group.id, { id: group.id, name: personName(group) || 'Unnamed participant' });
      for (const id of group.recordIds) identity.set(id, group.id);
    }
    const all = new Map();
    for (const row of data.events) {
      if (row.status === 'cancelled') continue;
      all.set('travel:' + row.id, { key: 'travel:' + row.id, category: 'travel', name: row.name,
        start: row.start_date, end: row.end_date || row.start_date, completed: row.status === 'completed', people: new Set() });
    }
    for (const row of data.activities) {
      all.set('local:' + row.id, { key: 'local:' + row.id, category: row.category, name: row.title,
        start: row.start_date, end: row.end_date || row.start_date, coach: row.coach, coachId: row.coach_user_id, people: new Set() });
    }
    for (const row of data.travelMemberships) {
      if (row.participant_status === 'cancelled') continue;
      const person = identity.get(row.participant_id), activity = all.get('travel:' + row.event_id);
      if (person && activity) activity.people.add(person);
    }
    for (const row of data.localMemberships) {
      const person = identity.get(row.participant_id), activity = all.get('local:' + row.activity_id);
      if (person && activity) activity.people.add(person);
    }
    const state = activity => activity.completed || activity.end < today ? 'past' : activity.start > today ? 'upcoming' : 'current';
    const inRange = date => date && (!start || date >= start) && (!end || date <= end);
    const dated = [...all.values()].filter(activity => inRange(activity.start));
    const selected = dated.filter(activity => (scope === 'all' || state(activity) === scope) && (!options.category || activity.category === options.category));
    const firstEver = new Map();
    for (const activity of all.values()) for (const id of activity.people) {
      if (activity.start && (!firstEver.has(id) || activity.start < firstEver.get(id))) firstEver.set(id, activity.start);
    }
    const peopleRows = new Map();
    for (const activity of selected) for (const id of activity.people) {
      if (!peopleRows.has(id)) peopleRows.set(id, { ...people.get(id), count: 0, first: activity.start, last: activity.start,
        returning: Boolean(start && firstEver.get(id) < start) });
      const row = peopleRows.get(id); ++row.count;
      if (activity.start < row.first) row.first = activity.start;
      if (activity.start > row.last) row.last = activity.start;
    }
    const aggregate = list => ({ count: list.length, people: new Set(list.flatMap(activity => [...activity.people])).size,
      attendances: list.reduce((sum, activity) => sum + activity.people.size, 0) });
    const totals = aggregate(selected);
    const types = ['travel', 'skydive', 'theory', 'flybox', 'social'].map(category => ({ category, ...aggregate(selected.filter(activity => activity.category === category)) }));
    const coaches = new Map(); let unassigned = 0;
    for (const activity of selected.filter(activity => activity.category !== 'travel')) {
      if (!activity.coachId && !activity.coach) { ++unassigned; continue; }
      const key = activity.coachId || 'name:' + activity.coach.trim().toLowerCase();
      if (!coaches.has(key)) coaches.set(key, { name: activity.coach || 'Admin', activities: [] });
      coaches.get(key).activities.push(activity);
    }
    const months = new Map();
    for (const activity of selected) { const key = activity.start.slice(0, 7); if (!months.has(key)) months.set(key, []); months.get(key).push(activity); }
    const requestDate = row => {
      if (!row.created_at) return null;
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(row.created_at));
      const part = type => parts.find(p => p.type === type).value;
      return part('year') + '-' + part('month') + '-' + part('day');
    };
    const requests = (data.requests || []).filter(row => inRange(requestDate(row)));
    return { totals, states: { past: dated.filter(a => state(a) === 'past').length, current: dated.filter(a => state(a) === 'current').length,
      upcoming: dated.filter(a => state(a) === 'upcoming').length },
      types, people: [...peopleRows.values()].sort((a,b) => b.count - a.count || a.name.localeCompare(b.name)),
      returning: [...peopleRows.values()].filter(row => row.returning).length,
      coaches: [...coaches.values()].map(row => ({ name: row.name, ...aggregate(row.activities) })).sort((a,b) => b.count - a.count || a.name.localeCompare(b.name)),
      unassigned, months: [...months].sort((a,b) => a[0].localeCompare(b[0])).map(([month, rows]) => ({ month, ...aggregate(rows) })), requests };
  }
  function statisticsTable(hostId, captionText, headers, rows) {
    const host = el(hostId); host.replaceChildren();
    if (!rows.length) { const p = document.createElement('p'); p.textContent = 'No records for these filters.'; host.append(p); return; }
    const table = document.createElement('table'); table.className = 'travel-events-table';
    const caption = document.createElement('caption'); caption.className = 'visually-hidden'; caption.textContent = captionText;
    const head = document.createElement('thead'), header = document.createElement('tr');
    for (const text of headers) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = text; header.append(th); }
    head.append(header); const body = document.createElement('tbody');
    for (const values of rows) { const row = document.createElement('tr'); for (const value of values) { const td = document.createElement('td'); td.textContent = String(value ?? '—'); row.append(td); } body.append(row); }
    table.append(caption, head, body); const scroll = document.createElement('div'); scroll.className = 'travel-events-scroll'; scroll.tabIndex = 0;
    scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', captionText); scroll.append(table); host.append(scroll);
  }
  function statisticsCards(hostId, cards) {
    el(hostId).replaceChildren();
    for (const [label, value] of cards) {
      const card = document.createElement('div'); card.className = 'statistics-card';
      const number = document.createElement('strong'); number.textContent = String(value);
      const title = document.createElement('span'); title.textContent = label; card.append(number, title); el(hostId).append(card);
    }
  }
  function renderStatistics() {
    if (!verifiedAdmin || !statisticsData) return;
    try {
      const range = statisticsRange(), scope = el('statisticsScope').value || 'past';
      const result = buildStatistics(statisticsData, { ...range, scope, today: activityToday() });
      const labels = { travel: 'Travel', ...localActivityLabels };
      const date = value => value ? value.split('-').reverse().join('/') : '—';
      el('statisticsPeriod').textContent = range.label + ' · ' + ({past:'Past activities',current:'Current activities',upcoming:'Upcoming activities',all:'All activities'}[scope]);
      el('statisticsActivityStates').textContent = `In this date range: ${result.states.past} past · ${result.states.current} current · ${result.states.upcoming} upcoming activities`;
      statisticsCards('statisticsCards', [['Activities',result.totals.count],['Unique participants',result.totals.people],['Attendances',result.totals.attendances],
        ['Average group size',result.totals.count ? (result.totals.attendances/result.totals.count).toFixed(1) : '0'],
        ['First-time participants',result.totals.people-result.returning],['Returning participants',result.returning]]);
      const peopleHeaders = ['Participant','Attendances','First activity in range','Last activity in range','Participation'];
      const peopleRows = result.people.map(row => [row.name,row.count,date(row.first),date(row.last),row.returning?'Returning':'First-time']);
      const category = el('statisticsPeopleCategory').value || '';
      const ranked = category ? buildStatistics(statisticsData, { ...range, scope, today: activityToday(), category }).people : result.people;
      const requestedLimit = el('statisticsPeopleLimit').value || '5';
      const limit = requestedLimit === 'all' ? ranked.length : Math.max(1, Number(requestedLimit) || 5);
      const shown = ranked.slice(0, limit);
      el('statisticsPeopleCount').textContent = 'Showing ' + shown.length + ' of ' + ranked.length + ' participants · ' + (labels[category] || 'All activities') + ' · Ranked by attendances, using the date range and activity scope above.';
      statisticsTable('statisticsOverviewPeople','Most active participants',['#', ...peopleHeaders],shown.map((row,index) =>
        [index + 1,row.name,row.count,date(row.first),date(row.last),row.returning?'Returning':'First-time']));
      statisticsTable('statisticsTypes','Activity types',['Type','Activities','Unique participants','Attendances','Average group size'],result.types.map(row =>
        [labels[row.category] || row.category,row.count,row.people,row.attendances,row.count?(row.attendances/row.count).toFixed(1):'0']));
      el('statisticsParticipationNote').textContent = 'Returning participants had an activity before the selected date range. First-time participants have their earliest recorded activity within this range.';
      statisticsTable('statisticsPeople','Participant activity statistics',peopleHeaders,peopleRows);
      el('statisticsCoachesNote').textContent = 'Coach figures cover local activities; Travel coach assignments are not included. Unassigned local activities: ' + result.unassigned + '.';
      statisticsTable('statisticsCoaches','Coach statistics',['Coach / organizer','Activities','Unique participants','Attendances'],result.coaches.map(row=>[row.name,row.count,row.people,row.attendances]));
      statisticsTable('statisticsMonths','Monthly activity statistics',['Month','Activities','Unique participants','Attendances'],result.months.map(row=>[row.month,row.count,row.people,row.attendances]));
      if (statisticsData.requestsError) {
        el('statisticsRequestCards').replaceChildren(); el('statisticsRequests').replaceChildren();
        el('statisticsRequestsNote').textContent = 'Request statistics could not be loaded. Apply database/requests.sql if Requests has not been set up, then refresh statistics.';
      } else {
        el('statisticsRequestsNote').textContent = 'Requests use their creation date and the same date range. The activity scope does not filter requests.';
        const statuses=['new','in_progress','done','cancelled'];
        statisticsCards('statisticsRequestCards',[['Total requests',result.requests.length],...statuses.map(status=>
          [{new:'New',in_progress:'In progress',done:'Done',cancelled:'Cancelled'}[status],result.requests.filter(row=>row.status===status).length])]);
        statisticsTable('statisticsRequests','Requests by type',['Type','Total','New','In progress','Done','Cancelled'],Object.keys(requestTypeLabels).map(type=>{
          const rows=result.requests.filter(row=>row.request_type===type);
          return [requestTypeLabels[type],rows.length,...statuses.map(status=>rows.filter(row=>row.status===status).length)];
        }));
      }
      el('statisticsContent').hidden = false; status('statisticsStatus','');
    } catch(error) { el('statisticsContent').hidden = true; status('statisticsStatus',error.message || 'Unable to display statistics.'); }
  }
  function setStatisticsView(view, focus = false, updateUrl = true) {
    if (!verifiedAdmin) return;
    activeStatisticsView = statisticsViews.includes(view) ? view : 'overview';
    for (const name of statisticsViews) {
      const selected = name === activeStatisticsView, button = el('statistics'+name+'Tab');
      button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;
      el('statistics'+name+'Panel').hidden=!selected;if(selected&&focus)button.focus();
    }
    if(updateUrl && activePage==='statistics')writeRoute();
  }
  async function loadStatistics() {
    if(!verifiedAdmin)return;
    const request=++statisticsLoad;statisticsData=null;el('statisticsContent').hidden=true;
    status('statisticsStatus','Loading statistics…');el('refreshStatistics').disabled=true;
    const specs=[
      ['participants','participants','id,display_name,surname,phone,email,is_admin_participant',['id']],
      ['events','events','id,name,start_date,end_date,status,event_type',['id']],
      ['activities','sequence_activities','id,title,category,start_date,end_date,coach,coach_user_id',['id']],
      ['travelMemberships','event_participants','id,event_id,participant_id,participant_status',['id']],
      ['localMemberships','sequence_activity_participants','activity_id,participant_id',['activity_id','participant_id']],
      ['requests','sequence_requests','id,request_type,status,created_at',['id']]
    ];
    const results=await Promise.allSettled(specs.map(async([,table,columns,order])=>{
      const rows=[];
      for(let start=0; ; start+=500){
        let query=client.from(table).select(columns);for(const column of order)query=query.order(column);
        const {data,error}=await query.range(start,start+499);if(error)throw error;
        if(!verifiedAdmin || request!==statisticsLoad)return null;
        rows.push(...data);if(data.length<500)return rows;
      }
    }));
    if(!verifiedAdmin || request!==statisticsLoad)return;
    try{
      const data={};let coreError=null;
      results.forEach((result,index)=>{
        const key=specs[index][0];
        if(result.status==='fulfilled')data[key]=result.value;
        else if(key==='requests'){data.requests=[];data.requestsError=true;}
        else coreError=result.reason;
      });
      if(coreError)throw coreError;
      statisticsData=data;renderStatistics();
    }catch(error){status('statisticsStatus',['PGRST205','42P01','42703'].includes(error.code)
      ?'Activity statistics need the updated database/local-activities.sql. Run it in Supabase, then refresh.'
      :'Unable to load statistics. Refresh to retry.');}
    finally{el('refreshStatistics').disabled=false;}
  }
  for(const [index,view] of statisticsViews.entries()){
    const button=el('statistics'+view+'Tab');button.addEventListener('click',()=>setStatisticsView(view));
    button.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
      const next=event.key==='Home'?0:event.key==='End'?statisticsViews.length-1:(index+(event.key==='ArrowRight'?1:-1)+statisticsViews.length)%statisticsViews.length;
      setStatisticsView(statisticsViews[next],true);
    });
  }
  el('statisticsRange').addEventListener('change',()=>{el('statisticsCustomDates').hidden=el('statisticsRange').value!=='custom';renderStatistics();});
  for(const id of ['statisticsScope','statisticsStart','statisticsEnd','statisticsPeopleCategory','statisticsPeopleLimit'])el(id).addEventListener('change',renderStatistics);
  el('refreshStatistics').addEventListener('click',loadStatistics);

  let profileDataCache = null;
  let gearEditing = null;
  let gearSaving = false;
  function participantInfo(person) {
    const rows = (person.recordIds || [person.id]).map(id => participantRecords.find(row => row.id === id)).filter(Boolean);
    const result = { ...person };
    for (const field of Object.keys(participantFields)) {
      if (result[field] == null || String(result[field]).trim() === '') {
        const source = rows.find(row => row[field] != null && String(row[field]).trim() !== '');
        if (source) result[field] = source[field];
      }
    }
    return result;
  }
  function deriveParticipantProfile(travel, local, gear, ids, today) {
    const activities = new Map();
    const validTravel = travel.filter(row => row.events && row.participant_status !== 'cancelled' && row.events.status !== 'cancelled');
    const rank = { invited: 1, active: 2, completed: 3 };
    for (const row of validTravel) {
      const key = 'travel:' + row.events.id, existing = activities.get(key);
      const state = row.participant_status === 'completed' || row.events.status === 'completed' || row.events.end_date < today ? 'Past'
        : row.events.start_date > today ? 'Upcoming' : 'Current';
      if (!existing || (rank[row.participant_status] || 0) > existing.rank) activities.set(key, {
        name: row.events.name, category: row.events.event_type === 'tunnel' ? 'Travel · Tunnel' : 'Travel · Skydive',
        start: row.events.start_date, end: row.events.end_date, state, coach: '', rank: rank[row.participant_status] || 0
      });
    }
    for (const row of local) {
      const activity = row.sequence_activities; if (!activity) continue;
      activities.set('local:' + activity.id, { name: activity.title, category: localActivityLabels[activity.category] || activity.category,
        start: activity.start_date, end: activity.end_date, coach: activity.coach || '',
        state: activity.end_date < today ? 'Past' : activity.start_date > today ? 'Upcoming' : 'Current' });
    }
    validTravel.sort((a,b) => (b.events.start_date || '').localeCompare(a.events.start_date || '') || String(a.id).localeCompare(String(b.id)));
    const source = row => ({ text: row.events.name, date: row.events.start_date });
    const latest = field => {
      const row = validTravel.find(row => row[field] != null && String(row[field]).trim() !== '');
      return row ? { value: row[field], source: source(row) } : { value: null, source: null };
    };
    const experience = Object.fromEntries(['number_of_jumps','last_jump_date','tunnel_minutes_total','license_text','water_training_done','canopy_course_done'].map(field => [field, latest(field)]));
    const overrides = [...gear].filter(row => ids.includes(row.participant_id)).sort((a,b) => (b.updated_at || '').localeCompare(a.updated_at || '') || String(a.participant_id).localeCompare(String(b.participant_id)));
    const current = overrides[0] || null;
    const equipment = {};
    for (const field of ['canopy_size','reserve_size','reserve_date','reserve_rental','notes']) {
      equipment[field] = current && current[field] != null && String(current[field]).trim() !== ''
        ? { value: current[field], source: { text: 'Saved gear profile', date: current.updated_at?.slice(0,10) } }
        : ['canopy_size','reserve_date','reserve_rental'].includes(field) ? latest(field) : { value:null,source:null };
    }
    return { activities: [...activities.values()].sort((a,b) => (b.start || '').localeCompare(a.start || '') || a.name.localeCompare(b.name)), experience, equipment, current };
  }
  function renderParticipantProfile(profile) {
    const date = value => value ? value.split('-').reverse().join('/') : '—';
    const source = item => item.source ? item.source.text + (item.source.date ? ' · ' + date(item.source.date) : '') : '—';
    const display = (item, format = String) => item.value == null ? '—' : format(item.value);
    const rows = profile.activities.map(activity => [activity.name, activity.category,
      activity.start === activity.end ? date(activity.start) : date(activity.start) + ' – ' + date(activity.end), activity.state, activity.coach]);
    el('participationHistory').replaceChildren(historyTable(`Participation (${rows.length})`,['Activity / event','Category','Dates','Status','Coach / organizer'],rows));
    const labels = {number_of_jumps:'Number of jumps',last_jump_date:'Last jump date',tunnel_minutes_total:'Total tunnel time',license_text:'License',water_training_done:'Water training',canopy_course_done:'Canopy course'};
    const formats = {last_jump_date:date,tunnel_minutes_total:value=>Math.floor(Number(value)/60)+'h '+(Number(value)%60)+'m',water_training_done:value=>value?'Yes':'No',canopy_course_done:value=>value?'Yes':'No'};
    el('participantExperience').replaceChildren(historyTable('Latest recorded experience',['Field','Value','Source'],Object.entries(labels).map(([field,label])=>{
      const item=profile.experience[field];return [label,display(item,formats[field] || String),source(item)];
    })));
    const gearLabels={canopy_size:'Main canopy size (sq ft)',reserve_size:'Reserve size (sq ft)',reserve_date:'Reserve repack date',reserve_rental:'Equipment',notes:'Gear notes'};
    el('gearHistory').replaceChildren(historyTable('Gear',['Field','Value','Source'],Object.entries(gearLabels).map(([field,label])=>{
      const item=profile.equipment[field];const format=field==='reserve_date'?date:field==='reserve_rental'?value=>value?'Rental gear':'Own gear':String;
      return [label,display(item,format),source(item)];
    })));
  }
  async function loadParticipantProfileData(participantId) {
    if(!verifiedAdmin)return;
    const request=++activitySkillRequest;
    const ids=participants.find(person=>person.id===participantId)?.recordIds || [participantId];
    const current=()=>verifiedAdmin && request===activitySkillRequest && selectedParticipantId===participantId;
    profileDataCache=null;el('editParticipantGear').disabled=true;
    for(const id of ['participationHistory','participantExperience','gearHistory'])el(id).replaceChildren();
    status('profileDataStatus','Loading participation and profile data…');status('gearStatus','');
    const read=async(table,columns,orders)=>{
      const rows=[];
      for(let start=0; ; start+=500){
        let query=client.from(table).select(columns).in('participant_id',ids);for(const order of orders)query=query.order(order);
        const {data,error}=await query.range(start,start+499);if(error)throw error;
        if(!current())return null;rows.push(...data);if(data.length<500)return rows;
      }
    };
    const results=await Promise.allSettled([
      read('event_participants','id,event_id,participant_status,number_of_jumps,last_jump_date,tunnel_minutes_total,canopy_size,reserve_date,reserve_rental,license_text,water_training_done,canopy_course_done,events(id,name,start_date,end_date,status,event_type)',['id']),
      read('sequence_activity_participants','activity_id,participant_id,sequence_activities(id,title,category,start_date,end_date,coach)',['activity_id','participant_id']),
      read('participant_gear_profiles','participant_id,canopy_size,reserve_size,reserve_date,reserve_rental,notes,updated_at',['participant_id'])
    ]);
    if(!current())return;
    const warnings=[];const values=results.map((result,index)=>{
      if(result.status==='fulfilled')return result.value || [];
      if(index===2){status('gearStatus',['PGRST205','42P01'].includes(result.reason.code)?'Run database/participant-gear.sql to enable gear editing. Travel gear data is still shown.':'Saved gear data could not be loaded. Refresh participants to retry.');}
      else warnings.push(index===0?'Travel data could not be loaded.':'Local activity data could not be loaded.');
      return [];
    });
    const profile=deriveParticipantProfile(values[0],values[1],values[2],ids,activityToday());
    profileDataCache={participantId,profile,gearReady:results[2].status==='fulfilled'};
    renderParticipantProfile(profile);el('editParticipantGear').disabled=!profileDataCache.gearReady;
    status('profileDataStatus',warnings.join(' '));
  }
  el('editParticipantGear').addEventListener('click',()=>{
    if(!verifiedAdmin || gearSaving || !profileDataCache?.gearReady || profileDataCache.participantId!==selectedParticipantId)return;
    const current=profileDataCache.profile.current;
    gearEditing={participantId:selectedParticipantId,targetId:current?.participant_id || selectedParticipantId,expected:current?.updated_at || null};
    el('participantGearForm').reset();
    for(const [field,id] of Object.entries({canopy_size:'gearCanopySize',reserve_size:'gearReserveSize',reserve_date:'gearReserveDate',notes:'gearNotes'}))el(id).value=current?.[field] ?? '';
    el('gearRental').value=current?.reserve_rental==null?'':current.reserve_rental?'rental':'own';
    status('participantGearFormStatus','');el('participantGearDialog').showModal();
  });
  el('cancelParticipantGear').addEventListener('click',()=>{if(!gearSaving)el('participantGearDialog').close();});
  el('participantGearDialog').addEventListener('cancel',event=>{if(gearSaving)event.preventDefault();});
  el('participantGearDialog').addEventListener('close',()=>{gearEditing=null;el('participantGearForm').reset();status('participantGearFormStatus','');});
  el('participantGearForm').addEventListener('submit',async event=>{
    event.preventDefault();if(!verifiedAdmin || gearSaving || !gearEditing || !el('participantGearForm').reportValidity())return;
    const canopy=el('gearCanopySize').value,reserve=el('gearReserveSize').value,notes=el('gearNotes').value.trim();
    if([canopy,reserve].some(value=>value!=='' && (!Number.isFinite(Number(value)) || Number(value)<=0)) || notes.length>5000){status('participantGearFormStatus','Use positive canopy sizes and notes under 5000 characters.');return;}
    const original={...gearEditing},accountRevision=revision;gearSaving=true;el('participantGearFields').disabled=true;status('participantGearFormStatus','Saving…');
    try{
      const {data,error}=await client.rpc('admin_save_participant_gear',{
        p_participant_id:original.targetId,p_expected_updated_at:original.expected,p_canopy_size:canopy===''?null:Number(canopy),p_reserve_size:reserve===''?null:Number(reserve),
        p_reserve_date:el('gearReserveDate').value || null,p_reserve_rental:el('gearRental').value===''?null:el('gearRental').value==='rental',p_notes:notes||null
      });
      if(error)throw error;if(!data)throw new Error('Unable to verify gear save. Reopen Gear and try again.');
      if(!verifiedAdmin || revision!==accountRevision)return;el('participantGearDialog').close();
      if(selectedParticipantId===original.participantId)await loadParticipantProfileData(original.participantId);
    }catch(error){if(verifiedAdmin && revision===accountRevision)status('participantGearFormStatus',error.code==='PGRST202'?'Run database/participant-gear.sql in Supabase before saving.':error.message||'Unable to save gear.');}
    finally{gearSaving=false;el('participantGearFields').disabled=false;}
  });


  // Reuse the verified admin session only for links to the owned Travel site.
  document.addEventListener('click', event => {
    if (!verifiedAdmin || event.defaultPrevented || (event.button != null && event.button !== 0)) return;
    const link = event.target.closest?.('a[href]');
    if (!link || !window.SequenceAdminSession) return;
    let url;
    try { url = new URL(link.href, window.location.href); } catch { return; }
    if (url.origin !== 'https://shakshuka-travel.pages.dev' || !['/', '/index.html', '/admin.html'].includes(url.pathname)) return;
    const child = window.SequenceAdminSession.openTravel(client, () => verifiedAdmin, url.href);
    if (child) event.preventDefault();
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





