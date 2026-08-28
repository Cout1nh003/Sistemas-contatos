const form = document.querySelector('#contact-form');
const contactsBody = document.querySelector('#contacts-body');
const emptyState = document.querySelector('#empty-state');
const appMessage = document.querySelector('#app-message');
const searchInput = document.querySelector('#search-input');
const sortSelect = document.querySelector('#sort-select');
let contacts = [];
let editingId = null;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
const formatDate = (value) => new Date(`${value}Z`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
function showMessage(message, type = 'success') { appMessage.textContent = message; appMessage.className = `feedback visible ${type}`; window.clearTimeout(showMessage.timeout); showMessage.timeout = window.setTimeout(() => { appMessage.className = 'feedback'; }, 4500); }
function formData() { return { nome: form.nome.value, email: form.email.value, telefone: form.telefone.value, assunto: form.assunto.value, mensagem: form.mensagem.value, newsletter: form.newsletter.checked }; }
function renderContacts() {
  const search = searchInput.value.trim().toLocaleLowerCase();
  const sort = sortSelect.value;
  const visible = contacts.filter((contact) => contact.nome.toLocaleLowerCase().includes(search)).sort((a, b) => sort === 'name-asc' ? a.nome.localeCompare(b.nome) : sort === 'name-desc' ? b.nome.localeCompare(a.nome) : sort === 'id-asc' ? a.id - b.id : b.id - a.id);
  contactsBody.innerHTML = visible.map((contact) => `<tr><td>#${contact.id}</td><td><span class="contact-name">${escapeHtml(contact.nome)}</span><br><span>${escapeHtml(contact.email)}</span></td><td>${escapeHtml(contact.telefone)}</td><td>${escapeHtml(contact.assunto)}</td><td class="message-cell" title="${escapeHtml(contact.mensagem)}">${escapeHtml(contact.mensagem)}</td><td>${contact.newsletter ? '<span class="newsletter-yes">&#10003;</span>' : '<span>-</span>'}</td><td>${formatDate(contact.recebidoEm)}</td><td><div class="actions"><button class="action-button" data-action="edit" data-id="${contact.id}" type="button">Editar</button><button class="action-button delete" data-action="delete" data-id="${contact.id}" type="button">Excluir</button></div></td></tr>`).join('');
  emptyState.classList.toggle('hidden', visible.length !== 0);
  document.querySelector('#contact-count').textContent = contacts.length;
  document.querySelector('#record-badge').textContent = `${contacts.length} ${contacts.length === 1 ? 'registro' : 'registros'}`;
  document.querySelector('#last-update').textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
async function loadContacts() {
  const response = await fetch('/dados');
  if (response.status === 401) return window.location.href = '/login.html';
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Falha ao carregar contatos.');
  contacts = data; renderContacts();
}
function resetForm() { form.reset(); editingId = null; document.querySelector('#contact-id').value = ''; document.querySelector('#form-title').textContent = 'Adicionar contato'; document.querySelector('#submit-button').innerHTML = 'Enviar contato <span aria-hidden="true">&#8594;</span>'; document.querySelector('#cancel-edit').classList.add('hidden'); }
function beginEdit(contact) { editingId = contact.id; form.nome.value = contact.nome; form.email.value = contact.email; form.telefone.value = contact.telefone; form.assunto.value = contact.assunto; form.mensagem.value = contact.mensagem; form.newsletter.checked = Boolean(contact.newsletter); document.querySelector('#form-title').textContent = 'Editar contato'; document.querySelector('#submit-button').innerHTML = 'Atualizar contato <span aria-hidden="true">&#8594;</span>'; document.querySelector('#cancel-edit').classList.remove('hidden'); document.querySelector('#nome').focus(); }
form.addEventListener('submit', async (event) => { event.preventDefault(); const payload = formData(); const method = editingId ? 'PUT' : 'POST'; const url = editingId ? `/api/contato/${editingId}` : '/api/contato'; const button = document.querySelector('#submit-button'); button.disabled = true; try { const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Não foi possível salvar.'); await loadContacts(); resetForm(); showMessage(data.message); } catch (error) { showMessage(error.message, 'error'); } finally { button.disabled = false; } });
contactsBody.addEventListener('click', async (event) => { const button = event.target.closest('button[data-action]'); if (!button) return; const id = Number(button.dataset.id); const contact = contacts.find((item) => item.id === id); if (button.dataset.action === 'edit' && contact) return beginEdit(contact); if (button.dataset.action === 'delete' && contact && window.confirm(`Excluir o contato de ${contact.nome}?`)) { try { const response = await fetch(`/api/contato/${id}`, { method: 'DELETE' }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Não foi possível excluir.'); await loadContacts(); showMessage(data.message); } catch (error) { showMessage(error.message, 'error'); } } });
searchInput.addEventListener('input', renderContacts); sortSelect.addEventListener('change', renderContacts); document.querySelector('#cancel-edit').addEventListener('click', resetForm); document.querySelector('#logout-button').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); window.location.href = '/login.html'; }); document.querySelector('#today-label').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
loadContacts().catch((error) => showMessage(error.message, 'error'));
