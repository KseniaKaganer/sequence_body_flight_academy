const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../google-login.js'), 'utf8');
function harness({ enabled = true, authError, url = 'https://sequence.example/index.html?private=value#requests' } = {}) {
  const calls = []; const nodes = {};
  for (const id of ['googleLogin', 'loginStatus', 'loginDialog']) nodes[id] = { disabled: true, textContent: '', addEventListener(type, fn) { this[type] = fn; }, showModal() { this.open = true; } };
  const location = new URL(url); const history = [];
  const window = { location, history: { replaceState(...args) { history.push(args[2]); } }, SEQUENCE_CONFIG: { supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'public-key' } };
  const client = { auth: { async signInWithOAuth(args) { calls.push(args); return { error: authError }; } } };
  const context = vm.createContext({ window, URL, URLSearchParams, document: { getElementById: id => nodes[id] }, fetch: async (url, options) => { assert.equal(url, 'https://project.supabase.co/auth/v1/settings'); assert.equal(options.headers.apikey, 'public-key'); return { ok: true, json: async () => ({ external: { google: enabled } }) }; } });
  vm.runInContext(source, context); window.SequenceGoogleLogin.setup(client);
  return { nodes, calls, history };
}
test('Google login checks availability and sends a clean same-site callback without query or hash', async () => {
  const h = harness(); assert.equal(h.nodes.googleLogin.disabled, false);
  await h.nodes.googleLogin.click();
  assert.equal(h.calls.length, 1); const request = h.calls[0];
  assert.equal(request.provider, 'google');
  assert.equal(request.options.redirectTo, 'https://sequence.example/index.html');
  assert.equal(request.options.queryParams.prompt, 'select_account');
});
test('disabled provider keeps users on the email login without starting OAuth', async () => {
  const h = harness({ enabled: false }); await h.nodes.googleLogin.click();
  assert.equal(h.calls.length, 0); assert.match(h.nodes.loginStatus.textContent, /not available yet/);
  assert.equal(h.nodes.googleLogin.disabled, false);
});
test('OAuth initiation failure restores the button and offers password login', async () => {
  const h = harness({ authError: { message: 'Network failure' } }); await h.nodes.googleLogin.click();
  assert.match(h.nodes.loginStatus.textContent, /try again or use email and password/);
  assert.equal(h.nodes.googleLogin.disabled, false);
});
test('cancelled callback opens login and removes OAuth errors without echoing provider text', () => {
  const h = harness({ url: 'https://sequence.example/index.html?keep=1#error=access_denied&error_description=untrusted' });
  assert.equal(h.nodes.loginDialog.open, true);
  assert.match(h.nodes.loginStatus.textContent, /cancelled/);
  assert.deepEqual(h.history, ['https://sequence.example/index.html?keep=1']);
  assert.doesNotMatch(h.nodes.loginStatus.textContent, /untrusted/);
});
