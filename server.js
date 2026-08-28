const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'orcamentos-session-secret-change-me';
const PUBLIC_DIR = __dirname;
const db = new sqlite3.Database(path.join(__dirname, 'database.sqlite'));

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 }
}));

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return sendError(res, 401, 'Sua sessão expirou. Faça login novamente.');
  next();
}

function validateContact(body) {
  const contact = {
    nome: String(body.nome || '').trim(),
    email: String(body.email || '').trim(),
    telefone: String(body.telefone || '').trim(),
    assunto: String(body.assunto || '').trim(),
    mensagem: String(body.mensagem || '').trim(),
    newsletter: body.newsletter ? 1 : 0
  };
  if (!contact.nome || contact.nome.length > 120) return { error: 'Informe um nome válido.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email) || contact.email.length > 160) return { error: 'Informe um email válido.' };
  if (!contact.telefone || contact.telefone.length > 30) return { error: 'Informe um telefone válido.' };
  if (!contact.assunto || contact.assunto.length > 160) return { error: 'Informe um assunto válido.' };
  if (!contact.mensagem || contact.mensagem.length > 3000) return { error: 'A mensagem deve ter entre 1 e 3000 caracteres.' };
  return { contact };
}

function initializeDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS contatos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        email TEXT NOT NULL,
        telefone TEXT NOT NULL,
        assunto TEXT NOT NULL,
        mensagem TEXT NOT NULL,
        newsletter INTEGER NOT NULL DEFAULT 0,
        recebidoEm TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`, (error) => {
        if (error) return reject(error);
        db.get('SELECT id FROM usuarios WHERE username = ?', ['admin'], async (findError, user) => {
          if (findError) return reject(findError);
          if (user) return resolve();
          try {
            const passwordHash = await bcrypt.hash('1234', 12);
            db.run('INSERT INTO usuarios (username, password) VALUES (?, ?)', ['admin', passwordHash], (insertError) => {
              if (insertError) return reject(insertError);
              resolve();
            });
          } catch (hashError) {
            reject(hashError);
          }
        });
      });
    });
  });
}

app.get('/login.html', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.html')));
app.get('/', requireAuth, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.use(express.static(PUBLIC_DIR, { index: false }));

app.get('/api/auth/status', (req, res) => {
  res.json({ authenticated: Boolean(req.session.userId), username: req.session.username || null });
});

app.post('/api/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!username || !password) return sendError(res, 400, 'Informe usuário e senha.');
  db.get('SELECT id, username, password FROM usuarios WHERE username = ?', [username], async (error, user) => {
    if (error) return sendError(res, 500, 'Não foi possível realizar o login.');
    if (!user || !(await bcrypt.compare(password, user.password))) return sendError(res, 401, 'Usuário ou senha inválidos.');
    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ message: 'Login realizado com sucesso.', username: user.username });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy((error) => {
    if (error) return sendError(res, 500, 'Não foi possível encerrar a sessão.');
    res.clearCookie('connect.sid');
    res.json({ message: 'Sessão encerrada.' });
  });
});

app.post('/api/contato', requireAuth, (req, res) => {
  const result = validateContact(req.body);
  if (result.error) return sendError(res, 400, result.error);
  const { contact } = result;
  db.run(`INSERT INTO contatos (nome, email, telefone, assunto, mensagem, newsletter)
    VALUES (?, ?, ?, ?, ?, ?)`, [contact.nome, contact.email, contact.telefone, contact.assunto, contact.mensagem, contact.newsletter], function (error) {
    if (error) return sendError(res, 500, 'Não foi possível criar o contato.');
    db.get('SELECT * FROM contatos WHERE id = ?', [this.lastID], (selectError, row) => {
      if (selectError) return sendError(res, 500, 'Contato criado, mas não foi possível retorná-lo.');
      res.status(201).json({ message: 'Contato criado com sucesso.', contato: row });
    });
  });
});

app.get('/dados', requireAuth, (req, res) => {
  db.all('SELECT * FROM contatos ORDER BY id DESC', (error, rows) => {
    if (error) return sendError(res, 500, 'Não foi possível carregar os contatos.');
    res.json(rows);
  });
});

app.put('/api/contato/:id', requireAuth, (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const result = validateContact(req.body);
  if (!Number.isInteger(id) || id < 1) return sendError(res, 400, 'Contato inválido.');
  if (result.error) return sendError(res, 400, result.error);
  const { contact } = result;
  db.run(`UPDATE contatos SET nome = ?, email = ?, telefone = ?, assunto = ?, mensagem = ?, newsletter = ? WHERE id = ?`, [contact.nome, contact.email, contact.telefone, contact.assunto, contact.mensagem, contact.newsletter, id], function (error) {
    if (error) return sendError(res, 500, 'Não foi possível atualizar o contato.');
    if (!this.changes) return sendError(res, 404, 'Contato não encontrado.');
    db.get('SELECT * FROM contatos WHERE id = ?', [id], (selectError, row) => {
      if (selectError) return sendError(res, 500, 'Contato atualizado, mas não foi possível retorná-lo.');
      res.json({ message: 'Contato atualizado com sucesso.', contato: row });
    });
  });
});

app.delete('/api/contato/:id', requireAuth, (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) return sendError(res, 400, 'Contato inválido.');
  db.run('DELETE FROM contatos WHERE id = ?', [id], function (error) {
    if (error) return sendError(res, 500, 'Não foi possível excluir o contato.');
    if (!this.changes) return sendError(res, 404, 'Contato não encontrado.');
    res.json({ message: 'Contato excluído com sucesso.' });
  });
});

app.use((req, res) => {
  if (req.path.startsWith('/api/') || req.path === '/dados') return sendError(res, 404, 'Rota não encontrada.');
  res.status(404).send('Página não encontrada.');
});

initializeDatabase()
  .then(() => app.listen(PORT, '0.0.0.0', () => console.log(`Painel disponível em http://localhost:${PORT}`)))
  .catch((error) => {
    console.error('Falha ao inicializar o banco:', error);
    process.exit(1);
  });

process.on('SIGINT', () => db.close(() => process.exit(0)));
