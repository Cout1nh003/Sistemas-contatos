import { BarChart3, Menu } from 'lucide-react';
export default function Header({ onMenu }) { return <header className="topbar"><button className="icon-button mobile-only" onClick={onMenu} aria-label="Abrir menu"><Menu size={21} /></button><div className="topbar-context"><BarChart3 size={17} /><span>Operação comercial</span></div><div className="online"><i /> Sessão ativa</div></header>; }
