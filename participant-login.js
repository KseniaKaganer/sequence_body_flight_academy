/* Participant tokens grant only Sequence participant access, never admin roles. */
(() => {
  'use strict';
  const key = 'sequence-participant-session-v1';
  let client, identity = null, serial = 0;
  const read = () => { try { return sessionStorage.getItem(key); } catch { return null; } };
  const clear = () => { try { sessionStorage.removeItem(key); } catch {} identity = null; };
  window.SequenceParticipant = {
    setup(value) { client = value; },
    async restore() {
      const current = ++serial, token = read();
      if (!client || !token || window.SEQUENCE_CONFIG?.participantLoginEnabled !== true) return null;
      const { data, error } = await client.rpc('sequence_participant_session', { p_token: token });
      if (current !== serial) return null;
      if (error) throw new Error('Unable to verify participant login. Please try again.');
      if (!data?.ok) { clear(); return null; }
      identity = data; return identity;
    },
    async login(name, phone) {
      if (window.SEQUENCE_CONFIG?.participantLoginEnabled !== true) throw new Error('Participant login is not enabled yet.');
      const current = ++serial;
      const { data, error } = await client.rpc('sequence_participant_login', { p_name: name.trim(), p_phone: phone.trim() });
      if (current !== serial) throw new Error('Login was cancelled.');
      if (error) throw new Error('Unable to log in. Please try again.');
      if (!data?.ok || !data.token) throw new Error('Name or phone number not recognized. Check your details or try again later.');
      try { sessionStorage.setItem(key, data.token); } catch {
        await client.rpc('sequence_participant_logout', { p_token: data.token });
        throw new Error('Please allow browser storage to stay logged in.');
      }
      identity = data; return identity;
    },
    async logout() {
      ++serial;
      const token = read();
      // Keep the local session if revocation fails so logout can be retried.
      if (token) { const { error } = await client.rpc('sequence_participant_logout', { p_token: token }); if (error) throw error; }
      clear();
    }
  };
})();
