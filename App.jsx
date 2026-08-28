import { useEffect, useState } from 'react';
import { authStatus } from './services/api';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Clients from './pages/Clients';
import Products from './pages/Products';
import Categories from './pages/Categories';
import Quotes from './pages/Quotes';
import Contacts from './pages/Contacts';
import Company from './pages/Company';
import { Toast } from './components/common';

const pages = { dashboard: Dashboard, quotes: Quotes, clients: Clients, products: Products, categories: Categories, contacts: Contacts, company: Company };
export default function App() {
  const loginPage = window.location.pathname === '/login.html';
  const [auth, setAuth] = useState(null);
  const [page, setPage] = useState('dashboard');
  const [toast, setToast] = useState(null);
  useEffect(() => { authStatus().then(setAuth).catch(() => setAuth({ authenticated: false })); }, []);
  if (loginPage) return <Login />;
  if (!auth) return <div className="loading-screen"><span className="spinner" />Carregando painel...</div>;
  if (!auth.authenticated) { window.location.href = '/login.html'; return null; }
  const Page = pages[page];
  const notify = (message, type = 'success') => { setToast({ message, type }); window.clearTimeout(window.toastTimer); window.toastTimer = window.setTimeout(() => setToast(null), 4500); };
  return <Layout page={page} setPage={setPage} username={auth.username}><Page notify={notify} setPage={setPage} /><Toast toast={toast} onClose={() => setToast(null)} /></Layout>;
}
