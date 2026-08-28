const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'orcamentos-session-secret-change-me';
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, 'index.html')) ? __dirname : path.join(__dirname, 'public');
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

const QUOTE_STATUSES = ['Rascunho', 'Enviado', 'Aprovado', 'Recusado'];

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function validateQuote(body) {
  const quote = {
    cliente: String(body.cliente || '').trim(),
    telefone: String(body.telefone || '').trim(),
    email: String(body.email || '').trim(),
    produto: String(body.produto || '').trim(),
    largura: numberValue(body.largura),
    altura: numberValue(body.altura),
    quantidade: numberValue(body.quantidade),
    tipoVidro: String(body.tipoVidro || '').trim(),
    espessura: String(body.espessura || '').trim(),
    acabamento: String(body.acabamento || '').trim(),
    acessorios: String(body.acessorios || '').trim(),
    precoVidroM2: numberValue(body.precoVidroM2),
    valorFerragens: numberValue(body.valorFerragens),
    valorInstalacao: numberValue(body.valorInstalacao),
    desconto: numberValue(body.desconto),
    observacoes: String(body.observacoes || '').trim(),
    status: QUOTE_STATUSES.includes(body.status) ? body.status : 'Rascunho'
  };
  if (!quote.cliente || quote.cliente.length > 120) return { error: 'Informe um cliente válido.' };
  if (quote.telefone.length > 30) return { error: 'Informe um telefone válido.' };
  if (quote.email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(quote.email) || quote.email.length > 160)) return { error: 'Informe um email válido.' };
  if (!quote.produto || quote.produto.length > 160) return { error: 'Informe o produto ou serviço.' };
  if (!Number.isFinite(quote.largura) || quote.largura <= 0 || quote.largura > 100) return { error: 'Informe uma largura válida.' };
  if (!Number.isFinite(quote.altura) || quote.altura <= 0 || quote.altura > 100) return { error: 'Informe uma altura válida.' };
  if (!Number.isInteger(quote.quantidade) || quote.quantidade < 1 || quote.quantidade > 10000) return { error: 'Informe uma quantidade válida.' };
  if (!quote.tipoVidro || quote.tipoVidro.length > 100) return { error: 'Informe o tipo de vidro.' };
  if (!quote.espessura || quote.espessura.length > 50) return { error: 'Informe a espessura do vidro.' };
  if (quote.acabamento.length > 120 || quote.acessorios.length > 1000 || quote.observacoes.length > 3000) return { error: 'Um dos campos de texto excede o limite permitido.' };
  if (!Number.isFinite(quote.precoVidroM2) || quote.precoVidroM2 < 0 || !Number.isFinite(quote.valorFerragens) || quote.valorFerragens < 0 || !Number.isFinite(quote.valorInstalacao) || quote.valorInstalacao < 0 || !Number.isFinite(quote.desconto) || quote.desconto < 0) return { error: 'Informe valores válidos para os custos e desconto.' };
  const area = quote.largura * quote.altura;
  const areaTotal = area * quote.quantidade;
  const valorVidro = areaTotal * quote.precoVidroM2;
  const subtotal = valorVidro + quote.valorFerragens + quote.valorInstalacao;
  if (quote.desconto > subtotal) return { error: 'O desconto não pode ser maior que o subtotal.' };
  return { quote: { ...quote, area, areaTotal, valorVidro, subtotal, valorFinal: subtotal - quote.desconto } };
}

function quoteNumber(id) {
  return `ORC-${new Date().getFullYear()}-${String(id).padStart(4, '0')}`;
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
        db.run(`CREATE TABLE IF NOT EXISTS orcamentos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          numero TEXT NOT NULL UNIQUE,
          cliente TEXT NOT NULL,
          telefone TEXT NOT NULL,
          email TEXT,
          produto TEXT NOT NULL,
          largura REAL NOT NULL,
          altura REAL NOT NULL,
          area REAL NOT NULL,
          areaTotal REAL NOT NULL,
          quantidade INTEGER NOT NULL,
          tipoVidro TEXT NOT NULL,
          espessura TEXT NOT NULL,
          acabamento TEXT,
          acessorios TEXT,
          precoVidroM2 REAL NOT NULL,
          valorVidro REAL NOT NULL,
          valorFerragens REAL NOT NULL,
          valorInstalacao REAL NOT NULL,
          subtotal REAL NOT NULL,
          desconto REAL NOT NULL DEFAULT 0,
          valorFinal REAL NOT NULL,
          observacoes TEXT,
          status TEXT NOT NULL DEFAULT 'Rascunho',
          criadoEm TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`, (quoteTableError) => {
          if (quoteTableError) return reject(quoteTableError);
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

app.get('/api/orcamentos', requireAuth, (req, res) => {
  const search = String(req.query.search || '').trim();
  const status = QUOTE_STATUSES.includes(req.query.status) ? req.query.status : '';
  const clauses = [];
  const params = [];
  if (search) {
    clauses.push('(numero LIKE ? OR cliente LIKE ? OR produto LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  db.all(`SELECT * FROM orcamentos ${where} ORDER BY id DESC`, params, (error, rows) => {
    if (error) return sendError(res, 500, 'Não foi possível carregar os orçamentos.');
    res.json(rows);
  });
});

app.post('/api/orcamentos', requireAuth, (req, res) => {
  const result = validateQuote(req.body);
  if (result.error) return sendError(res, 400, result.error);
  const quote = result.quote;
  const temporaryNumber = `TEMP-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  db.run(`INSERT INTO orcamentos (numero, cliente, telefone, email, produto, largura, altura, area, areaTotal, quantidade, tipoVidro, espessura, acabamento, acessorios, precoVidroM2, valorVidro, valorFerragens, valorInstalacao, subtotal, desconto, valorFinal, observacoes, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [temporaryNumber, quote.cliente, quote.telefone, quote.email, quote.produto, quote.largura, quote.altura, quote.area, quote.areaTotal, quote.quantidade, quote.tipoVidro, quote.espessura, quote.acabamento, quote.acessorios, quote.precoVidroM2, quote.valorVidro, quote.valorFerragens, quote.valorInstalacao, quote.subtotal, quote.desconto, quote.valorFinal, quote.observacoes, quote.status], function (error) {
    if (error) return sendError(res, 500, 'Não foi possível criar o orçamento.');
    const id = this.lastID;
    const numero = quoteNumber(id);
    db.run('UPDATE orcamentos SET numero = ? WHERE id = ?', [numero, id], (updateError) => {
      if (updateError) return sendError(res, 500, 'Orçamento criado, mas não foi possível gerar o número.');
      db.get('SELECT * FROM orcamentos WHERE id = ?', [id], (selectError, row) => {
        if (selectError) return sendError(res, 500, 'Orçamento criado, mas não foi possível retorná-lo.');
        res.status(201).json({ message: 'Orçamento criado com sucesso.', orcamento: row });
      });
    });
  });
});

app.put('/api/orcamentos/:id', requireAuth, (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const result = validateQuote(req.body);
  if (!Number.isInteger(id) || id < 1) return sendError(res, 400, 'Orçamento inválido.');
  if (result.error) return sendError(res, 400, result.error);
  const quote = result.quote;
  db.run(`UPDATE orcamentos SET cliente = ?, telefone = ?, email = ?, produto = ?, largura = ?, altura = ?, area = ?, areaTotal = ?, quantidade = ?, tipoVidro = ?, espessura = ?, acabamento = ?, acessorios = ?, precoVidroM2 = ?, valorVidro = ?, valorFerragens = ?, valorInstalacao = ?, subtotal = ?, desconto = ?, valorFinal = ?, observacoes = ?, status = ? WHERE id = ?`, [quote.cliente, quote.telefone, quote.email, quote.produto, quote.largura, quote.altura, quote.area, quote.areaTotal, quote.quantidade, quote.tipoVidro, quote.espessura, quote.acabamento, quote.acessorios, quote.precoVidroM2, quote.valorVidro, quote.valorFerragens, quote.valorInstalacao, quote.subtotal, quote.desconto, quote.valorFinal, quote.observacoes, quote.status, id], function (error) {
    if (error) return sendError(res, 500, 'Não foi possível atualizar o orçamento.');
    if (!this.changes) return sendError(res, 404, 'Orçamento não encontrado.');
    db.get('SELECT * FROM orcamentos WHERE id = ?', [id], (selectError, row) => {
      if (selectError) return sendError(res, 500, 'Orçamento atualizado, mas não foi possível retorná-lo.');
      res.json({ message: 'Orçamento atualizado com sucesso.', orcamento: row });
    });
  });
});

app.delete('/api/orcamentos/:id', requireAuth, (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) return sendError(res, 400, 'Orçamento inválido.');
  db.run('DELETE FROM orcamentos WHERE id = ?', [id], function (error) {
    if (error) return sendError(res, 500, 'Não foi possível excluir o orçamento.');
    if (!this.changes) return sendError(res, 404, 'Orçamento não encontrado.');
    res.json({ message: 'Orçamento excluído com sucesso.' });
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

