// =================================================================================================
// --- DEPENDÊNCIAS E CONFIGURAÇÃO INICIAL ---
// =================================================================================================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./database.js');
const multer = require('multer');
const path = require('path');
const sharp = require('sharp');
const fs = require('fs').promises;
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

// =================================================================================================
// --- MIDDLEWARES (Configurações do Servidor) ---
// =================================================================================================
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// NOVA ROTA ADICIONADA AQUI
// Rota para servir o cardápio (index.html) na raiz do site
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const UPLOAD_DIR = path.join(__dirname, 'public/images');

const garantirPastaDeUploads = async () => {
    try {
        await fs.mkdir(UPLOAD_DIR, { recursive: true });
        console.log(`Diretório de uploads garantido em: ${UPLOAD_DIR}`);
    } catch (error) {
        console.error("ERRO CRÍTICO: Não foi possível criar o diretório de uploads.", error);
        process.exit(1);
    }
};

// =================================================================================================
// --- LÓGICA DE AUTENTICAÇÃO ---
// =================================================================================================

app.post('/login', (req, res) => {
    const { email, senha } = req.body;
    if (!email || !senha) {
        return res.status(400).json({ error: "Email e senha são obrigatórios." });
    }
    const sql = "SELECT * FROM usuarios WHERE email = ?";
    db.get(sql, [email], async (err, usuario) => {
        if (err) return res.status(500).json({ error: "Erro interno do servidor." });
        if (!usuario) return res.status(401).json({ error: "Credenciais inválidas." });

        const senhaValida = await bcrypt.compare(senha, usuario.senha);
        if (!senhaValida) return res.status(401).json({ error: "Credenciais inválidas." });
        
        const payload = { id: usuario.id, nome: usuario.nome, cargo: usuario.cargo };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' });

        res.json({ message: "Login bem-sucedido!", token: token, usuario: payload });
    });
});

const protegerRota = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, process.env.JWT_SECRET, (err, usuario) => {
        if (err) return res.sendStatus(403);
        req.usuario = usuario;
        next();
    });
};

const apenasAdmin = (req, res, next) => {
    if (req.usuario && req.usuario.cargo === 'admin') {
        next();
    } else {
        res.status(403).json({ error: "Acesso negado. Recurso restrito a administradores." });
    }
};

// =================================================================================================
// --- ROTAS DA API (Versão corrigida, sem duplicatas) ---
// =================================================================================================

// --- ROTAS PÚBLICAS ---
app.get('/cardapio', (req, res) => {
    const sql = `
        SELECT pb.id, pb.nome, pb.descricao, pb.imagem_url, s.nome as setor_nome, s.id as setor_id,
               (SELECT json_group_array(json_object('id', v.id, 'nome', v.nome, 'preco', v.preco, 'slug', v.slug, 'quantidade_estoque', v.quantidade_estoque))
                FROM variacoes v WHERE v.produto_base_id = pb.id) as variacoes
        FROM produtos_base pb
        LEFT JOIN setores s ON pb.setor_id = s.id
        ORDER BY pb.ordem, pb.nome`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const cardapio = rows.map(row => ({...row, variacoes: JSON.parse(row.variacoes || '[]')}));
        res.json({ data: cardapio });
    });
});

app.get('/produtos', (req, res) => {
    const sql = `
        SELECT v.id, v.slug, v.nome AS nome_variacao, v.preco, v.quantidade_estoque, pb.nome AS nome_base
        FROM variacoes v JOIN produtos_base pb ON v.produto_base_id = pb.id`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const data = rows.map(r => ({
            id: r.id, slug: r.slug, nome: `${r.nome_base} ${r.nome_variacao}`,
            preco: r.preco, quantidade_estoque: r.quantidade_estoque
        }));
        res.json({ data });
    });
});

// --- ROTAS PROTEGIDAS PARA OPERADORES E ADMINS ---
app.get('/dashboard/produtos', protegerRota, (req, res) => {
    const sql = `
        SELECT pb.id, pb.nome, pb.descricao, pb.imagem_url, s.nome as setor_nome, s.id as setor_id,
               (SELECT json_group_array(json_object('id', v.id, 'nome', v.nome, 'preco', v.preco, 'slug', v.slug, 'quantidade_estoque', v.quantidade_estoque))
                FROM variacoes v WHERE v.produto_base_id = pb.id) as variacoes
        FROM produtos_base pb LEFT JOIN setores s ON pb.setor_id = s.id
        ORDER BY pb.ordem, pb.nome`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const produtos = rows.map(row => ({...row, variacoes: JSON.parse(row.variacoes || '[]')}));
        res.json({ data: produtos });
    });
});

app.get('/setores', protegerRota, (req, res) => {
    db.all("SELECT * FROM setores ORDER BY nome", [], (err, rows) => {
        if (err) { return res.status(500).json({ error: err.message }); }
        res.json({ data: rows });
    });
});

app.post('/variacao/estoque', protegerRota, (req, res) => {
    const { id, quantidade } = req.body;
    db.run(`UPDATE variacoes SET quantidade_estoque = ? WHERE id = ?`, [quantidade, id], function(err) {
        if (err) return res.status(500).json({ "error": err.message });
        res.json({ message: `Estoque da variação atualizado.` });
    });
});

app.post('/pedido', protegerRota, (req, res) => {
    const { itens } = req.body;
    if (!itens || !Array.isArray(itens)) return res.status(400).json({ error: 'Formato de itens inválido.' });
    db.serialize(() => {
        const stmt = db.prepare("UPDATE variacoes SET quantidade_estoque = quantidade_estoque - ? WHERE id = ? AND quantidade_estoque >= ?");
        itens.forEach(item => {
            stmt.run(item.qtd, item.id, item.qtd, function(err) {
                if (err) console.error(`Erro ao atualizar estoque para item ${item.id}:`, err);
                if (this.changes === 0) console.warn(`Estoque insuficiente ou item não encontrado para id ${item.id}.`);
            });
        });
        stmt.finalize((err) => {
            if (err) return res.status(500).json({ error: "Erro interno ao processar baixa de estoque." });
            res.json({ message: "Processo de baixa de estoque concluído." });
        });
    });
});

// --- ROTAS PROTEGIDAS APENAS PARA ADMINS ---
app.post('/dashboard/produtos/reordenar', protegerRota, apenasAdmin, (req, res) => {
    const { order } = req.body;
    if (!order || !Array.isArray(order)) { return res.status(400).json({ error: "Formato de ordem inválido." }); }
    db.serialize(() => {
        const stmt = db.prepare("UPDATE produtos_base SET ordem = ? WHERE id = ?");
        order.forEach((id, index) => { stmt.run(index, id); });
        stmt.finalize((err) => {
            if (err) return res.status(500).json({ error: "Falha ao salvar a nova ordem." });
            res.json({ message: "Ordem dos produtos atualizada com sucesso!" });
        });
    });
});

app.post('/produtos_base', protegerRota, apenasAdmin, upload.single('imagem'), async (req, res) => {
    const { nome, descricao, setor_id } = req.body;
    if (!req.file) return res.status(400).json({ error: "A imagem é obrigatória." });
    const nomeArquivo = `${Date.now()}-${nome.replace(/\s+/g, '-').toLowerCase()}.webp`;
    const caminhoArquivo = path.join(UPLOAD_DIR, nomeArquivo);
    await sharp(req.file.buffer).resize(400).webp({ quality: 80 }).toFile(caminhoArquivo);
    const imagem_url = `/images/${nomeArquivo}`;
    db.run(`INSERT INTO produtos_base (nome, descricao, setor_id, imagem_url) VALUES (?, ?, ?, ?)`,
        [nome, descricao, setor_id, imagem_url], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID });
    });
});

app.put('/produtos_base/:id', protegerRota, apenasAdmin, upload.single('imagem'), async (req, res) => {
    const { nome, descricao, setor_id } = req.body;
    let sql = `UPDATE produtos_base SET nome = ?, descricao = ?, setor_id = ?`;
    let params = [nome, descricao, setor_id];
    if (req.file) {
        const nomeArquivo = `${Date.now()}-${nome.replace(/\s+/g, '-').toLowerCase()}.webp`;
        const caminhoArquivo = path.join(UPLOAD_DIR, nomeArquivo);
        await sharp(req.file.buffer).resize(400).webp({ quality: 80 }).toFile(caminhoArquivo);
        const imagem_url = `/images/${nomeArquivo}`;
        sql += `, imagem_url = ?`;
        params.push(imagem_url);
    }
    sql += ` WHERE id = ?`;
    params.push(req.params.id);
    db.run(sql, params, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Produto base atualizado!' });
    });
});

app.delete('/produtos_base/:id', protegerRota, apenasAdmin, (req, res) => {
    db.run(`DELETE FROM produtos_base WHERE id = ?`, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Produto base e suas variações foram excluídos.' });
    });
});

app.post('/variacoes', protegerRota, apenasAdmin, (req, res) => {
    const { produto_base_id, nome, slug, preco } = req.body;
    db.run(`INSERT INTO variacoes (produto_base_id, nome, slug, preco, quantidade_estoque) VALUES (?, ?, ?, ?, 0)`,
        [produto_base_id, nome, slug, preco], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID });
    });
});

app.put('/variacoes/:id', protegerRota, apenasAdmin, (req, res) => {
    const { nome, slug, preco } = req.body;
    db.run(`UPDATE variacoes SET nome = ?, slug = ?, preco = ? WHERE id = ?`,
        [nome, slug, preco, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Variação atualizada!' });
    });
});

app.delete('/variacoes/:id', protegerRota, apenasAdmin, (req, res) => {
    db.run(`DELETE FROM variacoes WHERE id = ?`, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Variação excluída.' });
    });
});

app.post('/variacoes/:id/duplicar', protegerRota, apenasAdmin, (req, res) => {
    const id = req.params.id;
    db.get('SELECT * FROM variacoes WHERE id = ?', [id], (err, variacao) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!variacao) return res.status(404).json({ error: "Variação não encontrada." });
        const novoNome = `${variacao.nome} (cópia)`;
        const novoSlug = `${variacao.slug}-copia-${Date.now()}`;
        db.run('INSERT INTO variacoes (produto_base_id, nome, slug, preco, quantidade_estoque) VALUES (?, ?, ?, ?, ?)',
            [variacao.produto_base_id, novoNome, novoSlug, variacao.preco, variacao.quantidade_estoque], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Variação duplicada com sucesso!', newId: this.lastID });
        });
    });
});

app.post('/produtos_base/:id/duplicar', protegerRota, apenasAdmin, (req, res) => {
    const id = req.params.id;
    db.serialize(() => {
        db.get('SELECT * FROM produtos_base WHERE id = ?', [id], (err, produto) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!produto) return res.status(404).json({ error: "Produto base não encontrado." });
            const novoNome = `${produto.nome} (cópia)`;
            db.run('INSERT INTO produtos_base (nome, descricao, imagem_url, setor_id) VALUES (?, ?, ?, ?)',
                [novoNome, produto.descricao, produto.imagem_url, produto.setor_id], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                const novoProdutoBaseId = this.lastID;
                db.all('SELECT * FROM variacoes WHERE produto_base_id = ?', [id], (err, variacoes) => {
                    if (err) return res.status(500).json({ error: err.message });
                    const stmt = db.prepare('INSERT INTO variacoes (produto_base_id, nome, slug, preco, quantidade_estoque) VALUES (?, ?, ?, ?, ?)');
                    variacoes.forEach((v, index) => {
                        const novoSlug = `${v.slug}-copia-${Date.now()}-${index}`;
                        stmt.run(novoProdutoBaseId, v.nome, novoSlug, v.preco, v.quantidade_estoque);
                    });
                    stmt.finalize((err) => {
                        if (err) return res.status(500).json({ error: "Erro ao finalizar a duplicação de variações."});
                        res.json({ message: 'Produto base e suas variações duplicados com sucesso!', newId: novoProdutoBaseId });
                    });
                });
            });
        });
    });
});

app.post('/setores', protegerRota, apenasAdmin, (req, res) => {
    db.run(`INSERT INTO setores (nome) VALUES (?)`, [req.body.nome], function(err) {
        if (err) { return res.status(500).json({ error: err.message }); }
        res.json({ id: this.lastID });
    });
});

app.put('/setores/:id', protegerRota, apenasAdmin, (req, res) => {
    db.run(`UPDATE setores SET nome = ? WHERE id = ?`, [req.body.nome, req.params.id], function(err) {
        if (err) { return res.status(500).json({ error: err.message }); }
        res.json({ message: "Setor atualizado." });
    });
});

app.delete('/setores/:id', protegerRota, apenasAdmin, (req, res) => {
    db.run(`DELETE FROM setores WHERE id = ?`, [req.params.id], function(err) {
        if (err) { return res.status(500).json({ error: err.message }); }
        res.json({ message: "Setor excluído." });
    });
});

const iniciarServidor = async () => {
    await garantirPastaDeUploads();
    app.listen(PORT, () => {
        console.log(`Servidor rodando na porta ${PORT}`);
    });
};

iniciarServidor();