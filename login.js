const loginForm = document.querySelector('#login-form');
const loginMessage = document.querySelector('#login-message');

function showLoginMessage(message, type = 'error') {
  loginMessage.textContent = message;
  loginMessage.className = `feedback visible ${type}`;
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = loginForm.username.value.trim();
  const password = loginForm.password.value;
  if (!username || !password) return showLoginMessage('Informe usuário e senha.');
  const button = loginForm.querySelector('button');
  button.disabled = true;
  try {
    const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível entrar.');
    showLoginMessage(data.message, 'success');
    window.setTimeout(() => { window.location.href = '/'; }, 300);
  } catch (error) {
    showLoginMessage(error.message);
  } finally {
    button.disabled = false;
  }
});
