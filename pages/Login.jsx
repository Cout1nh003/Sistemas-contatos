import { useState } from 'react';
import { login } from '../services/api';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!username.trim() || !password) {
      setMessage('Informe usuário e senha.');
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      await login({
        username: username.trim(),
        password
      });

      window.location.href = '/';
    } catch (error) {
      setMessage(error.message || 'Não foi possível realizar o login.');
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-form" onSubmit={handleSubmit}>
        <h1>OrçaFlow</h1>
        <p>Entre no painel administrativo</p>

        <label htmlFor="username">Usuário</label>
        <input
          id="username"
          type="text"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          placeholder="Digite seu usuário"
        />

        <label htmlFor="password">Senha</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          placeholder="Digite sua senha"
        />

        {message && (
          <div className="feedback visible error">
            {message}
          </div>
        )}

        <button type="submit" disabled={loading}>
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
