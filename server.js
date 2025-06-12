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
const PORT = process.env.PORT || 10000;

// =================================================================================================
// --- MIDDLEWARES (Configurações do Servidor) ---
// =================================================================================================
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const UPLOAD_DIR = path.join(__dirname, 'public/images');

const garantirPastaDeUploads = async () => {
    try {
        await fs.mkdir(UPLOAD_DIR, { recursive: true });
    } catch (error) {
        console.error("ERRO CRÍTICO: Não foi possível criar o diretório de uploads.", error);
    }
};

// =================================================================================================
// --- LÓGICA DE AUTENTICAÇÃO ---
// =================================================================================================

app.post('/login', async (req, res) => {
    try {
        const { email, senha } = req.body;
        if (!email || !senha) {
            return res.status(400).json({ error: "Email e senha são obrigatórios." });
        }
        const sql = "SELECT * FROM usuarios WHERE email = $1";
        const { rows } = await db.query(sql, [email]);
        const usuario = rows[0];

        if (!usuario) return res.status(401).json({ error: "Credenciais inválidas." });

        const senhaValida = await bcrypt.compare(senha, usuario.senha);
        if (!senhaValida) return res.status(401).json({ error: "Credenciais inválidas." });

        const payload = { id: usuario.id, nome: usuario.nome, cargo: usuario.cargo };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' });

        res.json({ message: "Login bem-sucedido!", token: token, usuario: payload });
    } catch (err) {
        console.error("Erro no login:", err);
        res.status(500).json({ error: "Erro interno do servidor." });
    }
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
// --- ROTAS DA API ---
// =================================================================================================
const getCardapioCompleto = async () => {
    const sql = `
        SELECT 
            pb.id, pb.nome, pb.descricao, pb.imagem_url, pb.ordem, s.nome as setor_nome, s.id as setor_id,
            COALESCE(
                (SELECT json_agg(
                    json_build_object(
                        'id', v.id, 'nome', v.nome, 'preco', v.preco, 
                        'slug', v.slug, 'quantidade_estoque', v.quantidade_estoque
                    ) ORDER BY v.id
                )
                FROM variacoes v WHERE v.produto_base_id = pb.id),
                '[]'::json
            ) as variacoes
        FROM produtos_base pb
        LEFT JOIN setores s ON pb.setor_id = s.id
        ORDER BY pb.ordem, pb.nome`;
    const { rows } = await db.query(sql);
    return rows;
};

app.get('/cardapio', async (req, res) => {
    try {
        const cardapio = await getCardapioCompleto();
        res.json({ data: cardapio });
    } catch (err) {
        console.error("Erro ao buscar cardápio:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/produtos', async (req, res) => {
    try {
        const sql = `
            SELECT v.id, v.slug, v.nome AS nome_variacao, v.preco, v.quantidade_estoque, pb.nome AS nome_base
            FROM variacoes v JOIN produtos_base pb ON v.produto_base_id = pb.id`;
        const { rows } = await db.query(sql);
        const data = rows.map(r => ({
            id: r.id, slug: r.slug, nome: `${r.nome_base} ${r.nome_variacao}`,
            preco: r.preco, quantidade_estoque: r.quantidade_estoque
        }));
        res.json({ data });
    } catch (err) {
        console.error("Erro ao buscar produtos:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/dashboard/produtos', protegerRota, async (req, res) => {
    try {
        const produtos = await getCardapioCompleto();
        res.json({ data: produtos });
    } catch (err) {
        console.error("Erro ao buscar produtos para o dashboard:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/setores', protegerRota, async (req, res) => {
    try {
        const { rows } = await db.query("SELECT * FROM setores ORDER BY nome");
        res.json({ data: rows });
    } catch (err) {
        console.error("Erro ao buscar setores:", err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/variacao/estoque', protegerRota, async (req, res) => {
    try {
        const { id, quantidade } = req.body;
        await db.query(`UPDATE variacoes SET quantidade_estoque = $1 WHERE id = $2`, [quantidade, id]);
        res.json({ message: `Estoque da variação atualizado.` });
    } catch (err) {
        console.error("Erro ao atualizar estoque:", err);
        res.status(500).json({ "error": err.message });
    }
});

app.post('/pedido', protegerRota, async (req, res) => {
    const { itens } = req.body;
    if (!itens || !Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({ error: 'Formato de itens inválido.' });
    }
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        for (const item of itens) {
            const updateQuery = "UPDATE variacoes SET quantidade_estoque = quantidade_estoque - $1 WHERE id = $2 AND quantidade_estoque >= $1";
            const result = await client.query(updateQuery, [item.qtd, item.id]);
            if (result.rowCount === 0) {
                throw new Error(`Estoque insuficiente para o item ID ${item.id}.`);
            }
        }
        await client.query('COMMIT');
        res.json({ message: "Processo de baixa de estoque concluído com sucesso." });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Erro na transação de pedido, rollback executado:", err);
        res.status(500).json({ error: "Erro interno ao processar baixa de estoque. A operação foi cancelada." });
    } finally {
        client.release();
    }
});

// --- ROTAS PROTEGIDAS APENAS PARA ADMINS ---
app.post('/dashboard/produtos/reordenar', protegerRota, apenasAdmin, async (req, res) => {
    const { order } = req.body;
    if (!order || !Array.isArray(order)) {
        return res.status(400).json({ error: "Formato de ordem inválido." });
    }
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        for (let i = 0; i < order.length; i++) {
            await client.query("UPDATE produtos_base SET ordem = $1 WHERE id = $2", [i, order[i]]);
        }
        await client.query('COMMIT');
        res.json({ message: "Ordem dos produtos atualizada com sucesso!" });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Erro ao reordenar produtos:", err);
        res.status(500).json({ error: "Falha ao salvar a nova ordem." });
    } finally {
        client.release();
    }
});

app.post('/produtos_base', protegerRota, apenasAdmin, upload.single('imagem'), async (req, res) => {
    try {
        const { nome, descricao, setor_id } = req.body;
        if (!req.file) return res.status(400).json({ error: "A imagem é obrigatória." });
        
        const nomeArquivo = `${Date.now()}-${nome.replace(/\s+/g, '-').toLowerCase()}.webp`;
        const imagem_url = `/images/${nomeArquivo}`;
        
        const { rows } = await db.query(`INSERT INTO produtos_base (nome, descricao, setor_id, imagem_url) VALUES ($1, $2, $3, $4) RETURNING id`,
            [nome, descricao, setor_id, imagem_url]);
        res.status(201).json({ id: rows[0].id });
    } catch (err) {
        console.error("Erro ao criar produto base:", err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/produtos_base/:id', protegerRota, apenasAdmin, upload.single('imagem'), async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, descricao, setor_id } = req.body;
        let imagem_url;
        if (req.file) {
            imagem_url = `/images/${Date.now()}-${nome.replace(/\s+/g, '-').toLowerCase()}.webp`;
        }
        let sql = 'UPDATE produtos_base SET nome = $1, descricao = $2, setor_id = $3';
        const params = [nome, descricao, setor_id];
        let paramCount = 4;
        if(imagem_url) {
            sql += `, imagem_url = $${paramCount++}`;
            params.push(imagem_url);
        }
        sql += ` WHERE id = $${paramCount}`;
        params.push(id);
        
        await db.query(sql, params);
        res.json({ message: 'Produto base atualizado!' });
    } catch (err) {
        console.error("Erro ao atualizar produto base:", err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/produtos_base/:id', protegerRota, apenasAdmin, async (req, res) => {
    try {
        await db.query(`DELETE FROM produtos_base WHERE id = $1`, [req.params.id]);
        res.json({ message: 'Produto base e suas variações foram excluídos.' });
    } catch (err) {
        console.error("Erro ao deletar produto base:", err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/variacoes', protegerRota, apenasAdmin, async (req, res) => {
    try {
        const { produto_base_id, nome, slug, preco } = req.body;
        const { rows } = await db.query(`INSERT INTO variacoes (produto_base_id, nome, slug, preco, quantidade_estoque) VALUES ($1, $2, $3, $4, 0) RETURNING id`,
            [produto_base_id, nome, slug, preco]);
        res.status(201).json({ id: rows[0].id });
    } catch (err) {
        console.error("Erro ao criar variação:", err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/variacoes/:id', protegerRota, apenasAdmin, async (req, res) => {
    try {
        const { nome, slug, preco } = req.body;
        await db.query(`UPDATE variacoes SET nome = $1, slug = $2, preco = $3 WHERE id = $4`,
            [nome, slug, preco, req.params.id]);
        res.json({ message: 'Variação atualizada!' });
    } catch (err) {
        console.error("Erro ao atualizar variação:", err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/variacoes/:id', protegerRota, apenasAdmin, async (req, res) => {
    try {
        await db.query(`DELETE FROM variacoes WHERE id = $1`, [req.params.id]);
        res.json({ message: 'Variação excluída.' });
    } catch (err) {
        console.error("Erro ao deletar variação:", err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/variacoes/:id/duplicar', protegerRota, apenasAdmin, async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM variacoes WHERE id = $1', [req.params.id]);
        const variacao = rows[0];
        if (!variacao) return res.status(404).json({ error: "Variação não encontrada." });

        const novoNome = `${variacao.nome} (cópia)`;
        const novoSlug = `${variacao.slug}-copia-${Date.now()}`;
        
        const { rows: newRows } = await db.query('INSERT INTO variacoes (produto_base_id, nome, slug, preco, quantidade_estoque) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [variacao.produto_base_id, novoNome, novoSlug, variacao.preco, variacao.quantidade_estoque]);
        
        res.json({ message: 'Variação duplicada com sucesso!', newId: newRows[0].id });
    } catch (err) {
        console.error("Erro ao duplicar variação:", err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/produtos_base/:id/duplicar', protegerRota, apenasAdmin, async (req, res) => {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const { rows: produtoRows } = await client.query('SELECT * FROM produtos_base WHERE id = $1', [req.params.id]);
        const produto = produtoRows[0];
        if (!produto) throw new Error("Produto base não encontrado.");
        
        const novoNome = `${produto.nome} (cópia)`;
        const { rows: newProdutoRows } = await client.query('INSERT INTO produtos_base (nome, descricao, imagem_url, setor_id) VALUES ($1, $2, $3, $4) RETURNING id',
            [novoNome, produto.descricao, produto.imagem_url, produto.setor_id]);
        const novoProdutoBaseId = newProdutoRows[0].id;

        const { rows: variacoes } = await client.query('SELECT * FROM variacoes WHERE produto_base_id = $1', [req.params.id]);
        for(const v of variacoes) {
            const novoSlug = `${v.slug}-copia-${Date.now()}`;
            await client.query('INSERT INTO variacoes (produto_base_id, nome, slug, preco, quantidade_estoque) VALUES ($1, $2, $3, $4, $5)',
                [novoProdutoBaseId, v.nome, novoSlug, v.preco, v.quantidade_estoque]);
        }
        await client.query('COMMIT');
        res.json({ message: 'Produto base e suas variações duplicados com sucesso!', newId: novoProdutoBaseId });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Erro ao duplicar produto base:", err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.post('/setores', protegerRota, apenasAdmin, async (req, res) => {
    try {
        const { rows } = await db.query(`INSERT INTO setores (nome) VALUES ($1) RETURNING id`, [req.body.nome]);
        res.status(201).json({ id: rows[0].id });
    } catch (err) {
        console.error("Erro ao criar setor:", err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/setores/:id', protegerRota, apenasAdmin, async (req, res) => {
    try {
        await db.query(`UPDATE setores SET nome = $1 WHERE id = $2`, [req.body.nome, req.params.id]);
        res.json({ message: "Setor atualizado." });
    } catch (err) {
        console.error("Erro ao atualizar setor:", err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/setores/:id', protegerRota, apenasAdmin, async (req, res) => {
    try {
        await db.query(`DELETE FROM setores WHERE id = $1`, [req.params.id]);
        res.json({ message: "Setor excluído." });
    } catch (err) {
        console.error("Erro ao deletar setor:", err);
        res.status(500).json({ error: err.message });
    }
});

const iniciarServidor = async () => {
    await garantirPastaDeUploads();
    app.listen(PORT, () => {
        console.log(`Servidor rodando na porta ${PORT}`);
    });
};

iniciarServidor();