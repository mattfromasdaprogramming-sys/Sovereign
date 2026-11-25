const $ = (id) => document.getElementById(id);

const fmtCredits = (minor) =>
  (Number(minor ?? 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

let revision = 0;

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || data.error || res.statusText), { data });
  return data;
}

async function loadWorld() {
  try {
    const { world, counts } = await api('/api/world');
    $('world-facts').innerHTML = `
      <div><dt>Tick</dt><dd>${world.current_tick}</dd></div>
      <div><dt>Next tick</dt><dd>${fmtTime(world.next_tick_at)}</dd></div>
      <div><dt>Nations</dt><dd>${counts.nations}</dd></div>
      <div><dt>Players</dt><dd>${counts.players}</dd></div>`;
    $('clock').textContent = `rev ${world.revision} · every ${world.interval_minutes} min`;
    $('code-row').hidden = world.signup?.mode !== 'invite';
  } catch {
    $('clock').textContent = 'world unavailable';
  }
}

async function loadMe() {
  const { player, wallet } = await api('/api/me');

  if (!player) {
    $('signed-out').hidden = false;
    $('signed-in').hidden = true;
    return;
  }

  $('signed-out').hidden = true;
  $('signed-in').hidden = false;
  $('who-handle').textContent = `@${player.handle}`;
  $('wallet-balance').textContent = fmtCredits(wallet?.balance);
}

async function loadNations() {
  const { nations } = await api('/api/nations');
  if (nations.length === 0) {
    $('nations').innerHTML =
      '<p class="muted">No nations yet — seed the world from the existing game data (see README).</p>';
    return;
  }
  $('nations').innerHTML = nations
    .map(
      (n) => `<div class="nation"><b>${n.flag_emoji} ${n.name}</b>
        <span>${n.capital} · pop ${Number(n.population).toLocaleString()}</span></div>`,
    )
    .join('');
}

async function pollChanges() {
  try {
    const data = await api(`/api/changes?since=${revision}`);
    revision = data.revision;

    if (data.changes.length > 0) {
      const list = $('feed');
      if (list.firstElementChild?.classList.contains('muted')) list.innerHTML = '';
      for (const c of data.changes.slice().reverse()) {
        const li = document.createElement('li');
        li.innerHTML = `<b>${c.entity_type}#${c.entity_id}</b> ${c.change} · tick ${c.tick}`;
        list.prepend(li);
      }
      while (list.children.length > 60) list.lastElementChild.remove();
      loadWorld();
      loadNations();
    }
  } catch {
    /* server may be restarting */
  }
}

$('auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const mode = event.submitter?.dataset.mode ?? 'login';
  const form = new FormData(event.currentTarget);
  $('auth-error').textContent = '';

  try {
    await api(`/api/auth/${mode}`, {
      method: 'POST',
      body: JSON.stringify({
        handle: form.get('handle'),
        password: form.get('password'),
        code: form.get('code'),
      }),
    });
    event.currentTarget.reset();
    await Promise.all([loadMe(), pollChanges()]);
  } catch (err) {
    $('auth-error').textContent = err.message;
  }
});

$('logout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  await loadMe();
});

await Promise.all([loadWorld(), loadMe(), loadNations()]);
await pollChanges();
setInterval(pollChanges, 4000);
