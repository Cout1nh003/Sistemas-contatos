const api = async (url, options = {}) => {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : null;
  if (response.status === 401) {
    window.location.href = '/login.html';
    throw new Error('Sua sessão expirou.');
  }
  if (!response.ok) throw new Error(data?.error || 'Não foi possível concluir a operação.');
  return data;
};

export const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const getContacts = () => api('/dados');
export const saveContact = (id, body) => api(id ? `/api/contato/${id}` : '/api/contato', json(id ? 'PUT' : 'POST', body));
export const deleteContact = (id) => api(`/api/contato/${id}`, { method: 'DELETE' });
export const getClients = (search = '') => api(`/api/clientes${search ? `?search=${encodeURIComponent(search)}` : ''}`);
export const saveClient = (id, body) => api(id ? `/api/clientes/${id}` : '/api/clientes', json(id ? 'PUT' : 'POST', body));
export const deleteClient = (id) => api(`/api/clientes/${id}`, { method: 'DELETE' });
export const getProducts = (admin = false) => api(admin ? '/api/admin/produtos' : '/api/produtos');
export const saveProduct = (id, body) => api(id ? `/api/produtos/${id}` : '/api/produtos', json(id ? 'PUT' : 'POST', body));
export const deleteProduct = (id) => api(`/api/produtos/${id}`, { method: 'DELETE' });
export const getCategories = () => api('/api/categorias');
export const saveCategory = (id, body) => api(id ? `/api/categorias/${id}` : '/api/categorias', json(id ? 'PUT' : 'POST', body));
export const getQuotes = () => api('/api/orcamentos');
export const saveQuote = (id, body) => api(id ? `/api/orcamentos/${id}` : '/api/orcamentos', json(id ? 'PUT' : 'POST', body));
export const deleteQuote = (id) => api(`/api/orcamentos/${id}`, { method: 'DELETE' });
export const getCompany = () => api('/api/configuracoes/empresa');
export const saveCompany = (body) => api('/api/configuracoes/empresa', json('PUT', body));
export const logout = () => api('/api/logout', { method: 'POST' });
export const login = (body) => api('/api/login', json('POST', body));
export const authStatus = () => api('/api/auth/status');
export default api;
