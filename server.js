const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const PDFDocument = require('pdfkit');
const sqlite3 = require('sqlite3').verbose();

const requiredEnvironment = ['SESSION_SECRET', 'ADMIN_USERNAME', 'ADMIN_PASSWORD'];
const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);
if (missingEnvironment.length) {
  console.error(`Configuração obrigatória ausente: ${missingEnvironment.join(', ')}`);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
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

const QUOTE_STATUSES = ['Rascunho', 'Enviado', 'Aprovado', 'Recusado', 'Em execução', 'Concluído', 'Cancelado'];

function numberValue(value) {
  const normalized = typeof value === 'string' ? (() => { const clean = value.replace(/R\$|\s/g, ''); return clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean; })() : value;
  const parsed = Number(normalized);
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
  if (id === 0) return `TEMP-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `ORC-${new Date().getFullYear()}-${String(id).padStart(4, '0')}`;
}

function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, function (error) { if (error) return reject(error); resolve(this); }));
}

function getQuery(sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
}

function allQuery(sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
}

const PRODUCT_SEEDS = [
  ['Vidros', 'Vidro temperado', 'Vidro temperado', 'M²', 180],
  ['Vidros', 'Vidro comum/float', 'Vidro comum/float', 'M²', 95],
  ['Vidros', 'Vidro laminado', 'Vidro laminado', 'M²', 240],
  ['Vidros', 'Vidro refletivo', 'Vidro refletivo', 'M²', 260],
  ['Vidros', 'Vidro serigrafado', 'Vidro serigrafado', 'M²', 230],
  ['Vidros', 'Espelho', 'Espelho', 'M²', 150],
  ['Esquadrias', 'Janela de correr', 'Linha 25', 'M²', 680],
  ['Esquadrias', 'Janela de abrir', 'Linha 30', 'M²', 760],
  ['Esquadrias', 'Porta de correr', 'Linha Suprema', 'M²', 980],
  ['Esquadrias', 'Porta pivotante', 'Linha Gold', 'M²', 1250],
  ['Ferragens', 'Roldana simples', 'Roldanas e rodízios', 'UN', 18],
  ['Ferragens', 'Roldana dupla', 'Roldanas e rodízios', 'UN', 32],
  ['Ferragens', 'Fecho concha', 'Fechos e fechaduras', 'UN', 26],
  ['Ferragens', 'Fechadura', 'Fechos e fechaduras', 'UN', 95],
  ['Ferragens', 'Puxador tubular', 'Puxadores', 'UN', 75],
  ['Ferragens', 'Dobradiça para vidro', 'Dobradiças', 'UN', 48],
  ['Ferragens', 'Borracha de vedação', 'Vedação', 'M', 12],
  ['Ferragens', 'Perfil de alumínio', 'Perfis e componentes', 'M', 42],
  ['Ferragens', 'Silicone', 'Outros', 'UN', 28]
];

async function seedCatalog() {
  await runQuery(`CREATE TRIGGER IF NOT EXISTS categorias_nome_produtos AFTER UPDATE OF nome ON categorias BEGIN UPDATE produtos SET categoria = NEW.nome WHERE categoria = OLD.nome; END`);
  const categories = [...new Set(PRODUCT_SEEDS.map((item) => item[0]))];
  for (const category of categories) await runQuery('INSERT OR IGNORE INTO categorias (nome, ativo) VALUES (?, 1)', [category]);
  const count = await getQuery('SELECT COUNT(*) AS total FROM produtos');
  if (count.total) return;
  for (const [category, name, subcategory, unit, price] of PRODUCT_SEEDS) {
    await runQuery('INSERT INTO produtos (nome, categoria, subcategoria, referencia, unidade, preco, ativo, observacao) VALUES (?, ?, ?, ?, ?, ?, 1, ?)', [name, category, subcategory, `DEMO-${name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 24)}`, unit, price, 'Preço demonstrativo configurável.']);
  }
}

async function ensureQuoteColumns() {
  const columns = await allQuery('PRAGMA table_info(orcamentos)');
  const existing = new Set(columns.map((column) => column.name));
  const additions = [
    ['clienteId', 'INTEGER'], ['validadeDias', 'INTEGER DEFAULT 10'], ['prazoExecucao', 'TEXT'], ['prazoEntrega', 'TEXT'],
    ['formaPagamento', 'TEXT'], ['garantia', 'TEXT'], ['condicoesGerais', 'TEXT'], ['maoObra', 'REAL NOT NULL DEFAULT 0'],
    ['deslocamento', 'REAL NOT NULL DEFAULT 0'], ['acrescimos', 'REAL NOT NULL DEFAULT 0'], ['totalGeral', 'REAL NOT NULL DEFAULT 0']
  ];
  for (const [name, definition] of additions) if (!existing.has(name)) await runQuery(`ALTER TABLE orcamentos ADD COLUMN ${name} ${definition}`);
}

function validateQuoteV2(body) {
  const items = Array.isArray(body.items) ? body.items : [];
  const normalizedItems = items.map((item) => {
    const quantity = numberValue(item.quantidade);
    const width = numberValue(item.largura) || 0;
    const height = numberValue(item.altura) || 0;
    const area = width * height;
    const unitPrice = numberValue(item.valorUnitario);
    const billableQuantity = area > 0 ? area * quantity : quantity;
    return { produtoId: Number.isInteger(Number(item.produtoId)) ? Number(item.produtoId) : null, descricao: String(item.descricao || '').trim(), categoria: String(item.categoria || '').trim(), unidade: String(item.unidade || 'UN').trim(), quantidade: quantity, largura: width, altura: height, area, valorUnitario: unitPrice, subtotal: billableQuantity * unitPrice };
  });
  if (!Number.isInteger(Number(body.clienteId)) || Number(body.clienteId) < 1) return { error: 'Selecione um cliente.' };
  if (!normalizedItems.length) return { error: 'Adicione pelo menos um item ao orçamento.' };
  if (normalizedItems.some((item) => !item.descricao || !Number.isFinite(item.quantidade) || item.quantidade <= 0 || !Number.isFinite(item.valorUnitario) || item.valorUnitario < 0)) return { error: 'Revise os itens e seus valores.' };
  const maoObra = numberValue(body.maoObra) || 0;
  const instalacao = numberValue(body.instalacao) || 0;
  const deslocamento = numberValue(body.deslocamento) || 0;
  const desconto = numberValue(body.desconto) || 0;
  const acrescimos = numberValue(body.acrescimos) || 0;
  if ([maoObra, instalacao, deslocamento, desconto, acrescimos].some((value) => value < 0)) return { error: 'Os valores financeiros não podem ser negativos.' };
  const subtotalProdutos = normalizedItems.reduce((total, item) => total + item.subtotal, 0);
  const subtotal = subtotalProdutos + maoObra + instalacao + deslocamento;
  if (desconto > subtotal) return { error: 'O desconto não pode ser maior que o subtotal.' };
  return { quote: { clienteId: Number(body.clienteId), items: normalizedItems, subtotalProdutos, maoObra, instalacao, deslocamento, desconto, acrescimos, totalGeral: subtotal - desconto + acrescimos, validadeDias: Number(body.validadeDias) || 10, prazoExecucao: String(body.prazoExecucao || '').trim(), prazoEntrega: String(body.prazoEntrega || '').trim(), formaPagamento: String(body.formaPagamento || '').trim(), garantia: String(body.garantia || '').trim(), condicoesGerais: String(body.condicoesGerais || '').trim(), observacoes: String(body.observacoes || '').trim(), status: QUOTE_STATUSES.includes(body.status) ? body.status : 'Rascunho' } };
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
          db.run(`CREATE TABLE IF NOT EXISTS clientes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            documento TEXT,
            telefone TEXT,
            whatsapp TEXT,
            email TEXT,
            endereco TEXT,
            numero TEXT,
            complemento TEXT,
            bairro TEXT,
            cidade TEXT,
            estado TEXT,
            cep TEXT,
            criadoEm TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          )`);
          db.run(`CREATE TABLE IF NOT EXISTS categorias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL UNIQUE,
            ativo INTEGER NOT NULL DEFAULT 1
          )`);
          db.run(`CREATE TABLE IF NOT EXISTS produtos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            categoria TEXT NOT NULL,
            subcategoria TEXT,
            referencia TEXT,
            unidade TEXT NOT NULL DEFAULT 'UN',
            preco REAL NOT NULL DEFAULT 0,
            ativo INTEGER NOT NULL DEFAULT 1,
            observacao TEXT,
            criadoEm TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          )`);
          db.run(`CREATE TABLE IF NOT EXISTS orcamento_itens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            orcamentoId INTEGER NOT NULL,
            produtoId INTEGER,
            descricao TEXT NOT NULL,
            categoria TEXT,
            unidade TEXT NOT NULL,
            quantidade REAL NOT NULL,
            largura REAL NOT NULL DEFAULT 0,
            altura REAL NOT NULL DEFAULT 0,
            area REAL NOT NULL DEFAULT 0,
            valorUnitario REAL NOT NULL DEFAULT 0,
            subtotal REAL NOT NULL DEFAULT 0,
            FOREIGN KEY (orcamentoId) REFERENCES orcamentos(id),
            FOREIGN KEY (produtoId) REFERENCES produtos(id)
          )`);
          db.run(`CREATE TABLE IF NOT EXISTS configuracoes_empresa (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            razaoSocial TEXT, nomeFantasia TEXT, cnpj TEXT, telefone TEXT, whatsapp TEXT,
            email TEXT, endereco TEXT, cep TEXT, cidade TEXT, estado TEXT, logo TEXT
          )`);
          db.run('INSERT OR IGNORE INTO configuracoes_empresa (id, nomeFantasia) VALUES (1, ?)', ['OrçaFlow']);
          db.serialize(async () => {
            try { await ensureQuoteColumns(); await seedCatalog(); } catch (setupError) { return reject(setupError); }
          });
          db.get('SELECT id FROM usuarios WHERE username = ?', [ADMIN_USERNAME], async (findError, user) => {
          if (findError) return reject(findError);
          if (user) return resolve();
          try {
            const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
            db.run('INSERT INTO usuarios (username, password) VALUES (?, ?)', [ADMIN_USERNAME, passwordHash], (insertError) => {
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

app.get('/api/produtos', requireAuth, async (req, res) => { try { const search = `%${String(req.query.search || '').trim()}%`; const rows = await allQuery(`SELECT * FROM produtos WHERE ativo = 1 AND (nome LIKE ? OR categoria LIKE ? OR referencia LIKE ?) ORDER BY categoria, nome`, [search, search, search]); res.json(rows); } catch (error) { sendError(res, 500, 'Não foi possível carregar os produtos.'); } });
app.get('/api/admin/produtos', requireAuth, async (req, res) => { try { const rows = await allQuery('SELECT * FROM produtos ORDER BY categoria, nome'); res.json(rows); } catch (error) { sendError(res, 500, 'Não foi possível carregar o catálogo.'); } });
app.post('/api/produtos', requireAuth, async (req, res) => { const product = [String(req.body.nome || '').trim(), String(req.body.categoria || '').trim(), String(req.body.subcategoria || '').trim(), String(req.body.referencia || '').trim(), ['UN', 'M', 'M²', 'KG', 'KIT'].includes(req.body.unidade) ? req.body.unidade : 'UN', numberValue(req.body.preco), req.body.ativo === false ? 0 : 1, String(req.body.observacao || '').trim()]; if (!product[0] || !product[1] || !Number.isFinite(product[5]) || product[5] < 0) return sendError(res, 400, 'Preencha os dados do produto.'); try { const result = await runQuery('INSERT INTO produtos (nome, categoria, subcategoria, referencia, unidade, preco, ativo, observacao) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', product); res.status(201).json({ message: 'Produto cadastrado com sucesso.', produto: { id: result.lastID } }); } catch (error) { sendError(res, 500, 'Não foi possível cadastrar o produto.'); } });
app.put('/api/produtos/:id', requireAuth, async (req, res) => { const id = Number.parseInt(req.params.id, 10); const product = [String(req.body.nome || '').trim(), String(req.body.categoria || '').trim(), String(req.body.subcategoria || '').trim(), String(req.body.referencia || '').trim(), ['UN', 'M', 'M²', 'KG', 'KIT'].includes(req.body.unidade) ? req.body.unidade : 'UN', numberValue(req.body.preco), req.body.ativo === false ? 0 : 1, String(req.body.observacao || '').trim(), id]; if (!Number.isInteger(id) || !product[0] || !product[1] || !Number.isFinite(product[5]) || product[5] < 0) return sendError(res, 400, 'Preencha os dados do produto.'); try { const result = await runQuery('UPDATE produtos SET nome = ?, categoria = ?, subcategoria = ?, referencia = ?, unidade = ?, preco = ?, ativo = ?, observacao = ? WHERE id = ?', product); if (!result.changes) return sendError(res, 404, 'Produto não encontrado.'); res.json({ message: 'Produto atualizado com sucesso.' }); } catch (error) { sendError(res, 500, 'Não foi possível atualizar o produto.'); } });
app.delete('/api/produtos/:id', requireAuth, async (req, res) => { const id = Number.parseInt(req.params.id, 10); if (!Number.isInteger(id)) return sendError(res, 400, 'Produto inválido.'); try { const used = await getQuery('SELECT COUNT(*) AS total FROM orcamento_itens WHERE produtoId = ?', [id]); if (used.total) return sendError(res, 409, 'Produto usado em orçamento; desative-o em vez de excluir.'); const result = await runQuery('DELETE FROM produtos WHERE id = ?', [id]); if (!result.changes) return sendError(res, 404, 'Produto não encontrado.'); res.json({ message: 'Produto excluído com sucesso.' }); } catch (error) { sendError(res, 500, 'Não foi possível excluir o produto.'); } });
app.get('/api/clientes', requireAuth, async (req, res) => { try { const search = `%${String(req.query.search || '').trim()}%`; res.json(await allQuery('SELECT * FROM clientes WHERE nome LIKE ? OR documento LIKE ? OR telefone LIKE ? ORDER BY nome', [search, search, search])); } catch (error) { sendError(res, 500, 'Não foi possível carregar os clientes.'); } });
app.post('/api/clientes', requireAuth, async (req, res) => { const values = ['nome', 'documento', 'telefone', 'whatsapp', 'email', 'endereco', 'numero', 'complemento', 'bairro', 'cidade', 'estado', 'cep'].map((key) => String(req.body[key] || '').trim()); if (!values[0]) return sendError(res, 400, 'Informe o nome do cliente.'); try { const result = await runQuery('INSERT INTO clientes (nome, documento, telefone, whatsapp, email, endereco, numero, complemento, bairro, cidade, estado, cep) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', values); res.status(201).json({ message: 'Cliente cadastrado com sucesso.', cliente: { id: result.lastID, nome: values[0] } }); } catch (error) { sendError(res, 500, 'Não foi possível cadastrar o cliente.'); } });
app.put('/api/clientes/:id', requireAuth, async (req, res) => { const id = Number.parseInt(req.params.id, 10); const values = ['nome', 'documento', 'telefone', 'whatsapp', 'email', 'endereco', 'numero', 'complemento', 'bairro', 'cidade', 'estado', 'cep'].map((key) => String(req.body[key] || '').trim()); if (!Number.isInteger(id) || !values[0]) return sendError(res, 400, 'Informe o nome do cliente.'); try { const result = await runQuery('UPDATE clientes SET nome = ?, documento = ?, telefone = ?, whatsapp = ?, email = ?, endereco = ?, numero = ?, complemento = ?, bairro = ?, cidade = ?, estado = ?, cep = ? WHERE id = ?', [...values, id]); if (!result.changes) return sendError(res, 404, 'Cliente não encontrado.'); res.json({ message: 'Cliente atualizado com sucesso.' }); } catch (error) { sendError(res, 500, 'Não foi possível atualizar o cliente.'); } });
app.get('/api/categorias', requireAuth, async (req, res) => { try { res.json(await allQuery('SELECT * FROM categorias WHERE ativo = 1 ORDER BY nome')); } catch (error) { sendError(res, 500, 'Não foi possível carregar as categorias.'); } });
app.post('/api/categorias', requireAuth, async (req, res) => { const name = String(req.body.nome || '').trim(); if (!name) return sendError(res, 400, 'Informe o nome da categoria.'); try { const result = await runQuery('INSERT INTO categorias (nome) VALUES (?)', [name]); res.status(201).json({ message: 'Categoria criada com sucesso.', categoria: { id: result.lastID, nome: name } }); } catch (error) { sendError(res, 409, 'Essa categoria já existe.'); } });
app.put('/api/categorias/:id', requireAuth, async (req, res) => { const id = Number.parseInt(req.params.id, 10); const name = String(req.body.nome || '').trim(); if (!Number.isInteger(id) || !name) return sendError(res, 400, 'Informe uma categoria válida.'); try { const result = await runQuery('UPDATE categorias SET nome = ? WHERE id = ?', [name, id]); if (!result.changes) return sendError(res, 404, 'Categoria não encontrada.'); await runQuery('UPDATE produtos SET categoria = ? WHERE categoria = (SELECT nome FROM categorias WHERE id = ?)', [name, id]); res.json({ message: 'Categoria atualizada com sucesso.' }); } catch (error) { sendError(res, 409, 'Não foi possível atualizar a categoria.'); } });
app.get('/api/configuracoes/empresa', requireAuth, async (req, res) => { try { res.json(await getQuery('SELECT * FROM configuracoes_empresa WHERE id = 1')); } catch (error) { sendError(res, 500, 'Não foi possível carregar as configurações.'); } });
app.put('/api/configuracoes/empresa', requireAuth, async (req, res) => { const keys = ['razaoSocial', 'nomeFantasia', 'cnpj', 'telefone', 'whatsapp', 'email', 'endereco', 'cep', 'cidade', 'estado', 'logo']; const values = keys.map((key) => String(req.body[key] || '').trim()); try { await runQuery(`UPDATE configuracoes_empresa SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE id = 1`, values); res.json({ message: 'Dados da empresa atualizados com sucesso.' }); } catch (error) { sendError(res, 500, 'Não foi possível salvar as configurações.'); } });

async function quoteWithItems(id) { const quote = await getQuery('SELECT o.*, c.nome AS clienteNome, c.documento AS clienteDocumento, c.telefone AS clienteTelefone, c.email AS clienteEmail FROM orcamentos o LEFT JOIN clientes c ON c.id = o.clienteId WHERE o.id = ?', [id]); if (!quote) return null; quote.items = await allQuery('SELECT * FROM orcamento_itens WHERE orcamentoId = ? ORDER BY id', [id]); return quote; }
app.use('/api/orcamentos', requireAuth, async (req, res, next) => { if (!['POST', 'PUT'].includes(req.method) || !Array.isArray(req.body.items)) return next(); try { for (const item of req.body.items) { if (!Number.isInteger(Number(item.produtoId))) continue; const product = await getQuery('SELECT id, nome, categoria, unidade, preco, ativo FROM produtos WHERE id = ?', [Number(item.produtoId)]); if (!product) return sendError(res, 400, 'Um dos produtos selecionados não existe.'); item.descricao = product.nome; item.categoria = product.categoria; item.unidade = product.unidade; item.valorUnitario = product.preco; } next(); } catch (error) { sendError(res, 500, 'Não foi possível validar os preços do catálogo.'); } });
app.get('/api/orcamentos', requireAuth, async (req, res) => { try { const search = String(req.query.search || '').trim(); const status = QUOTE_STATUSES.includes(req.query.status) ? req.query.status : ''; const clauses = []; const params = []; if (search) { clauses.push('(o.numero LIKE ? OR c.nome LIKE ?)'); params.push(`%${search}%`, `%${search}%`); } if (status) { clauses.push('o.status = ?'); params.push(status); } const rows = await allQuery(`SELECT o.*, c.nome AS clienteNome FROM orcamentos o LEFT JOIN clientes c ON c.id = o.clienteId ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY o.id DESC`, params); for (const row of rows) row.items = await allQuery('SELECT * FROM orcamento_itens WHERE orcamentoId = ?', [row.id]); res.json(rows); } catch (error) { sendError(res, 500, 'Não foi possível carregar os orçamentos.'); } });
app.post('/api/orcamentos', requireAuth, async (req, res) => { const result = validateQuoteV2(req.body); if (result.error) return sendError(res, 400, result.error); const quote = result.quote; try { const client = await getQuery('SELECT * FROM clientes WHERE id = ?', [quote.clienteId]); if (!client) return sendError(res, 400, 'Cliente não encontrado.'); const dbResult = await runQuery(`INSERT INTO orcamentos (numero, cliente, telefone, email, produto, largura, altura, area, areaTotal, quantidade, tipoVidro, espessura, acabamento, acessorios, precoVidroM2, valorVidro, valorFerragens, valorInstalacao, subtotal, desconto, valorFinal, observacoes, status, clienteId, validadeDias, prazoExecucao, prazoEntrega, formaPagamento, garantia, condicoesGerais, maoObra, deslocamento, acrescimos, totalGeral) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 1, '', '', '', '', 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [quoteNumber(0), client.nome, client.telefone || '', client.email || '', quote.items[0].descricao, quote.instalacao, quote.subtotalProdutos + quote.maoObra + quote.instalacao + quote.deslocamento, quote.desconto, quote.totalGeral, quote.observacoes, quote.status, quote.clienteId, quote.validadeDias, quote.prazoExecucao, quote.prazoEntrega, quote.formaPagamento, quote.garantia, quote.condicoesGerais, quote.maoObra, quote.deslocamento, quote.acrescimos, quote.totalGeral]); const id = dbResult.lastID; await runQuery('UPDATE orcamentos SET numero = ? WHERE id = ?', [quoteNumber(id), id]); for (const item of quote.items) await runQuery('INSERT INTO orcamento_itens (orcamentoId, produtoId, descricao, categoria, unidade, quantidade, largura, altura, area, valorUnitario, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, item.produtoId, item.descricao, item.categoria, item.unidade, item.quantidade, item.largura, item.altura, item.area, item.valorUnitario, item.subtotal]); res.status(201).json({ message: 'Orçamento criado com sucesso.', orcamento: await quoteWithItems(id) }); } catch (error) { sendError(res, 500, 'Não foi possível criar o orçamento.'); } });
app.put('/api/orcamentos/:id', requireAuth, async (req, res) => { const id = Number.parseInt(req.params.id, 10); const result = validateQuoteV2(req.body); if (!Number.isInteger(id) || result.error) return sendError(res, 400, result.error || 'Orçamento inválido.'); const quote = result.quote; try { const client = await getQuery('SELECT * FROM clientes WHERE id = ?', [quote.clienteId]); if (!client) return sendError(res, 400, 'Cliente não encontrado.'); const updated = await runQuery(`UPDATE orcamentos SET cliente = ?, telefone = ?, email = ?, produto = ?, subtotal = ?, desconto = ?, valorFinal = ?, valorInstalacao = ?, observacoes = ?, status = ?, clienteId = ?, validadeDias = ?, prazoExecucao = ?, prazoEntrega = ?, formaPagamento = ?, garantia = ?, condicoesGerais = ?, maoObra = ?, deslocamento = ?, acrescimos = ?, totalGeral = ? WHERE id = ?`, [client.nome, client.telefone || '', client.email || '', quote.items[0].descricao, quote.subtotalProdutos + quote.maoObra + quote.instalacao + quote.deslocamento, quote.desconto, quote.totalGeral, quote.instalacao, quote.observacoes, quote.status, quote.clienteId, quote.validadeDias, quote.prazoExecucao, quote.prazoEntrega, quote.formaPagamento, quote.garantia, quote.condicoesGerais, quote.maoObra, quote.deslocamento, quote.acrescimos, quote.totalGeral, id]); if (!updated.changes) return sendError(res, 404, 'Orçamento não encontrado.'); await runQuery('DELETE FROM orcamento_itens WHERE orcamentoId = ?', [id]); for (const item of quote.items) await runQuery('INSERT INTO orcamento_itens (orcamentoId, produtoId, descricao, categoria, unidade, quantidade, largura, altura, area, valorUnitario, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, item.produtoId, item.descricao, item.categoria, item.unidade, item.quantidade, item.largura, item.altura, item.area, item.valorUnitario, item.subtotal]); res.json({ message: 'Orçamento atualizado com sucesso.', orcamento: await quoteWithItems(id) }); } catch (error) { sendError(res, 500, 'Não foi possível atualizar o orçamento.'); } });
app.delete('/api/orcamentos/:id', requireAuth, async (req, res) => { const id = Number.parseInt(req.params.id, 10); if (!Number.isInteger(id)) return sendError(res, 400, 'Orçamento inválido.'); try { await runQuery('DELETE FROM orcamento_itens WHERE orcamentoId = ?', [id]); const result = await runQuery('DELETE FROM orcamentos WHERE id = ?', [id]); if (!result.changes) return sendError(res, 404, 'Orçamento não encontrado.'); res.json({ message: 'Orçamento excluído com sucesso.' }); } catch (error) { sendError(res, 500, 'Não foi possível excluir o orçamento.'); } });

app.get('/api/orcamentos/:id/pdf', requireAuth, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return sendError(res, 400, 'Orçamento inválido.');
  try {
    const quote = await quoteWithItems(id);
    const company = await getQuery('SELECT * FROM configuracoes_empresa WHERE id = 1');
    if (!quote) return sendError(res, 404, 'Orçamento não encontrado.');
    const document = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=${quote.numero}.pdf`);
    document.pipe(res);
    const currency = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    if (company.logo && fs.existsSync(path.resolve(company.logo))) document.image(path.resolve(company.logo), 42, 42, { fit: [90, 45] });
    document.fillColor('#0c7772').fontSize(22).font('Helvetica-Bold').text(company.nomeFantasia || company.razaoSocial || 'OrçaFlow');
    document.fillColor('#18252d').fontSize(9).font('Helvetica').text([company.cnpj, company.telefone, company.email, company.endereco, `${company.cidade || ''} ${company.estado || ''}`].filter(Boolean).join(' | '));
    document.moveDown(1).fillColor('#18252d').fontSize(18).font('Helvetica-Bold').text(`ORÇAMENTO ${quote.numero}`);
    document.fontSize(9).font('Helvetica').text(`Data: ${new Date(`${quote.criadoEm}Z`).toLocaleDateString('pt-BR')}   Validade: ${quote.validadeDias || 10} dias   Status: ${quote.status}`);
    document.moveDown(.8).font('Helvetica-Bold').text('CONTRATANTE');
    document.font('Helvetica').text(`${quote.clienteNome || quote.cliente} | ${quote.clienteDocumento || ''} | ${quote.clienteTelefone || quote.telefone || ''} | ${quote.clienteEmail || quote.email || ''}`);
    document.moveDown(.8).font('Helvetica-Bold').text('ITENS DO ORÇAMENTO');
    document.font('Helvetica').fontSize(9).text('Produto / descrição                         Qtd.    Unidade     Valor unitário        Subtotal');
    document.moveTo(42, document.y).lineTo(553, document.y).strokeColor('#d5e3e0').stroke();
    for (const item of quote.items) { if (document.y > 690) { document.addPage(); document.fontSize(9).font('Helvetica-Bold').text(`ORÇAMENTO ${quote.numero} - CONTINUAÇÃO`); document.font('Helvetica').text('Produto / descrição                         Qtd.    Unidade     Valor unitário        Subtotal'); } document.moveDown(.35).text(`${item.descricao.slice(0, 38).padEnd(40)} ${String(item.quantidade).padStart(4)}    ${item.unidade.padEnd(7)} ${currency(item.valorUnitario).padStart(15)} ${currency(item.subtotal).padStart(15)}`); }
    document.moveDown(1).font('Helvetica-Bold').text(`SUBTOTAL DOS PRODUTOS: ${currency(quote.subtotal - (quote.maoObra || 0) - (quote.deslocamento || 0) - (quote.valorInstalacao || 0))}`, { align: 'right' });
    document.font('Helvetica').text(`MÃO DE OBRA: ${currency(quote.maoObra)}\nINSTALAÇÃO: ${currency(quote.valorInstalacao)}\nDESLOCAMENTO: ${currency(quote.deslocamento)}\nDESCONTO: ${currency(quote.desconto)}\nACRÉSCIMOS: ${currency(quote.acrescimos)}`, { align: 'right' });
    document.moveDown(.5).fillColor('#0c7772').fontSize(16).font('Helvetica-Bold').text(`TOTAL GERAL: ${currency(quote.totalGeral || quote.valorFinal)}`, { align: 'right' });
    document.fillColor('#18252d').fontSize(9).font('Helvetica').moveDown(1).text(`Prazo de execução: ${quote.prazoExecucao || 'A combinar'} | Entrega: ${quote.prazoEntrega || 'A combinar'} | Pagamento: ${quote.formaPagamento || 'A combinar'}`);
    document.moveDown(.5).text(`Observações: ${quote.observacoes || 'Nenhuma.'}\nGarantia: ${quote.garantia || 'Conforme condições comerciais.'}\nCondições gerais: ${quote.condicoesGerais || 'Valores sujeitos à conferência técnica.'}`);
    document.moveDown(2).font('Helvetica-Bold').text('CONTRATANTE                                      CONTRATADO');
    document.moveDown(1.8).font('Helvetica').text('Nome: ____________________________              Nome: ____________________________');
    document.moveDown(.8).text('CPF/CNPJ: _________________________              CPF/CNPJ: _________________________');
    document.moveDown(1.5).text('Assinatura: ________________________              Assinatura: ________________________');
    document.moveDown(.8).text('Data: ____/____/________                         Data: ____/____/________');
    const pages = document.bufferedPageRange();
    for (let page = 0; page < pages.count; page += 1) { document.switchToPage(page); document.fontSize(8).fillColor('#728087').text(`Documento comercial | ${company.nomeFantasia || 'OrçaFlow'} | Página ${page + 1} de ${pages.count}`, 42, 800, { align: 'center', width: 511 }); }
    document.end();
  } catch (error) { if (!res.headersSent) sendError(res, 500, 'Não foi possível gerar o PDF.'); }
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


