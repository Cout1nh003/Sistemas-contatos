import { useState } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
export default function Layout({ page, setPage, username, children }) {
  const [open, setOpen] = useState(false);
  return <div className="app-shell"><Sidebar page={page} setPage={setPage} username={username} open={open} setOpen={setOpen} /><div className="main-shell"><Header onMenu={() => setOpen(true)} /><main className="content">{children}</main></div></div>;
}
