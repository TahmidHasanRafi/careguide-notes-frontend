/* Secure Notes – vanilla JS client for the Notes API (Care Guide interview task).
 * Every piece of user content is inserted as text (via h()), never as HTML. */
(() => {
  const API = (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || '/api';
  const PAGE_SIZE = 5;
  const LOGO = 'assets/logo.webp';

  const state = {
    token: readStore('token'),
    user: JSON.parse(readStore('user') || 'null'),
    tab: 'notes',
    authMode: 'login',
    log: [],
    logOpen: false,
  };

  /* ================= helpers ================= */
  function readStore(k) {
    try { return localStorage.getItem(k); } catch { return null; }
  }
  function writeStore(k, v) {
    try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage blocked */ }
  }

  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    let value;
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'class') el.className = v;
      else if (k === 'value') value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    if (value !== undefined) el.value = value;
    return el;
  }

  function toast(message, type = 'ok') {
    const t = h('div', { class: `toast ${type === 'error' ? 'error' : ''}` }, message);
    document.getElementById('toasts').append(t);
    setTimeout(() => t.remove(), 3800);
  }

  const fmt = (d) => (d ? new Date(d).toLocaleString() : '');
  const parseList = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const can = (perm) =>
    !!state.user && (state.user.role === 'admin' || (state.user.role === 'staff' && (state.user.permissions || []).includes(perm)));
  const roleTag = (u) => h('span', { class: `tag ${u.role === 'admin' ? 'admin' : u.role === 'staff' ? 'staff' : ''}` }, u.role);

  /* ================= API client (+ request log) ================= */
  async function api(path, { method = 'GET', body, query } = {}) {
    const url = new URL(API + path, location.href);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
      }
    }
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;

    const started = performance.now();
    let res;
    try {
      res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch {
      record(method, url, 'offline', started);
      throw new Error(`Cannot reach the API at ${API}. Is the backend running?`);
    }
    record(method, url, res.status, started);

    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && state.token) {
        logout();
        const why = data?.error?.message;
        throw new Error(why && !/token|Authentication/.test(why) ? `${why}. You have been signed out.` : 'Your session has ended. Log in again.');
      }
      let msg = data?.error?.message || `Request failed (${res.status})`;
      const d = data?.error?.details;
      const parts = [];
      if (d?.fieldErrors) for (const [k, v] of Object.entries(d.fieldErrors)) parts.push(`${k}: ${v.join(', ')}`);
      if (d?.formErrors?.length) parts.push(...d.formErrors);
      if (parts.length) msg += ` — ${parts.join('; ')}`;
      throw new Error(msg);
    }
    return data;
  }

  function record(method, url, status, started) {
    const path = url.pathname.replace(/^.*?\/api/, '/api') + url.search;
    state.log.unshift({ method, path, status, ms: Math.round(performance.now() - started) });
    state.log.length = Math.min(state.log.length, 60);
    renderLog();
  }

  /* ================= small building blocks ================= */
  function pager(p, onGo) {
    return h(
      'div',
      { class: 'pager' },
      h('button', { class: 'secondary small', disabled: p.page <= 1, onclick: () => onGo(p.page - 1) }, 'Previous'),
      h('span', {}, `Page ${p.page} of ${p.totalPages} · ${p.total} total`),
      h('button', { class: 'secondary small', disabled: p.page >= p.totalPages, onclick: () => onGo(p.page + 1) }, 'Next')
    );
  }

  /** Paginated list that loads one page at a time from the API. */
  function pagedList({ fetchPage, renderItem, empty, className = 'list' }) {
    const box = h('div');
    let page = 1;
    async function load(p = page) {
      page = p;
      box.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
      try {
        const res = await fetchPage(page);
        if (!res.data.length && page > 1) return load(page - 1);
        const nodes = [res.data.length ? h('div', { class: className }, res.data.map(renderItem)) : h('p', { class: 'empty' }, empty)];
        if (res.pagination.totalPages > 1) nodes.push(pager(res.pagination, load));
        box.replaceChildren(...nodes);
      } catch (err) {
        box.replaceChildren(h('p', { class: 'error-text' }, err.message));
      }
    }
    return { el: box, load, reset: () => load(1) };
  }

  function pageHead(title, text, ...extra) {
    return h('div', { class: 'page-head' }, h('div', { class: 'stack' }, h('h1', {}, title), text ? h('p', {}, text) : null), ...extra);
  }

  async function confirmThen(question, fn) {
    if (!confirm(question)) return;
    try { await fn(); } catch (err) { toast(err.message, 'error'); }
  }

  /* ================= session ================= */
  function setSession(token, user) {
    state.token = token;
    state.user = user;
    writeStore('token', token);
    writeStore('user', JSON.stringify(user));
  }

  function logout() {
    state.token = null;
    state.user = null;
    writeStore('token', null);
    writeStore('user', null);
    state.tab = 'notes';
    render();
  }

  /* ================= sign-in screen ================= */
  function authView() {
    const card = h('div', { class: 'auth-card' });

    function show(mode) {
      state.authMode = mode;
      card.replaceChildren(
        h(
          'div',
          { class: 'segmented', role: 'tablist' },
          h('button', { role: 'tab', 'aria-selected': String(mode === 'login'), onclick: () => show('login') }, 'Log in'),
          h('button', { role: 'tab', 'aria-selected': String(mode === 'register'), onclick: () => show('register') }, 'Create account')
        ),
        mode === 'login' ? loginForm() : registerForm()
      );
    }

    function loginForm() {
      // autocomplete off: the browser should not fill in saved emails/passwords on its own.
      const email = h('input', { type: 'email', required: true, autocomplete: 'off', placeholder: 'you@example.com' });
      const password = h('input', { type: 'password', required: true, autocomplete: 'new-password' });
      return h(
        'div',
        { class: 'stack' },
        h(
          'form',
          {
            class: 'stack',
            autocomplete: 'off',
            onsubmit: async (e) => {
              e.preventDefault();
              try {
                const res = await api('/auth/login', { method: 'POST', body: { email: email.value, password: password.value } });
                setSession(res.token, res.user);
                toast(`Welcome back, ${res.user.name}`);
                render();
              } catch (err) {
                toast(err.message, 'error');
              }
            },
          },
          h('h2', {}, 'Log in to your notes'),
          h('label', {}, 'Email', email),
          h('label', {}, 'Password', password),
          h('button', { type: 'submit' }, 'Log in')
        )
      );
    }

    function registerForm() {
      const name = h('input', { required: true, maxlength: 80, autocomplete: 'off' });
      const email = h('input', { type: 'email', required: true, autocomplete: 'off', placeholder: 'you@example.com' });
      const password = h('input', { type: 'password', required: true, minlength: 8, autocomplete: 'new-password' });
      const interests = h('input', { placeholder: 'chess, reading' });
      return h(
        'form',
        {
          class: 'stack',
          autocomplete: 'off',
          onsubmit: async (e) => {
            e.preventDefault();
            try {
              const res = await api('/auth/register', {
                method: 'POST',
                body: { name: name.value, email: email.value, password: password.value, interests: parseList(interests.value) },
              });
              setSession(res.token, res.user);
              toast('Account created');
              render();
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        },
        h('h2', {}, 'Create an account'),
        h('label', {}, 'Name', name),
        h('label', {}, 'Email', email),
        h('label', {}, h('span', {}, 'Password ', h('span', { class: 'hint' }, 'at least 8 characters')), password),
        h('label', {}, h('span', {}, 'Interests ', h('span', { class: 'hint' }, 'comma separated, optional')), interests),
        h('button', { type: 'submit' }, 'Create account')
      );
    }

    show(state.authMode);

    return h(
      'div',
      { class: 'auth' },
      h(
        'section',
        { class: 'auth-brand' },
        h('div', { class: 'auth-mark' }, h('img', { class: 'auth-logo', src: LOGO, alt: 'Care Guide lighthouse logo', width: 112, height: 112 })),
        h('h1', {}, 'Secure Notes'),
        h('p', { class: 'lead' }, 'A note-taking platform with JWT login and role-based access, built on Node.js, Express and MongoDB.'),
        h(
          'ul',
          { class: 'auth-points' },
          h('li', {}, 'Users keep their own private notes.'),
          h('li', {}, 'Admins manage users and can read every note.'),
          h('li', {}, 'Staff accounts are created by admins and only see the sections they are given.'),
          h('li', {}, 'Public posts and interest groups use MongoDB aggregation.')
        )
      ),
      h('section', { class: 'auth-panel' }, card, credit())
    );
  }

  function credit() {
    return h('p', { class: 'credit' }, 'Interview task for Care Guide BD by Tahamid Hasan Rafi. Not an official Care Guide product.');
  }

  /* ================= notes ================= */
  function noteItem(n, actions) {
    return h(
      'article',
      { class: 'item' },
      h('div', { class: 'item-title' }, n.title),
      n.content ? h('p', { class: 'item-body' }, n.content) : null,
      h(
        'p',
        { class: 'muted' },
        n.owner && n.owner.name ? `${n.owner.name} (${n.owner.email}) · ` : '',
        `Updated ${fmt(n.updatedAt)}`
      ),
      actions ? h('div', { class: 'row item-actions' }, actions) : null
    );
  }

  function notesView() {
    let editingId = null;
    const title = h('input', { required: true, maxlength: 200 });
    const content = h('textarea', { rows: 6, placeholder: 'Write your note…' });
    const heading = h('h2', {}, 'New note');
    const submit = h('button', { type: 'submit' }, 'Add note');
    const cancel = h('button', { type: 'button', class: 'secondary', hidden: true, onclick: () => resetForm() }, 'Cancel');

    function resetForm() {
      editingId = null;
      title.value = content.value = '';
      heading.textContent = 'New note';
      submit.textContent = 'Add note';
      cancel.hidden = true;
    }

    const list = pagedList({
      fetchPage: (page) => api('/notes', { query: { page, limit: PAGE_SIZE } }),
      empty: 'No notes yet. Write your first one on the left.',
      renderItem: (n) =>
        noteItem(n, [
          h(
            'button',
            {
              class: 'secondary small',
              onclick: () => {
                editingId = n._id;
                title.value = n.title;
                content.value = n.content || '';
                heading.textContent = 'Edit note';
                submit.textContent = 'Save changes';
                cancel.hidden = false;
                title.focus();
              },
            },
            'Edit'
          ),
          h(
            'button',
            {
              class: 'danger small',
              onclick: () =>
                confirmThen('Delete this note?', async () => {
                  await api(`/notes/${n._id}`, { method: 'DELETE' });
                  toast('Note deleted');
                  if (editingId === n._id) resetForm();
                  list.load();
                }),
            },
            'Delete'
          ),
        ]),
    });

    const form = h(
      'form',
      {
        class: 'panel stack sticky',
        onsubmit: async (e) => {
          e.preventDefault();
          const body = { title: title.value, content: content.value };
          try {
            if (editingId) {
              await api(`/notes/${editingId}`, { method: 'PATCH', body });
              toast('Changes saved');
              list.load();
            } else {
              await api('/notes', { method: 'POST', body });
              toast('Note added');
              list.reset();
            }
            resetForm();
          } catch (err) {
            toast(err.message, 'error');
          }
        },
      },
      heading,
      h('label', {}, 'Title', title),
      h('label', {}, 'Note', content),
      h('div', { class: 'row' }, submit, cancel)
    );

    list.load();
    return [
      pageHead('My notes', 'Only you can see these. Admins can read them from the admin area.'),
      h('div', { class: 'split' }, form, h('section', { class: 'panel' }, list.el)),
    ];
  }

  /* ================= posts (+ Scenario 2) ================= */
  function postsView() {
    const authorPanel = h('section', { class: 'panel', hidden: true });

    function showAuthor(userId) {
      const heading = h('h2', {}, 'Posts');
      const list = pagedList({
        fetchPage: async (page) => {
          const res = await api(`/users/${userId}/posts`, { query: { page, limit: PAGE_SIZE } });
          heading.textContent = `Posts by ${res.author.name}`;
          return res;
        },
        empty: 'No posts from this person yet.',
        renderItem: (p) =>
          h('article', { class: 'item' }, h('div', { class: 'item-title' }, p.title), h('p', { class: 'item-body' }, p.body), h('p', { class: 'muted' }, fmt(p.createdAt))),
      });
      authorPanel.replaceChildren(
        h('div', { class: 'row spread' }, heading, h('button', { class: 'secondary small', onclick: () => (authorPanel.hidden = true) }, 'Close')),
        h('p', { class: 'muted', style: 'margin:4px 0 10px' }, 'Loaded with one aggregation pipeline that joins users to posts with $lookup.'),
        list.el
      );
      authorPanel.hidden = false;
      list.load();
      authorPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    const pTitle = h('input', { required: true, maxlength: 200 });
    const pBody = h('textarea', { rows: 4, required: true, placeholder: 'What would you like to share?' });

    const feed = pagedList({
      fetchPage: (page) => api('/posts', { query: { page, limit: PAGE_SIZE } }),
      empty: 'No posts yet. Publish the first one.',
      renderItem: (p) => {
        const authorId = p.author && p.author._id;
        const canDelete = authorId === state.user._id || can('posts.delete_any');
        return h(
          'article',
          { class: 'item' },
          h('div', { class: 'item-title' }, p.title),
          h('p', { class: 'item-body' }, p.body),
          h(
            'div',
            { class: 'row muted' },
            authorId ? h('button', { class: 'link', onclick: () => showAuthor(authorId) }, p.author.name) : 'Deleted user',
            h('span', {}, fmt(p.createdAt)),
            canDelete
              ? h(
                  'button',
                  {
                    class: 'link',
                    onclick: () =>
                      confirmThen('Delete this post?', async () => {
                        await api(`/posts/${p._id}`, { method: 'DELETE' });
                        toast('Post deleted');
                        feed.load();
                      }),
                  },
                  'Delete'
                )
              : null
          )
        );
      },
    });

    const form = h(
      'form',
      {
        class: 'panel stack sticky',
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            await api('/posts', { method: 'POST', body: { title: pTitle.value, body: pBody.value } });
            pTitle.value = pBody.value = '';
            toast('Post published');
            feed.reset();
          } catch (err) {
            toast(err.message, 'error');
          }
        },
      },
      h('h2', {}, 'New post'),
      h('p', { class: 'muted' }, 'Posts are public — everyone can read them.'),
      h('label', {}, 'Title', pTitle),
      h('label', {}, 'Post', pBody),
      h(
        'div',
        { class: 'row' },
        h('button', { type: 'submit' }, 'Publish'),
        h('button', { type: 'button', class: 'secondary', onclick: () => showAuthor(state.user._id) }, 'See my posts')
      )
    );

    feed.load();
    const listColumn = h('div', {}, authorPanel, h('section', { class: 'panel' }, h('h2', { style: 'margin-bottom:8px' }, 'All posts'), feed.el));
    const canWrite = state.user.role !== 'staff';
    return [
      pageHead('Posts', canWrite ? 'Select an author’s name to see all of their posts.' : 'You can remove any post that breaks the rules.'),
      canWrite ? h('div', { class: 'split' }, form, listColumn) : listColumn,
    ];
  }

  /* ================= interests (Scenario 1) ================= */
  function interestsView() {
    const filter = h('input', { placeholder: 'e.g. chess', 'aria-label': 'Interest' });
    const list = pagedList({
      fetchPage: (page) => api('/users/interests', { query: { page, limit: PAGE_SIZE, interest: filter.value.trim() } }),
      empty: 'Nobody has listed that interest yet.',
      className: 'groups',
      renderItem: (g) =>
        h(
          'div',
          { class: 'group' },
          h('div', {}, h('div', { class: 'group-name' }, g.interest), h('div', { class: 'muted' }, g.count === 1 ? '1 person' : `${g.count} people`)),
          h('div', {}, g.users.map((u) => h('span', { class: 'tag' }, u.name)))
        ),
    });
    const form = h(
      'form',
      { class: 'row', style: 'margin-bottom:14px', onsubmit: (e) => { e.preventDefault(); list.reset(); } },
      h('div', { style: 'flex:1;min-width:200px' }, filter),
      h('button', { type: 'submit' }, 'Show'),
      h('button', { type: 'button', class: 'secondary', onclick: () => { filter.value = ''; list.reset(); } }, 'Show all')
    );
    list.load();
    return [
      pageHead('Interest groups', 'People grouped by the interests on their profiles — built with a single aggregation call ($unwind, $group, $facet). Add your own on the Profile page.'),
      h('section', { class: 'panel' }, form, list.el),
    ];
  }

  /* ================= profile ================= */
  function profileView() {
    const u = state.user;
    const isStaff = u.role === 'staff';
    const name = h('input', { value: u.name, required: true, maxlength: 80 });
    const interests = h('input', { value: (u.interests || []).join(', '), placeholder: 'chess, reading' });
    const password = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Leave empty to keep your current password' });
    const form = h(
      'form',
      {
        class: 'panel stack',
        style: 'max-width:560px',
        onsubmit: async (e) => {
          e.preventDefault();
          const body = { name: name.value };
          if (!isStaff) body.interests = parseList(interests.value);
          if (password.value) body.password = password.value;
          try {
            const res = await api('/auth/me', { method: 'PATCH', body });
            setSession(state.token, res.user);
            toast('Profile saved');
            render();
          } catch (err) {
            toast(err.message, 'error');
          }
        },
      },
      h('div', { class: 'row' }, h('span', {}, u.email), roleTag(u)),
      h('label', {}, 'Name', name),
      isStaff ? null : h('label', {}, h('span', {}, 'Interests ', h('span', { class: 'hint' }, 'comma separated')), interests),
      h('label', {}, 'New password', password),
      h('div', { class: 'row' }, h('button', { type: 'submit' }, 'Save profile'))
    );
    const access = isStaff
      ? h(
          'section',
          { class: 'panel stack', style: 'max-width:560px;margin-top:18px' },
          h('h2', {}, 'Your access'),
          (u.permissions || []).length
            ? h('div', {}, u.permissions.map((p) => h('span', { class: 'tag' }, permLabel(p))))
            : h('p', { class: 'muted' }, 'Your admin has not given you access to any section yet.'),
          h('p', { class: 'muted' }, (u.allowedIps || []).length ? `You can only sign in from: ${u.allowedIps.join(', ')}` : 'You can sign in from any network.')
        )
      : null;
    return [pageHead('Profile', null), form, access];
  }

  /* ================= admin / staff panel ================= */
  const PERMISSION_LABELS = {
    'users.view': 'See the user list',
    'users.create': 'Add new users',
    'users.update': 'Edit users',
    'users.delete': 'Remove users',
    'notes.view_all': 'Read everyone’s notes',
    'posts.delete_any': 'Delete any post',
  };
  const permLabel = (p) => PERMISSION_LABELS[p] || p;

  function adminView() {
    const me = state.user;
    const isAdmin = me.role === 'admin';
    let editing = null; // the account being edited, or null when adding
    let ownerFilter = '';

    /* ---------- form ---------- */
    const name = h('input', { required: true, maxlength: 80, autocomplete: 'off' });
    const email = h('input', { type: 'email', required: true, autocomplete: 'off' });
    const password = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'At least 8 characters' });
    const role = h(
      'select',
      { onchange: () => syncStaffFields() },
      h('option', { value: 'user' }, 'User'),
      h('option', { value: 'staff' }, 'Staff'),
      h('option', { value: 'admin' }, 'Admin')
    );
    const interests = h('input', { placeholder: 'chess, reading' });
    const ips = h('input', { placeholder: 'e.g. 103.10.20.30, 103.10.0.0/16' });
    const checks = Object.entries(PERMISSION_LABELS).map(([key, label]) => {
      const box = h('input', { type: 'checkbox', value: key });
      return { key, box, el: h('label', { class: 'check' }, box, h('span', {}, label)) };
    });
    const staffFields = h(
      'fieldset',
      { class: 'stack staff-fields' },
      h('legend', {}, 'Staff access'),
      h('div', { class: 'checks' }, checks.map((c) => c.el)),
      h('label', {}, h('span', {}, 'Allowed IP addresses ', h('span', { class: 'hint' }, 'optional, comma separated — leave empty to allow any network')), ips)
    );
    const interestsLabel = h('label', {}, h('span', {}, 'Interests ', h('span', { class: 'hint' }, 'comma separated')), interests);
    const roleLabel = isAdmin ? h('label', {}, 'Role', role) : null;

    function syncStaffFields() {
      const staff = isAdmin && role.value === 'staff';
      staffFields.hidden = !staff;
      interestsLabel.hidden = role.value === 'staff';
    }

    const formTitle = h('h2', {}, 'Add an account');
    const submit = h('button', { type: 'submit' }, 'Add account');
    const cancel = h('button', { type: 'button', class: 'secondary', hidden: true, onclick: () => resetForm() }, 'Cancel');
    const canCreate = can('users.create');

    function resetForm() {
      editing = null;
      name.value = email.value = password.value = interests.value = ips.value = '';
      role.value = 'user';
      checks.forEach((c) => (c.box.checked = false));
      password.placeholder = 'At least 8 characters';
      formTitle.textContent = isAdmin ? 'Add an account' : 'Add a user';
      submit.textContent = isAdmin ? 'Add account' : 'Add user';
      cancel.hidden = true;
      userForm.hidden = !canCreate;
      syncStaffFields();
    }

    function startEdit(u) {
      editing = u;
      name.value = u.name;
      email.value = u.email;
      role.value = u.role;
      interests.value = (u.interests || []).join(', ');
      ips.value = (u.allowedIps || []).join(', ');
      checks.forEach((c) => (c.box.checked = (u.permissions || []).includes(c.key)));
      password.value = '';
      password.placeholder = 'Leave empty to keep the current password';
      formTitle.textContent = `Edit ${u.name}`;
      submit.textContent = 'Save changes';
      cancel.hidden = false;
      userForm.hidden = false;
      syncStaffFields();
      userForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    const userForm = h(
      'form',
      {
        class: 'panel stack sticky',
        autocomplete: 'off',
        onsubmit: async (e) => {
          e.preventDefault();
          const body = { name: name.value, email: email.value };
          if (password.value) body.password = password.value;
          const r = isAdmin ? role.value : 'user';
          if (isAdmin) body.role = r;
          if (r === 'staff') {
            body.permissions = checks.filter((c) => c.box.checked).map((c) => c.key);
            body.allowedIps = parseList(ips.value);
          } else {
            body.interests = parseList(interests.value);
          }
          try {
            if (editing) {
              const res = await api(`/admin/users/${editing._id}`, { method: 'PATCH', body });
              if (editing._id === me._id) setSession(state.token, res.data);
              toast('Changes saved');
              users?.load();
            } else {
              if (!body.password) throw new Error('Enter a password for the new account.');
              await api('/admin/users', { method: 'POST', body });
              toast(r === 'staff' ? 'Staff account added' : 'Account added');
              users?.reset();
            }
            resetForm();
          } catch (err) {
            toast(err.message, 'error');
          }
        },
      },
      formTitle,
      h('label', {}, 'Name', name),
      h('label', {}, 'Email', email),
      h('label', {}, 'Password', password),
      roleLabel,
      interestsLabel,
      isAdmin ? staffFields : null,
      h('div', { class: 'row' }, submit, cancel)
    );

    /* ---------- everyone's notes ---------- */
    const showNotes = can('notes.view_all');
    const notesHeading = h('h2', {}, 'Everyone’s notes');
    const clearOwner = h('button', { class: 'secondary small', hidden: true, onclick: () => setOwner('', '') }, 'Show all notes');
    const notes = showNotes
      ? pagedList({
          fetchPage: (page) => api('/admin/notes', { query: { page, limit: PAGE_SIZE, owner: ownerFilter } }),
          empty: 'No notes found.',
          renderItem: (n) => noteItem(n),
        })
      : null;
    const notesPanel = showNotes
      ? h('section', { class: 'panel', style: 'margin-top:20px' }, h('div', { class: 'row spread', style: 'margin-bottom:8px' }, notesHeading, clearOwner), notes.el)
      : null;
    function setOwner(id, label) {
      ownerFilter = id;
      notesHeading.textContent = id ? `Notes by ${label}` : 'Everyone’s notes';
      clearOwner.hidden = !id;
      notes.reset();
      if (id) notesPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    /* ---------- accounts list ---------- */
    // Staff may only manage regular users; admins manage everyone but themselves.
    const mayEdit = (u) => isAdmin || (can('users.update') && u.role === 'user');
    const mayRemove = (u) => u._id !== me._id && (isAdmin || (can('users.delete') && u.role === 'user'));

    const users = can('users.view')
      ? pagedList({
          fetchPage: (page) => api('/admin/users', { query: { page, limit: PAGE_SIZE } }),
          empty: 'No accounts yet.',
          renderItem: (u) =>
            h(
              'article',
              { class: `item ${u.active ? '' : 'is-off'}` },
              h(
                'div',
                { class: 'row' },
                h('span', { class: 'item-title' }, u.name),
                roleTag(u),
                u.active ? null : h('span', { class: 'tag off' }, 'Switched off')
              ),
              h('p', { class: 'muted' }, `${u.email} · joined ${fmt(u.createdAt)}`),
              u.role === 'staff' && u.permissions
                ? h(
                    'div',
                    { class: 'stack', style: 'gap:4px;margin-top:6px' },
                    u.permissions.length
                      ? h('div', {}, u.permissions.map((p) => h('span', { class: 'tag' }, permLabel(p))))
                      : h('p', { class: 'muted' }, 'No permissions yet'),
                    h('p', { class: 'muted' }, u.allowedIps?.length ? `Allowed IPs: ${u.allowedIps.join(', ')}` : 'Any IP')
                  )
                : (u.interests || []).length
                  ? h('div', {}, u.interests.map((i) => h('span', { class: 'tag' }, i)))
                  : null,
              h(
                'div',
                { class: 'row item-actions' },
                mayEdit(u) ? h('button', { class: 'secondary small', onclick: () => startEdit(u) }, 'Edit') : null,
                showNotes && u.role !== 'staff' ? h('button', { class: 'secondary small', onclick: () => setOwner(u._id, u.name) }, 'View notes') : null,
                isAdmin && u._id !== me._id
                  ? h(
                      'button',
                      {
                        class: u.active ? 'secondary small' : 'small',
                        onclick: async () => {
                          try {
                            await api(`/admin/users/${u._id}`, { method: 'PATCH', body: { active: !u.active } });
                            toast(u.active ? `${u.name} switched off` : `${u.name} switched on`);
                            users.load();
                          } catch (err) {
                            toast(err.message, 'error');
                          }
                        },
                      },
                      u.active ? 'Switch off' : 'Switch on'
                    )
                  : null,
                mayRemove(u)
                  ? h(
                      'button',
                      {
                        class: 'danger small',
                        onclick: () =>
                          confirmThen(`Remove ${u.name}? Their notes and posts are deleted too.`, async () => {
                            await api(`/admin/users/${u._id}`, { method: 'DELETE' });
                            toast('Account removed');
                            if (editing && editing._id === u._id) resetForm();
                            if (notes) ownerFilter === u._id ? setOwner('', '') : notes.load();
                            users.load();
                          }),
                      },
                      'Remove'
                    )
                  : null
              )
            ),
        })
      : null;

    resetForm();
    users?.load();
    notes?.load();

    const hasAnything = canCreate || users || notes;
    if (!hasAnything) {
      return [
        pageHead('Staff panel', null),
        h('section', { class: 'panel' }, h('p', { class: 'empty' }, 'Your admin has not given you access to any section yet. Ask them to add permissions to your account.')),
      ];
    }

    const intro = isAdmin
      ? 'Add users, staff and admins; give staff permissions and optional IP limits; switch accounts off; read every note.'
      : 'You can use the sections your admin has given you access to.';
    const usersPanel = users ? h('section', { class: 'panel' }, h('h2', { style: 'margin-bottom:8px' }, 'Accounts'), users.el) : null;
    const top = usersPanel || canCreate ? h('div', { class: usersPanel && canCreate ? 'split' : '' }, canCreate || isAdmin ? userForm : null, usersPanel) : null;
    if (!canCreate) userForm.hidden = true;
    // Staff with edit rights but no "add" right still need the form when editing.
    const formHost = !canCreate && can('users.update') ? h('div', { style: 'margin-bottom:20px' }, userForm) : null;
    return [pageHead(isAdmin ? 'Admin' : 'Staff panel', intro), formHost, top, notesPanel];
  }

  /* ================= how it works ================= */
  function aboutView() {
    const rows = [
      ['users', '{ email: 1 } unique', 'Log in by email; blocks duplicate accounts'],
      ['users', '{ interests: 1 }', 'Interest groups aggregation ($match on the array)'],
      ['notes', '{ owner: 1, _id: -1 }', '“My notes” list: filter by owner and sort newest first, plus its count'],
      ['posts', '{ author: 1, _id: -1 }', 'A user’s posts: $lookup on author, sorted newest first'],
    ];
    const endpoints = [
      ['POST', '/api/auth/register · /api/auth/login', 'Sign up / log in, returns a JWT'],
      ['GET', '/api/notes?page&limit', 'Your notes (paginated)'],
      ['GET', '/api/admin/users · /api/admin/notes', 'Admin, or staff with the matching permission'],
      ['PATCH', '/api/admin/users/:id', 'Edit an account; admins also set role, permissions, IP list and on/off'],
      ['GET', '/api/users/interests', 'Scenario 1 — users grouped by interest, one aggregate() call'],
      ['GET', '/api/users/:id/posts', 'Scenario 2 — a user’s posts with $lookup'],
    ];
    return [
      pageHead('How it works', 'Every action on these pages is a request to the REST API. Open the API log (bottom right) to watch them happen.'),
      h(
        'section',
        { class: 'panel' },
        h('h2', { style: 'margin-bottom:6px' }, 'Indexes'),
        h('p', { class: 'muted', style: 'margin-bottom:12px' }, 'Only four indexes besides the automatic _id index. Lists sort by _id (it starts with the creation time), so no createdAt index is needed.'),
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            {},
            h('thead', {}, h('tr', {}, h('th', {}, 'Collection'), h('th', {}, 'Index'), h('th', {}, 'Used for'))),
            h('tbody', {}, rows.map(([c, i, u]) => h('tr', {}, h('td', {}, c), h('td', {}, h('code', {}, i)), h('td', {}, u))))
          )
        )
      ),
      h(
        'section',
        { class: 'panel' },
        h('h2', { style: 'margin-bottom:6px' }, 'Roles'),
        h('p', { class: 'muted', style: 'margin-bottom:12px' }, 'Permissions, the on/off switch and IP limits live on the user document, which is already loaded by _id on every request — so they need no extra index.'),
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            {},
            h('thead', {}, h('tr', {}, h('th', {}, 'Role'), h('th', {}, 'How it is created'), h('th', {}, 'What it can do'))),
            h(
              'tbody',
              {},
              [
                ['user', 'Signs up on this page', 'Own notes, posts, interest groups, profile'],
                ['staff', 'Added by an admin', 'Only the sections the admin ticked; can be switched off; optional IP whitelist'],
                ['admin', 'Seed script or another admin', 'Everything, including staff permissions'],
              ].map(([r, c, d]) => h('tr', {}, h('td', {}, r), h('td', {}, c), h('td', {}, d)))
            )
          )
        )
      ),
      h(
        'section',
        { class: 'panel' },
        h('h2', { style: 'margin-bottom:12px' }, 'Main endpoints'),
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            {},
            h('thead', {}, h('tr', {}, h('th', {}, 'Method'), h('th', {}, 'Path'), h('th', {}, 'What it does'))),
            h('tbody', {}, endpoints.map(([m, p, d]) => h('tr', {}, h('td', {}, m), h('td', {}, h('code', {}, p)), h('td', {}, d))))
          )
        )
      ),
    ];
  }

  /* ================= API log panel ================= */
  const logToggle = h('button', { class: 'log-toggle', onclick: () => { state.logOpen = !state.logOpen; renderLog(); } });
  const logPanel = h('aside', { class: 'log', hidden: true, 'aria-label': 'API requests' });
  document.body.append(logPanel, logToggle);

  function renderLog() {
    logToggle.replaceChildren(state.logOpen ? 'Hide API log' : 'API log', h('span', { class: 'count' }, String(state.log.length)));
    logToggle.hidden = !state.token;
    logPanel.hidden = !state.logOpen || !state.token;
    if (logPanel.hidden) return;
    logPanel.replaceChildren(
      h('div', { class: 'log-head' }, h('p', {}, `Requests to ${API}`), h('button', { class: 'secondary small', onclick: () => { state.log = []; renderLog(); } }, 'Clear')),
      state.log.length
        ? h(
            'ol',
            {},
            state.log.map((r) =>
              h(
                'li',
                {},
                h('span', { class: 'm' }, r.method),
                h('span', { class: 'p' }, r.path),
                h('span', { class: `s ${typeof r.status === 'number' && r.status < 400 ? 'ok' : 'bad'}` }, String(r.status)),
                h('span', { class: 't' }, `${r.ms}ms`)
              )
            )
          )
        : h('p', { class: 'empty' }, 'No requests yet.')
    );
  }

  /* ================= shell ================= */
  // `show` decides who sees each section. The API enforces the same rules,
  // so hiding a tab is only for convenience, not for security.
  const member = () => state.user.role !== 'staff';
  const TABS = [
    { id: 'notes', label: 'My notes', view: notesView, show: member },
    { id: 'posts', label: 'Posts', view: postsView, show: () => member() || can('posts.delete_any') },
    { id: 'interests', label: 'Interest groups', view: interestsView, show: member },
    { id: 'admin', label: 'Admin', view: adminView, show: () => state.user.role === 'admin' },
    { id: 'admin', label: 'Staff panel', view: adminView, show: () => state.user.role === 'staff' },
    { id: 'profile', label: 'Profile', view: profileView, show: () => true },
    { id: 'about', label: 'How it works', view: aboutView, show: () => true },
  ];

  function render() {
    const root = document.getElementById('root');
    renderLog();

    if (!state.token || !state.user) {
      root.replaceChildren(authView());
      return;
    }

    const tabs = TABS.filter((t) => t.show());
    if (!tabs.some((t) => t.id === state.tab)) state.tab = tabs[0].id;

    const topbar = h(
      'header',
      { class: 'topbar' },
      h(
        'div',
        { class: 'topbar-inner' },
        h('div', { class: 'brand' }, h('img', { src: LOGO, alt: '', width: 36, height: 36 }), 'Secure Notes'),
        h(
          'nav',
          { class: 'nav', 'aria-label': 'Sections' },
          tabs.map((t) =>
            h(
              'button',
              { 'aria-current': t.id === state.tab ? 'page' : null, onclick: () => { state.tab = t.id; render(); window.scrollTo(0, 0); } },
              t.label
            )
          )
        ),
        h(
          'div',
          { class: 'who' },
          h('span', {}, state.user.name),
          roleTag(state.user),
          h('button', { class: 'secondary small', onclick: () => { logout(); toast('Logged out'); } }, 'Log out')
        )
      )
    );

    root.replaceChildren(topbar, h('main', {}, [].concat(tabs.find((t) => t.id === state.tab).view())), credit());
  }

  async function init() {
    if (state.token) {
      try {
        const res = await api('/auth/me');
        setSession(state.token, res.user);
      } catch {
        /* invalid token: api() already logged out */
      }
    }
    render();
  }

  init();
})();
