import { AlertCircle, Check, X } from 'lucide-react';

export function Button({ children, variant = 'primary', icon: Icon, ...props }) { return <button className={`button button-${variant}`} {...props}>{Icon && <Icon size={16} />}{children}</button>; }
export function Card({ children, className = '' }) { return <section className={`panel ${className}`}>{children}</section>; }
export function SectionTitle({ eyebrow, title, children }) { return <div className="section-title"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>{children}</div>; }
export function Field({ label, children, wide = false }) { return <label className={`field ${wide ? 'field-wide' : ''}`}><span>{label}</span>{children}</label>; }
export function Empty({ children = 'Nenhum registro encontrado.' }) { return <div className="empty-state">{children}</div>; }
export function Spinner() { return <span className="spinner" aria-label="Carregando" />; }
export function Toast({ toast, onClose }) { if (!toast) return null; return <div className={`toast ${toast.type}`} role="status"><span>{toast.type === 'error' ? <AlertCircle size={18} /> : <Check size={18} />}</span>{toast.message}<button onClick={onClose} aria-label="Fechar"><X size={16} /></button></div>; }
export function Modal({ title, children, onClose }) { return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="modal"><div className="modal-heading"><h3>{title}</h3><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={18} /></button></div>{children}</div></div>; }
