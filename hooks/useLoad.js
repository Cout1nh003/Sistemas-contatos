import { useCallback, useEffect, useState } from 'react';

export function useLoad(loader, dependencies = []) {
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  const reload = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try { setState({ data: await loader(), loading: false, error: '' }); }
    catch (error) { setState({ data: null, loading: false, error: error.message }); }
  }, dependencies);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

export const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const date = (value) => value ? new Date(`${value}Z`).toLocaleDateString('pt-BR') : '-';
