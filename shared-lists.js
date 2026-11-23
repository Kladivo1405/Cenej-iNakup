const byId = id => document.getElementById(id);
const project = 'https://pccpqzkdmuedtshpbvph.supabase.co';
const appUrl = new URL('.', location.href);
const inviteKey = 'cn_pending_shared_invite';
const address = new URL(location.href);
const invitation = address.searchParams.get('povabilo');
if (invitation) {
  if (/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(invitation)) {
    sessionStorage.setItem(inviteKey, invitation);
  }
  address.searchParams.delete('povabilo');
  history.replaceState(null, '', address);
}

let client, account, lists = [], current = '', generation = 0, rowsSignature = '';
let loadingClient, updating = false;
const status = message => { byId('sharedStatus').textContent = message; };

async function connect() {
  if (client) return client;
  const key = localStorage.getItem('cn_sb_key');
  if (!key || localStorage.getItem('cn_sb_url')?.replace(/\/$/, '') !== project) {
    throw new Error('Najprej shrani povezavo s projektom CenejšiNakup v nastavitvah Supabase.');
  }
  loadingClient ??= import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/+esm')
    .then(({createClient}) => {
      client = createClient(project, key, {auth: {flowType: 'pkce'}});
      client.auth.onAuthStateChange((event, session) => {
        setTimeout(() => syncAccount(session?.user), 0);
      });
      return client;
    }).catch(error => { loadingClient = null; throw error; });
  return loadingClient;
}

async function query(request) {
  const {data, error} = await request;
  if (error) throw error;
  return data;
}

function action(handler) {
  return async event => {
    event.preventDefault();
    if (updating) return;
    updating = true;
    try { await handler(event); }
    catch (error) { status(error.message || 'Dejanja ni bilo mogoče dokončati.'); }
    finally { updating = false; }
  };
}

async function syncAccount(user) {
  if (account?.id === user?.id && account) return;
  account = user;
  generation++;
  current = '';
  lists = [];
  byId('sharedUser').textContent = user?.email || '';
  byId('sharedAccount').hidden = !user;
  byId('googleLogin').hidden = Boolean(user);
  byId('sharedBasket').hidden = true;
  byId('sharedInvite').hidden = true;
  hideLink();
  byId('sharedItems').replaceChildren();
  if (!user) return;
  try {
    const token = sessionStorage.getItem(inviteKey);
    if (token) {
      sessionStorage.removeItem(inviteKey);
      try {
        current = await query(client.rpc('join_shared_list', {invitation: token}));
        status('Pridružil si se skupnemu listku.');
      } catch (error) { status(error.message); }
    }
    await refreshLists();
  } catch (error) { status(error.message); }
}

function hideLink() {
  byId('sharedLinkRow').hidden = true;
  byId('sharedLink').value = '';
}

async function refreshLists() {
  const revision = generation;
  const results = await query(client.from('shared_lists').select('id,name,owner_id').order('created_at'));
  if (revision !== generation || !account) return;
  lists = results;
  const select = byId('sharedSelect');
  select.replaceChildren(...lists.map(list => new Option(list.name, list.id)));
  select.value = lists.some(list => list.id === current) ? current : lists[0]?.id || '';
  await openList(select.value);
}

async function openList(id) {
  current = id;
  generation++;
  rowsSignature = '';
  hideLink();
  byId('sharedItems').replaceChildren();
  byId('sharedBasket').hidden = !id;
  byId('sharedInvite').hidden = !lists.some(list => list.id === id && list.owner_id === account?.id);
  await refreshRows();
}

async function refreshRows() {
  if (!account || !current) return;
  const listId = current, revision = generation;
  const rows = await query(client.from('shared_list_items')
    .select('id,name,qty,bought').eq('list_id',listId).order('created_at').order('id'));
  if (revision !== generation) return;
  const signature = JSON.stringify(rows);
  if (signature === rowsSignature) return;
  rowsSignature = signature;
  const container = byId('sharedItems');
  container.replaceChildren();
  for (const row of rows) {
    const line = document.createElement('div');
    line.className = 'line row';
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.style.width = 'auto';
    checkbox.checked = row.bought;
    const text = document.createElement(row.bought ? 's' : 'span');
    text.textContent = ' ' + row.qty + ' × ' + row.name;
    label.append(checkbox, text);
    checkbox.onchange = async () => {
      checkbox.disabled = true;
      try {
        await query(client.from('shared_list_items').update({bought: checkbox.checked}).eq('id', row.id).eq('list_id',listId));
        await refreshRows();
      } catch (error) {
        checkbox.checked = row.bought;
        status(error.message);
      } finally { checkbox.disabled = false; }
    };
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'delete';
    remove.textContent = '✕';
    remove.setAttribute('aria-label', 'Odstrani ' + row.name);
    remove.onclick = action(async () => {
      await query(client.from('shared_list_items').delete().eq('id',row.id).eq('list_id',listId));
      await refreshRows();
    });
    line.append(label, remove);
    container.append(line);
  }
  if (!rows.length) container.textContent = 'Skupni listek je prazen.';
}

byId('googleLogin').onclick = action(async () => {
  const auth = (await connect()).auth;
  await query(auth.signInWithOAuth({provider:'google',options:{redirectTo:appUrl.href}}));
});
byId('googleLogout').onclick = action(async () => {
  await query(client.auth.signOut());
  status('Odjavljen si.');
});
byId('sharedCreate').onsubmit = action(async () => {
  const input = byId('sharedName');
  const name = input.value.trim();
  if (!name) return;
  const initial = byId('sharedCopy').checked ? items.map(({name, qty}) => ({name, qty})) : [];
  current = await query(client.rpc('create_shared_list',{list_name:name,initial_items:initial}));
  input.value = '';
  await refreshLists();
  status('Skupni listek je ustvarjen.');
});
byId('sharedSelect').onchange = action(event => openList(event.target.value));
byId('sharedAdd').onsubmit = action(async () => {
  const input = byId('sharedProduct');
  const name = input.value.trim();
  if (!name || !current) return;
  await query(client.from('shared_list_items').insert({list_id:current,name}));
  input.value = '';
  await refreshRows();
});
byId('sharedInvite').onclick = action(async () => {
  const token = await query(client.rpc('invite_to_shared_list',{target:current}));
  const link = new URL(appUrl);
  link.searchParams.set('povabilo',token);
  byId('sharedLink').value = link.href;
  byId('sharedLinkRow').hidden = false;
  status('Povezava velja sedem dni in omogoča eno pridružitev.');
});
byId('sharedCopyLink').onclick = action(async () => {
  const input = byId('sharedLink');
  try {
    await navigator.clipboard.writeText(input.value);
    status('Povezava je kopirana.');
  } catch {
    input.focus();
    input.select();
    status('Kopiraj označeno povezavo.');
  }
});
if (localStorage.getItem('cn_sb_key')) connect().catch(error => status(error.message));
if (invitation) status('Prijavi se z Googlom, da se pridružiš listku.');
setInterval(() => {
  if (!document.hidden && !updating) refreshRows().catch(error => status(error.message));
}, 4000);
