const API = '/api';
let allParts = [];
let allTypes = [];
let activeFilter = 'ALL';

const tagGrid = document.getElementById('tagGrid');
const addPanel = document.getElementById('addPanel');
const addError = document.getElementById('addError');
const importPanel = document.getElementById('importPanel');
const importError = document.getElementById('importError');
const searchInput = document.getElementById('searchInput');
const clearSearchBtn = document.getElementById('clearSearchBtn');
const tagModal = document.getElementById('tagModal');
const modalTagList = document.getElementById('modalTagList');
const splitModal = document.getElementById('splitModal');
const splitError = document.getElementById('splitError');
const batchModal = document.getElementById('batchModal');
const batchList = document.getElementById('batchList');
let splitPartId = null;

// ---------- Data loading ----------
async function loadTypes(selectedType = null) {
  const select = document.getElementById('f-type');
  const currentVal = selectedType || select.value;

  try {
    const res = await fetch(`${API}/types`);
    allTypes = await res.json();
  } catch(e) {
    if (allTypes.length === 0) {
      allTypes = [{id: 1, name: 'Sensor'}, {id: 2, name: 'Motor'}, {id: 3, name: 'Structural'}, {id: 4, name: 'Wheel'}];
    }
  }
  
  select.innerHTML = '<option value="">— none —</option>' +
    allTypes.map(t => `<option value="${escapeAttr(t.name)}">${escapeHtml(t.name)}</option>`).join('');
  
  if (allTypes.some(t => t.name === currentVal)) {
    select.value = currentVal;
  }
  
  renderModalTags();
}

async function loadParts() {
  try {
    const res = await fetch(`${API}/parts`);
    allParts = await res.json();
  } catch(e) {
    if (allParts.length === 0) {
      allParts = [
        { id: 1, name: 'Rev Core Hex Motor', quantity: 4, status: 'AVAILABLE', location: 'Bin A1', type: 'Motor' },
        { id: 2, name: 'Color Sensor V3', quantity: 2, status: 'IN_USE', location: 'Robot 1', type: 'Sensor' },
        { id: 3, name: 'Omni Wheel 90mm', quantity: 0, status: 'BROKEN', location: 'Bin C4', type: 'Wheel' },
        { id: 4, name: 'Omni 67 90mm', quantity: 34, status: 'IN_SHIPMENT', location: '', type: 'Wheel' }
      ];
    }
  }
  renderParts();
}

async function loadBatches() {
  const res = await fetch(`${API}/import/batches`);
  if (!res.ok) throw new Error('Could not load imported shipments.');
  renderBatches(await res.json());
}

function renderBatches(batches) {
  if (batches.length === 0) {
    batchList.innerHTML = '<div class="empty-state">No CSV shipments imported yet.</div>';
    return;
  }

  batchList.innerHTML = batches.map(batch => `
    <div class="batch-item" data-batch-id="${escapeAttr(batch.id)}">
      <div class="batch-info">
        <strong>${escapeHtml(batch.first_part || 'Imported shipment')}</strong>
        <span>${batch.item_count} part(s) · ${escapeHtml(new Date(`${batch.created_at}Z`).toLocaleString())}</span>
        <code>${escapeHtml(batch.id)}</code>
      </div>
      <div class="batch-actions">
        <select class="batch-status" aria-label="Shipment status">
          ${['IN_SHIPMENT', 'AVAILABLE', 'BROKEN'].map(status => `<option value="${status}">${status.replace('_', ' ')}</option>`).join('')}
        </select>
        <button class="secondary batch-update-btn" type="button">Set status</button>
        <button class="delete batch-delete-btn" type="button">Delete all</button>
      </div>
    </div>
  `).join('');

  batches.forEach(batch => {
    const item = batchList.querySelector(`[data-batch-id="${batch.id}"]`);
    const statusSelect = item.querySelector('.batch-status');
    const statuses = (batch.statuses || '').split(',');
    if (statuses.length === 1 && statuses[0]) statusSelect.value = statuses[0];
    item.querySelector('.batch-update-btn').addEventListener('click', () => updateBatchStatus(batch.id, statusSelect.value));
    item.querySelector('.batch-delete-btn').addEventListener('click', () => deleteBatch(batch.id));
  });
}

function openBatchModal() {
  batchModal.classList.add('open');
  loadBatches().catch(error => { batchList.innerHTML = `<div class="error-msg show">${escapeHtml(error.message)}</div>`; });
}

function closeBatchModal() { batchModal.classList.remove('open'); }

async function updateBatchStatus(batchId, status) {
  const res = await fetch(`${API}/import/batches/${encodeURIComponent(batchId)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || 'Could not update shipment.');
  await loadParts();
  await loadBatches();
}

async function deleteBatch(batchId) {
  if (!confirm('Delete every part from this imported shipment? This cannot be undone.')) return;
  const res = await fetch(`${API}/import/batches/${encodeURIComponent(batchId)}`, { method: 'DELETE' });
  if (!res.ok) {
    const result = await res.json();
    throw new Error(result.error || 'Could not delete shipment.');
  }
  await loadParts();
  await loadBatches();
}

// ---------- Tag Manager Modal ----------
function renderModalTags() {
  if (allTypes.length === 0) {
    modalTagList.innerHTML = `<div style="text-align: center; color: var(--text-dim); padding: 12px;">No tags created yet.</div>`;
    return;
  }
  
  modalTagList.innerHTML = allTypes.map(t => `
    <div class="tag-item">
      <span>🏷️ ${escapeHtml(t.name)}</span>
      <button onclick="deleteTagGlobally('${escapeAttr(t.name)}', ${t.id || null})">Delete</button>
    </div>
  `).join('');
}

async function deleteTagGlobally(tagName, tagId) {
  if (!confirm(`Delete tag "${tagName}" altogether? This will remove it from all associated parts.`)) return;

  try {
    if (tagId) {
      await fetch(`${API}/types/${tagId}`, { method: 'DELETE' });
    } else {
      await fetch(`${API}/types/${encodeURIComponent(tagName)}`, { method: 'DELETE' });
    }
  } catch(e) {
    // Local fallback
    allTypes = allTypes.filter(t => t.name !== tagName);
    allParts.forEach(p => {
      if (p.type === tagName) p.type = null;
    });
  }

  await loadTypes();
  renderParts();
}

// ---------- Rendering ----------
function renderParts() {
  const searchQuery = searchInput.value.toLowerCase().trim();

  const filtered = allParts.filter(p => {
    const matchesFilter = activeFilter === 'ALL' || p.status === activeFilter;
    const matchesSearch = !searchQuery || 
      (p.name && p.name.toLowerCase().includes(searchQuery)) ||
      (p.type && p.type.toLowerCase().includes(searchQuery)) ||
      (p.location && p.location.toLowerCase().includes(searchQuery));

    return matchesFilter && matchesSearch;
  });

  if (filtered.length === 0) {
    tagGrid.innerHTML = `<div class="empty-state">No parts found matching your criteria.</div>`;
    return;
  }

  tagGrid.innerHTML = filtered.map(renderTag).join('');

  filtered.forEach(p => {
    document.getElementById(`menu-btn-${p.id}`).addEventListener('click', () => toggleItemMenu(p.id));
    document.getElementById(`edit-btn-${p.id}`).addEventListener('click', () => toggleEdit(p.id, true));
    document.getElementById(`split-btn-${p.id}`).addEventListener('click', () => openSplitModal(p));
    document.getElementById(`cancel-btn-${p.id}`).addEventListener('click', () => toggleEdit(p.id, false));
    document.getElementById(`save-btn-${p.id}`).addEventListener('click', () => saveEdit(p.id));
    document.getElementById(`delete-btn-${p.id}`).addEventListener('click', () => deletePart(p.id, p.name));
    document.querySelector(`[data-quantity-target="edit-qty-${p.id}"][data-quantity-change="-1"]`)
      .addEventListener('click', () => changeQuantity(`edit-qty-${p.id}`, -1));
    document.querySelector(`[data-quantity-target="edit-qty-${p.id}"][data-quantity-change="1"]`)
      .addEventListener('click', () => changeQuantity(`edit-qty-${p.id}`, 1));
  });
}

function renderTag(p) {
  const statusLabel = { AVAILABLE: 'Available', IN_USE: 'In Use', BROKEN: 'Broken' , IN_SHIPMENT: 'In shipment'}[p.status];
  const typeOptions = allTypes.map(t =>
    `<option value="${escapeAttr(t.name)}" ${t.name === p.type ? 'selected' : ''}>${escapeHtml(t.name)}</option>`
  ).join('');

  return `
    <div class="bin-tag" data-status="${p.status}" id="tag-${p.id}">
      <div class="view-mode">
        <div class="tag-top">
          <div class="tag-name">${escapeHtml(p.name)}</div>
          <div class="tag-qty">${p.quantity}<span>qty</span></div>
        </div>
        <div class="tag-perf"></div>
        <div class="tag-meta">
          <span class="status-badge" data-status="${p.status}">${statusLabel}</span>
          ${p.type ? `<span class="tag-type">🏷️ ${escapeHtml(p.type)}</span>` : ''}
        </div>
        <div class="tag-location">📍 ${p.location ? escapeHtml(p.location) : 'Unassigned'}</div>
        <div class="tag-actions">
          <div class="item-menu">
            <button class="menu-btn" id="menu-btn-${p.id}" type="button" aria-label="More actions">⋮</button>
            <div class="item-menu-popup" id="menu-${p.id}">
              <button id="edit-btn-${p.id}" type="button">Edit</button>
              <button id="split-btn-${p.id}" type="button">Split</button>
              <button class="delete" id="delete-btn-${p.id}" type="button">Delete</button>
            </div>
          </div>
        </div>
      </div>
      <div class="edit-mode">
        <div class="field">
          <label>Name</label>
          <input type="text" id="edit-name-${p.id}" value="${escapeAttr(p.name)}">
        </div>
        <div class="field">
          <label>Quantity</label>
          <div class="quantity-stepper">
            <button type="button" class="quantity-btn" data-quantity-target="edit-qty-${p.id}" data-quantity-change="-1" aria-label="Decrease quantity">−</button>
            <input type="number" min="0" id="edit-qty-${p.id}" value="${p.quantity}">
            <button type="button" class="quantity-btn" data-quantity-target="edit-qty-${p.id}" data-quantity-change="1" aria-label="Increase quantity">+</button>
          </div>
        </div>
        <div class="field">
          <label>Status</label>
          <select id="edit-status-${p.id}">
            <option value="AVAILABLE" ${p.status==='AVAILABLE'?'selected':''}>Available</option>
            <option value="IN_USE" ${p.status==='IN_USE'?'selected':''}>In Use</option>
            <option value="BROKEN" ${p.status==='BROKEN'?'selected':''}>Broken</option>
            <option value="IN_SHIPMENT" ${p.status==='IN_SHIPMENT'?'selected':''}>In shipment</option>
          </select>
        </div>
        <div class="field">
          <label>Location</label>
          <input type="text" id="edit-location-${p.id}" value="${escapeAttr(p.location || '')}" placeholder="e.g. Bin A3">
        </div>
        <div class="field">
          <label>Type / Tag</label>
          <select id="edit-type-${p.id}"><option value="">— none —</option>${typeOptions}</select>
        </div>
        <div class="edit-actions">
          <button class="save" id="save-btn-${p.id}">Save</button>
          <button class="cancel" id="cancel-btn-${p.id}">Cancel</button>
        </div>
      </div>
    </div>
  `;
}

function toggleEdit(id, on) {
  document.getElementById(`tag-${id}`).classList.toggle('editing', on);
}

function toggleItemMenu(id) {
  document.querySelectorAll('.item-menu-popup.open').forEach(menu => {
    if (menu.id !== `menu-${id}`) menu.classList.remove('open');
  });
  document.getElementById(`menu-${id}`).classList.toggle('open');
}

function changeQuantity(inputId, change) {
  const input = document.getElementById(inputId);
  const quantity = Math.max(0, Number(input.value) || 0);
  input.value = quantity + change;
}

function openSplitModal(part) {
  splitPartId = part.id;
  splitError.classList.remove('show');
  document.getElementById('splitQuantity').value = 1;
  document.getElementById('splitQuantity').max = part.quantity - 1;
  document.getElementById('splitStatus').value = part.status;
  document.getElementById('splitLocation').value = part.location || '';
  document.getElementById('splitType').innerHTML = '<option value="">— none —</option>' +
    allTypes.map(t => `<option value="${escapeAttr(t.name)}" ${t.name === part.type ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('');
  splitModal.classList.add('open');
}

function closeSplitModal() {
  splitModal.classList.remove('open');
  splitPartId = null;
}

async function submitSplit() {
  splitError.classList.remove('show');
  const body = {
    quantity: Number(document.getElementById('splitQuantity').value),
    status: document.getElementById('splitStatus').value,
    type: document.getElementById('splitType').value || null,
    location: document.getElementById('splitLocation').value.trim() || null,
  };

  try {
    const res = await fetch(`${API}/parts/${splitPartId}/split`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Split failed.');

    const sourceIndex = allParts.findIndex(p => p.id === splitPartId);
    if (sourceIndex !== -1) allParts[sourceIndex] = result.source;
    allParts.push(result.created);
    closeSplitModal();
    renderParts();
  } catch (error) {
    splitError.textContent = error.message;
    splitError.classList.add('show');
  }
}

// ---------- Mutations ----------
async function saveEdit(id) {
  const body = {
    name: document.getElementById(`edit-name-${id}`).value.trim(),
    quantity: Number(document.getElementById(`edit-qty-${id}`).value),
    status: document.getElementById(`edit-status-${id}`).value,
    location: document.getElementById(`edit-location-${id}`).value || null,
    type: document.getElementById(`edit-type-${id}`).value || null,
  };
  try {
    const res = await fetch(`${API}/parts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('API error');
    const result = await res.json();
    const updatedPart = result.part;
    const idx = allParts.findIndex(p => p.id === id);
    if (result.merged) {
      allParts = allParts.filter(p => p.id !== id && p.id !== updatedPart.id);
      allParts.push(updatedPart);
    } else if (idx !== -1) {
      allParts[idx] = updatedPart;
    }
  } catch (e) {
    const idx = allParts.findIndex(p => p.id === id);
    if(idx !== -1) allParts[idx] = { ...allParts[idx], ...body };
  }
  
  renderParts();
}

async function deletePart(id, name) {
  if (!confirm(`Remove "${name}" from the stockroom? This can't be undone.`)) return;
  try {
    const res = await fetch(`${API}/parts/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('API error');
    allParts = allParts.filter(p => p.id !== id);
  } catch (e) {
    allParts = allParts.filter(p => p.id !== id);
  }
  renderParts();
}

async function submitNewPart() {
  addError.classList.remove('show');
  const name = document.getElementById('f-name').value.trim();
  const quantity = Number(document.getElementById('f-quantity').value);
  const status = document.getElementById('f-status').value;
  const location = document.getElementById('f-location').value.trim();
  const type = document.getElementById('f-type').value;

  if (!name) {
    addError.textContent = 'Name is required.';
    addError.classList.add('show');
    return;
  }

  const payload = { name, quantity, status, location: location || null, type: type || null };

  try {
    const res = await fetch(`${API}/parts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('API error');
    allParts.push(await res.json());
  } catch (e) {
    payload.id = Date.now();
    allParts.push(payload);
  }

  closePanel();
  renderParts();
}

function openImportPanel() {
  importPanel.classList.add('open');
  importError.classList.remove('show');
}

function closeImportPanel() {
  importPanel.classList.remove('open');
  document.getElementById('csvFile').value = '';
  importError.classList.remove('show');
}

async function submitCsvImport() {
  importError.classList.remove('show');
  const file = document.getElementById('csvFile').files[0];

  if (!file) {
    importError.textContent = 'Choose a CSV file first.';
    importError.classList.add('show');
    return;
  }

  try {
    const res = await fetch(`${API}/import/csv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv: await file.text() }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Import failed.');

    closeImportPanel();
    await loadTypes();
    await loadParts();
    await loadBatches();
    alert(`Imported ${result.imported} part(s).`);
  } catch (error) {
    importError.textContent = error.message;
    importError.classList.add('show');
  }
}

async function addNewType() {
  const name = prompt('New type name (e.g. Sensor, Wheel, Fastener):');
  if (!name || !name.trim()) return;
  const trimmed = name.trim();
  
  try {
    const res = await fetch(`${API}/types`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    });
    if (!res.ok) throw new Error('API error');
    const createdType = await res.json();
    await loadTypes(createdType.name);
  } catch (e) {
    allTypes.push({ id: Date.now(), name: trimmed });
    await loadTypes(trimmed);
  }

  renderParts();
}

// ---------- Panel & Modal controls ----------
function openPanel() {
  addPanel.classList.add('open');
  addError.classList.remove('show');
}
function closePanel() {
  addPanel.classList.remove('open');
  document.getElementById('f-name').value = '';
  document.getElementById('f-quantity').value = 0;
  document.getElementById('f-status').value = 'AVAILABLE';
  document.getElementById('f-location').value = '';
  document.getElementById('f-type').value = '';
}

function openTagModal() { tagModal.classList.add('open'); }
function closeTagModal() { tagModal.classList.remove('open'); }

// ---------- Filters & Search ----------
document.getElementById('filterPills').addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-pill');
  if (!btn) return;
  document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  activeFilter = btn.dataset.filter;
  renderParts();
});

searchInput.addEventListener('input', () => {
  clearSearchBtn.classList.toggle('visible', searchInput.value.length > 0);
  renderParts();
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.item-menu')) {
    document.querySelectorAll('.item-menu-popup.open').forEach(menu => menu.classList.remove('open'));
  }
});

clearSearchBtn.addEventListener('click', () => {
  searchInput.value = '';
  clearSearchBtn.classList.remove('visible');
  searchInput.focus();
  renderParts();
});

// ---------- Utility ----------
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

// ---------- Wire up static buttons ----------
document.getElementById('togglePanelBtn').addEventListener('click', openPanel);
document.getElementById('cancelAddBtn').addEventListener('click', closePanel);
document.getElementById('submitAddBtn').addEventListener('click', submitNewPart);
document.querySelectorAll('[data-quantity-target="f-quantity"]').forEach(button => {
  button.addEventListener('click', () => changeQuantity(
    'f-quantity', Number(button.dataset.quantityChange)
  ));
});
document.getElementById('toggleImportBtn').addEventListener('click', openImportPanel);
document.getElementById('manageBatchesBtn').addEventListener('click', openBatchModal);
document.getElementById('cancelImportBtn').addEventListener('click', closeImportPanel);
document.getElementById('submitImportBtn').addEventListener('click', submitCsvImport);
document.getElementById('newTypeBtn').addEventListener('click', addNewType);

document.getElementById('manageTagsBtn').addEventListener('click', openTagModal);
document.getElementById('addTagModalBtn').addEventListener('click', addNewType);
document.getElementById('closeTagModalBtn').addEventListener('click', closeTagModal);
document.getElementById('closeTagModalGhostBtn').addEventListener('click', closeTagModal);
document.getElementById('closeSplitModalBtn').addEventListener('click', closeSplitModal);
document.getElementById('cancelSplitBtn').addEventListener('click', closeSplitModal);
document.getElementById('submitSplitBtn').addEventListener('click', submitSplit);
document.getElementById('closeBatchModalBtn').addEventListener('click', closeBatchModal);
document.getElementById('closeBatchModalGhostBtn').addEventListener('click', closeBatchModal);

// ---------- Init ----------
(async function init() {
  await loadTypes();
  await loadParts();
  await loadBatches();
})();