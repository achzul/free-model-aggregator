// Free Model Aggregator — snapshot dashboard logic.
// Everything runs on the bundled snapshot (data.js): search, filters, sort, compare and the
// task helper work with no network at all. Live mode (only in the -02 package's page) is opt-in
// and uses the visitor's own OpenRouter key, kept in their browser's local storage only.
'use strict';

const models = (window.FREE_MODELS || []).map((m) => ({ ...m, vendor: (m.id.split('/')[0] || '').toLowerCase() }));
const state = { q: '', vendor: 'all', input: 'all', minCtx: 0, sort: 'context', task: 'all', compare: new Set() };

const $ = (sel) => document.querySelector(sel);
const fmtCtx = (n) => (n == null ? '—' : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 2)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));
const fmtDate = (unix) => (unix ? new Date(unix * 1000).toISOString().slice(0, 10) : '—');
const hasVision = (m) => (m.input_modalities || []).includes('image');
const isCodey = (m) => /code|coder|coding/i.test(`${m.id} ${m.name}`);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Task shortlists: small, honest heuristics over the snapshot's own fields, labelled as such. */
const TASKS = {
  all: () => true,
  chat: () => true,
  coding: (m) => isCodey(m) || (m.context_length || 0) >= 256_000,
  longdocs: (m) => (m.context_length || 0) >= 512_000,
  vision: (m) => hasVision(m),
  indonesian: () => true, // multilingual chat models; ranked by context below
};
const TASK_RANK = {
  chat: (m) => (m.context_length || 0) + (hasVision(m) ? 1 : 0),
  coding: (m) => (isCodey(m) ? 2_000_000 : 0) + (m.context_length || 0),
  longdocs: (m) => m.context_length || 0,
  vision: (m) => m.context_length || 0,
  indonesian: (m) => (m.context_length || 0),
};

function visible() {
  const q = state.q.trim().toLowerCase();
  let out = models.filter((m) => {
    if (state.vendor !== 'all' && m.vendor !== state.vendor) return false;
    if (state.input === 'vision' && !hasVision(m)) return false;
    if (state.input === 'text' && hasVision(m)) return false;
    if ((m.context_length || 0) < state.minCtx) return false;
    if (!TASKS[state.task](m)) return false;
    if (q && !`${m.name} ${m.id} ${m.description}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const by = {
    context: (a, b) => (b.context_length || 0) - (a.context_length || 0) || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
    newest: (a, b) => (b.created || 0) - (a.created || 0) || a.name.localeCompare(b.name),
    task: (a, b) => TASK_RANK[state.task](b) - TASK_RANK[state.task](a) || (b.context_length || 0) - (a.context_length || 0),
  };
  out.sort(by[state.task !== 'all' ? 'task' : state.sort] || by.context);
  return out;
}

function tags(m) {
  const t = [];
  if (hasVision(m)) t.push('<span class="badge vision">vision</span>');
  if (isCodey(m)) t.push('<span class="badge code">coding</span>');
  if ((m.context_length || 0) >= 512_000) t.push('<span class="badge ctx">long context</span>');
  return t.join(' ');
}

function render() {
  const list = visible();
  $('#count').innerHTML = `<b>${list.length}</b> of ${models.length} free models shown`;
  const grid = $('#grid');
  if (list.length === 0) {
    grid.innerHTML = '<p class="empty">No free model matches those filters. Loosen a filter or clear the search.</p>';
  } else {
    grid.innerHTML = list.map((m) => `
      <article class="card">
        <h3>${esc(m.name)}</h3>
        <div class="id">${esc(m.id)}</div>
        <div class="badges">
          <span class="badge ctx">${fmtCtx(m.context_length)} context</span>
          <span class="badge">${esc(m.vendor)}</span>
          ${tags(m)}
        </div>
        <p class="desc">${esc(m.description)}</p>
        <details>
          <summary>Details &amp; best for</summary>
          <p class="full">${esc(m.description)}</p>
          <dl class="kv">
            <dt>Inputs</dt><dd>${esc((m.input_modalities || []).join(', ') || 'text')}</dd>
            <dt>Outputs</dt><dd>${esc((m.output_modalities || []).join(', ') || 'text')}</dd>
            <dt>Tokenizer</dt><dd>${esc(m.tokenizer || '—')}</dd>
            <dt>Listed</dt><dd>${fmtDate(m.created)}</dd>
            <dt>Best for</dt><dd>${esc(bestFor(m))}</dd>
          </dl>
        </details>
        <div class="foot">
          <label class="compare-toggle">
            <input type="checkbox" data-compare="${esc(m.id)}" ${state.compare.has(m.id) ? 'checked' : ''} ${!state.compare.has(m.id) && state.compare.size >= 3 ? 'disabled' : ''}>
            Compare
          </label>
          <span class="badge">$0 / token</span>
        </div>
      </article>`).join('');
  }
  grid.querySelectorAll('[data-compare]').forEach((box) => {
    box.addEventListener('change', () => {
      if (box.checked) state.compare.add(box.dataset.compare);
      else state.compare.delete(box.dataset.compare);
      renderCompare();
      render();
    });
  });
  renderCompare();
}

function bestFor(m) {
  const parts = [];
  if (isCodey(m)) parts.push('coding assistance');
  if (hasVision(m)) parts.push('image understanding');
  if ((m.context_length || 0) >= 512_000) parts.push('very long documents and codebases');
  else if ((m.context_length || 0) >= 256_000) parts.push('long chats and documents');
  if (parts.length === 0) parts.push('everyday chat and writing');
  return parts.join('; ');
}

function renderCompare() {
  const bar = $('#comparebar');
  const picked = models.filter((m) => state.compare.has(m.id));
  if (picked.length === 0) { bar.classList.remove('show'); bar.innerHTML = ''; return; }
  bar.classList.add('show');
  const row = (label, fn) => `<tr><th>${label}</th>${picked.map((m) => `<td>${fn(m)}</td>`).join('')}</tr>`;
  bar.innerHTML = `
    <div class="wrap">
      <div class="row"><strong>Comparing ${picked.length} model${picked.length > 1 ? 's' : ''}</strong>
      <button id="clear-compare" type="button">Clear</button></div>
      <table class="compare">
        ${row('Model', (m) => `<b>${esc(m.name)}</b><br><span class="id">${esc(m.id)}</span>`)}
        ${row('Context', (m) => `${fmtCtx(m.context_length)} tokens`)}
        ${row('Vendor', (m) => esc(m.vendor))}
        ${row('Inputs', (m) => esc((m.input_modalities || []).join(', ')))}
        ${row('Outputs', (m) => esc((m.output_modalities || []).join(', ')))}
        ${row('Best for', (m) => esc(bestFor(m)))}
        ${row('Listed', (m) => fmtDate(m.created))}
      </table>
    </div>`;
  $('#clear-compare').addEventListener('click', () => { state.compare.clear(); render(); });
}

function wire() {
  const vendors = [...new Set(models.map((m) => m.vendor))].sort();
  $('#vendor').innerHTML = '<option value="all">All providers</option>' + vendors.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  $('#search').addEventListener('input', (e) => { state.q = e.target.value; render(); });
  $('#vendor').addEventListener('change', (e) => { state.vendor = e.target.value; render(); });
  $('#input-filter').addEventListener('change', (e) => { state.input = e.target.value; render(); });
  $('#ctx-filter').addEventListener('change', (e) => { state.minCtx = Number(e.target.value); render(); });
  $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });
  document.querySelectorAll('[data-task]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.task = btn.dataset.task;
      document.querySelectorAll('[data-task]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      render();
    });
  });
  const meta = window.SNAPSHOT_META || {};
  $('#meta').innerHTML = `Snapshot of <b>${esc(meta.source || 'OpenRouter')}</b> fetched <b>${esc(meta.fetchedAt || '')}</b> — ` +
    `${meta.catalogTotal ?? ''} models in the catalog, <b>${meta.pricedZero ?? ''} priced $0</b>, <b>${models.length} chat-usable free models</b> listed here (the other $0 entries are audio-generation models). Renders fully offline.`;
  render();
}

/* ---- Live mode (the -02 page only): the visitor's own key, their browser only. ---- */
function wireLive() {
  const panel = $('#live');
  if (!panel) return;
  const keyInput = $('#or-key');
  keyInput.value = localStorage.getItem('openrouter_key') || '';
  $('#save-key').addEventListener('click', () => {
    const v = keyInput.value.trim();
    if (v) localStorage.setItem('openrouter_key', v); else localStorage.removeItem('openrouter_key');
    $('#live-out').style.display = 'block';
    $('#live-out').textContent = v ? 'Key saved in this browser only (local storage). It is never sent anywhere except OpenRouter.' : 'Key cleared.';
  });
  $('#refresh-live').addEventListener('click', async () => {
    const out = $('#live-out');
    out.style.display = 'block';
    out.textContent = 'Fetching the live catalog…';
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models');
      const data = await res.json();
      const free = (data.data || []).filter((m) => m.pricing && m.pricing.prompt === '0' && m.pricing.completion === '0');
      out.textContent = `Live check just now: ${data.data.length} models in the catalog, ${free.length} priced $0. ` +
        `The bundled snapshot below lists ${models.length} chat-usable free models; if the counts differ, the free tier has changed since the snapshot.`;
    } catch (err) {
      out.textContent = `Live check failed (${err.message}). The bundled snapshot below still works — that is the point of bundling it.`;
    }
  });
  $('#test-chat').addEventListener('click', async () => {
    const out = $('#live-out');
    out.style.display = 'block';
    const key = (localStorage.getItem('openrouter_key') || keyInput.value || '').trim();
    if (!key) { out.textContent = 'Paste your OpenRouter key above first — the live test spends your own free quota, never ours.'; return; }
    const model = $('#live-model').value;
    out.textContent = `Asking ${model} …`;
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Say hello in one short sentence.' }], max_tokens: 60 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
      out.textContent = `${data.model} answered: ${data.choices?.[0]?.message?.content ?? '(empty answer)'}`;
    } catch (err) {
      out.textContent = `Live test failed (${err.message}). Check the key and the model's free quota.`;
    }
  });
  $('#live-model').innerHTML = models.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
}

document.addEventListener('DOMContentLoaded', () => { wire(); wireLive(); });
