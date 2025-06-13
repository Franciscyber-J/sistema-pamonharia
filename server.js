// =================================================================================================
// --- DEPENDÊNCIAS E CONFIGURAÇÃO INICIAL ---
// =================================================================================================
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const db = require('./database.js');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'pamonharia',
        format: 'webp',
        transformation: [{ width: 500, height: 500, crop: 'limit' }]
    },
});

const upload = multer({ storage: storage });
const PORT = process.env.PORT || 10000;

// =================================================================================================
// --- MIDDLEWARES E ROTAS DE PÁGINAS ---
// =================================================================================================
app.use(cors());
app.use(express.json());
app.use(express.static('public', { index: false }));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.get('/cardapio', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// =================================================================================================
// --- LÓGICA DE AUTENTICAÇÃO ---
// =================================================================================================
app.post('/login', async (req, res) => {
    try {
        const { email, senha } = req.body;
        if (!email || !senha) return res.status(400).json({ error: "Email e senha são obrigatórios." });
        const { rows } = await db.query("SELECT * FROM usuarios WHERE email = $1", [email]);
        const usuario = rows[0];
        if (!usuario) return res.status(401).json({ error: "Credenciais inválidas." });
        const senhaValida = await bcrypt.compare(senha, usuario.senha);
        if (!senhaValida) return res.status(401).json({ error: "Credenciais inválidas." });
        const payload = { id: usuario.id, nome: usuario.nome, cargo: usuario.cargo };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' });
        res.json({ message: "Login bem-sucedido!", token, usuario });
    } catch (err) {
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
        res.status(403).json({ error: "Acesso negado." });
    }
};

// =================================================================================================
// --- GERENCIAMENTO DE ESTOQUE E TIMEOUT EM TEMPO REAL ---
// =================================================================================================
let liveInventory = {};
const userCarts = new Map();
const CART_TIMEOUT_MS = 15 * 60 * 1000;

async function initializeInventory() {
    try {
        console.log('Inicializando o inventário em tempo real...');
        const { rows } = await db.query('SELECT slug, quantidade_estoque FROM variacoes');
        liveInventory = {};
        rows.forEach(item => {
            liveInventory[item.slug] = item.quantidade_estoque;
        });
        console.log('Inventário inicializado com sucesso.');
    } catch (error) {
        console.error('ERRO CRÍTICO ao inicializar o inventário:', error);
    }
}

function updateLiveInventoryAndBroadcast(slug, change) {
    if (liveInventory[slug] !== undefined) {
        liveInventory[slug] += change;
    }
    io.emit('estoque_atualizado', { [slug]: liveInventory[slug] });
    console.log(`Estoque de ${slug} alterado em ${change}. Novo total virtual: ${liveInventory[slug]}`);
}

// =================================================================================================
// --- LÓGICA DO SOCKET.IO ---
// =================================================================================================
io.on('connection', (socket) => {
    console.log('Um cliente se conectou:', socket.id);
    userCarts.set(socket.id, { cart: [], lastActivity: Date.now() });

    socket.emit('estado_inicial_estoque', liveInventory);

    socket.on('adicionar_item_carrinho', (item) => {
        const userSession = userCarts.get(socket.id);
        if (!userSession) return;
        
        userSession.lastActivity = Date.now();

        if (liveInventory[item.slug] >= item.quantidade) {
            updateLiveInventoryAndBroadcast(item.slug, -item.quantidade);

            const existingItem = userSession.cart.find(i => i.id === item.id);
            if(existingItem) {
                existingItem.quantidade += item.quantidade;
            } else {
                userSession.cart.push(item);
            }
            
            socket.emit('carrinho_atualizado', userSession.cart);
        } else {
            socket.emit('falha_adicionar_item', { nome: item.nome, estoque_disponivel: liveInventory[item.slug] });
        }
    });

    socket.on('remover_item_carrinho', (itemId) => {
        const userSession = userCarts.get(socket.id);
        if (!userSession) return;

        userSession.lastActivity = Date.now();
        const itemIndex = userSession.cart.findIndex(i => i.id === itemId);

        if (itemIndex > -1) {
            const item = userSession.cart[itemIndex];
            updateLiveInventoryAndBroadcast(item.slug, item.quantidade);
            userSession.cart.splice(itemIndex, 1);
            socket.emit('carrinho_atualizado', userSession.cart);
        }
    });
    
    socket.on('limpar_carrinho', () => {
        const userSession = userCarts.get(socket.id);
        if (userSession && userSession.cart) {
            for (const item of userSession.cart) {
                updateLiveInventoryAndBroadcast(item.slug, item.quantidade);
            }
            userSession.cart = [];
            socket.emit('carrinho_atualizado', userSession.cart);
        }
    });

    socket.on('disconnect', () => {
        console.log('Um cliente se desconectou:', socket.id);
        const userSession = userCarts.get(socket.id);
        if (userSession && userSession.cart) {
            for (const item of userSession.cart) {
                updateLiveInventoryAndBroadcast(item.slug, item.quantidade);
            }
            userCarts.delete(socket.id);
        }
    });
});

setInterval(() => {
    const now = Date.now();
    userCarts.forEach((session, socketId) => {
        if (now - session.lastActivity > CART_TIMEOUT_MS) {
            console.log(`Carrinho do socket ${socketId} expirou. Liberando estoque...`);
            const cart = session.cart;
            if (cart && cart.length > 0) {
                for (const item of cart) {
                    updateLiveInventoryAndBroadcast(item.slug, item.quantidade);
                }
            }
            userCarts.delete(socketId);
            io.to(socketId).emit('force_cart_reset');
        }
    });
}, 60 * 1000);

// =================================================================================================
// --- ROTAS DA API ---
// =================================================================================================
app.get('/api/loja/status', async (req, res) => {
    try {
        const { rows } = await db.query('SELECT aberta_manualmente, fechada_manualmente, horarios_json FROM configuracao_loja WHERE id = 1');
        const config = rows[0];
        
        const response = {
            status: 'fechado',
            mensagem: 'Configuração da loja não encontrada.',
            horarios: config && config.horarios_json ? JSON.parse(config.horarios_json) : {}
        };

        if (!config) return res.json(response);
        if (config.fechada_manualmente) {
            response.mensagem = 'Estamos temporariamente fechados. Voltamos em breve!';
            return res.json(response);
        }
        if (config.aberta_manualmente) {
            response.status = 'aberto';
            response.mensagem = 'Estamos abertos!';
            return res.json(response);
        }
        
        if (!config.horarios_json) {
            response.mensagem = 'Horários de funcionamento não configurados.';
            return res.json(response);
        }
        
        const horarios = JSON.parse(config.horarios_json);
        const agoraUTC = new Date();
        const agoraGoiânia = new Date(agoraUTC.getTime() - (3 * 60 * 60 * 1000));
        const diaDaSemana = agoraGoiânia.getUTCDay().toString();
        const horaAtual = agoraGoiânia.getUTCHours().toString().padStart(2, '0') + ":" + agoraGoiânia.getUTCMinutes().toString().padStart(2, '0');
        const horarioDeHoje = horarios[diaDaSemana];

        if (!horarioDeHoje || !horarioDeHoje.ativo) {
            response.mensagem = `Estamos fechados hoje.`;
            return res.json(response);
        }
        
        if (horaAtual >= horarioDeHoje.inicio && horaAtual < horarioDeHoje.fim) {
            response.status = 'aberto';
            response.mensagem = 'Estamos abertos!';
        } else {
            response.mensagem = `Nosso horário hoje é das ${horarioDeHoje.inicio} às ${horarioDeHoje.fim}.`;
        }
        res.json(response);
    } catch (err) {
        console.error('[ERRO DETALHADO] em /api/loja/status:', err);
        res.status(500).json({ error: 'Erro ao verificar status da loja.' });
    }
});
app.get('/api/dashboard/loja/configuracoes', protegerRota, async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM configuracao_loja WHERE id = 1');
        res.json(rows[0]);
    } catch (err) {
        console.error('[ERRO DETALHADO] em /api/dashboard/loja/configuracoes:', err);
        res.status(500).json({ error: 'Erro ao buscar configurações.' });
    }
});
app.put('/api/dashboard/loja/configuracoes', protegerRota, apenasAdmin, async (req, res) => {
    try {
        const { aberta_manualmente, fechada_manualmente, horarios_json } = req.body;
        await db.query('UPDATE configuracao_loja SET aberta_manualmente = $1, fechada_manualmente = $2, horarios_json = $3 WHERE id = 1', [aberta_manualmente, fechada_manualmente, JSON.stringify(horarios_json)]);
        io.emit('cardapio_alterado');
        res.json({ message: 'Configurações da loja atualizadas com sucesso!' });
    } catch (err) {
        console.error('[ERRO DETALHADO] em PUT /api/dashboard/loja/configuracoes:', err);
        res.status(500).json({ error: 'Erro ao atualizar configurações.' });
    }
});
app.post('/api/dashboard/loja/status-manual', protegerRota, async (req, res) => {
    try {
        const { aberta_manualmente, fechada_manualmente } = req.body;
        await db.query('UPDATE configuracao_loja SET aberta_manualmente = $1, fechada_manualmente = $2 WHERE id = 1', [aberta_manualmente, fechada_manualmente]);
        io.emit('cardapio_alterado');
        res.json({ message: 'Status manual da loja atualizado com sucesso!' });
    } catch (err) {
        console.error('[ERRO DETALHADO] em POST /api/dashboard/loja/status-manual:', err);
        res.status(500).json({ error: 'Erro ao atualizar status manual da loja.' });
    }
});
const getCardapioCompleto = async () => {
    const sql = `SELECT pb.id, pb.nome, pb.descricao, pb.imagem_url, pb.ordem, s.nome as setor_nome, s.id as setor_id, COALESCE((SELECT json_agg(json_build_object('id', v.id, 'nome', v.nome, 'preco', v.preco, 'slug', v.slug, 'quantidade_estoque', v.quantidade_estoque) ORDER BY v.id) FROM variacoes v WHERE v.produto_base_id = pb.id), '[]'::json) as variacoes FROM produtos_base pb LEFT JOIN setores s ON pb.setor_id = s.id ORDER BY pb.ordem, pb.nome`;
    const { rows } = await db.query(sql);
    return rows;
};
app.get('/api/cardapio', async (req, res) => {
    try { const cardapio = await getCardapioCompleto(); res.json({ data: cardapio }); } 
    catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/produtos', async (req, res) => {
    try {
        const sql = `SELECT v.id, v.slug, v.nome AS nome_variacao, v.preco, v.quantidade_estoque, pb.nome AS nome_base FROM variacoes v JOIN produtos_base pb ON v.produto_base_id = pb.id`;
        const { rows } = await db.query(sql);
        const data = rows.map(r => ({id: r.id, slug: r.slug, nome: `${r.nome_base} ${r.nome_variacao}`, preco: r.preco, quantidade_estoque: r.quantidade_estoque}));
        res.json({ data });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/dashboard/produtos', protegerRota, async (req, res) => {
    try {
        const produtos = await getCardapioCompleto();
        res.json({ data: produtos });
    } catch (err) { 
        console.error('[ERRO DETALHADO] em /api/dashboard/produtos:', err);
        res.status(500).json({ error: "Erro ao buscar produtos para o dashboard." }); 
    }
});
app.get('/setores', protegerRota, async (req, res) => {
    try {
        const { rows } = await db.query("SELECT * FROM setores ORDER BY nome");
        res.json({ data: rows });
    } catch (err) {
        console.error('[ERRO DETALHADO] em /setores:', err);
        res.status(500).json({ error: "Erro ao buscar setores." });
    }
});
app.get('/api/dashboard/combos', protegerRota, async (req, res) => {
    try {
        const sql = `SELECT c.*, COALESCE(json_agg(rc.*) FILTER (WHERE rc.id IS NOT NULL), '[]'::json) as regras FROM combos c LEFT JOIN regras_combo rc ON rc.combo_id = c.id GROUP BY c.id ORDER BY c.id;`;
        const { rows } = await db.query(sql);
        res.json({ data: rows });
    } catch (err) {
        console.error("[ERRO DETALHADO] em /api/dashboard/combos:", err);
        res.status(500).json({ error: "Erro ao buscar combos para o dashboard." });
    }
});
app.get('/api/combos', async (req, res) => {
    try {
        const sql = `SELECT c.*, COALESCE((SELECT json_agg(rc.*) FROM regras_combo rc WHERE rc.combo_id = c.id), '[]'::json) as regras FROM combos c WHERE c.ativo = true ORDER BY c.id;`;
        const { rows } = await db.query(sql);
        res.json({ data: rows });
    } catch (err) { res.status(500).json({ error: "Erro ao buscar combos." }); }
});
app.post('/produtos_base', protegerRota, apenasAdmin, upload.single('imagem'), async (req, res) => {
    try {
        const { nome, descricao, setor_id } = req.body;
        if (!req.file) return res.status(400).json({ error: "A imagem é obrigatória." });
        const imagem_url = req.file.path;
        await db.query(`INSERT INTO produtos_base (nome, descricao, setor_id, imagem_url) VALUES ($1, $2, $3, $4) RETURNING id`,[nome, descricao, setor_id, imagem_url]);
        io.emit('cardapio_alterado');
        res.status(201).send();
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/produtos_base/:id', protegerRota, apenasAdmin, upload.single('imagem'), async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, descricao, setor_id } = req.body;
        let imagem_url;
        if (req.file) { imagem_url = req.file.path; }
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
        io.emit('cardapio_alterado');
        res.json({ message: 'Produto base atualizado!' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/produtos_base/:id', protegerRota, apenasAdmin, async (req, res) => {
    try {
        await db.query(`DELETE FROM produtos_base WHERE id = $1`, [req.params.id]);
        io.emit('cardapio_alterado');
        res.json({ message: 'Produto base e suas variações foram excluídos.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/produtos_base/:id/duplicar', protegerRota, apenasAdmin, async (req, res) => {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const { rows: produtoRows } = await client.query('SELECT * FROM produtos_base WHERE id = $1', [req.params.id]);
        const produto = produtoRows[0];
        if (!produto) throw new Error("Produto base não encontrado.");
        
        const novoNome = `${produto.nome} (cópia)`;
        const { rows: newProdutoRows } = await client.query('INSERT INTO produtos_base (nome, descricao, imagem_url, setor_id) VALUES ($1, $2, $3, $4) RETURNING id', [novoNome, produto.descricao, produto.imagem_url, produto.setor_id]);
        const novoProdutoBaseId = newProdutoRows[0].id;
        const { rows: variacoes } = await client.query('SELECT * FROM variacoes WHERE produto_base_id = $1', [req.params.id]);
        for(const v of variacoes) {
            const novoSlug = `${v.slug}-copia-${Date.now()}`;
            await client.query('INSERT INTO variacoes (produto_base_id, nome, slug, preco, quantidade_estoque) VALUES ($1, $2, $3, $4, $5)', [novoProdutoBaseId, v.nome, novoSlug, v.preco, v.quantidade_estoque]);
        }
        await client.query('COMMIT');
        io.emit('cardapio_alterado');
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
        await db.query(`INSERT INTO setores (nome) VALUES ($1) RETURNING id`, [req.body.nome]);
        io.emit('cardapio_alterado');
        res.status(201).send();
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/setores/:id', protegerRota, apenasAdmin, async (req, res) => {
    try {
        await db.query(`UPDATE setores SET nome = $1 WHERE id = $2`, [req.body.nome, req.params.id]);
        io.emit('cardapio_alterado');
        res.json({ message: "Setor atualizado." });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/setores/:id', protegerRota, apenasAdmin, async (req, res) => {
    try {
        await db.query(`DELETE FROM setores WHERE id = $1`, [req.params.id]);
        io.emit('cardapio_alterado');
        res.json({ message: "Setor excluído." });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/variacoes', protegerRota, apenasAdmin, async (req, res) => {
    try {
        const { produto_base_id, nome, slug, preco } = req.body;
        await db.query(`INSERT INTO variacoes (produto_base_id, nome, slug, preco, quantidade_estoque) VALUES ($1, $2, $3, $4, 0) RETURNING id`, [produto_base_id, nome, slug, preco]);
        io.emit('cardapio_alterado');
        res.status(201).send();
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/variacoes/:id', protegerRota, apenasAdmin, async (req, res) => {
    try {
        await db.query(`DELETE FROM variacoes WHERE id = $1`, [req.params.id]);
        io.emit('cardapio_alterado');
        res.json({ message: 'Variação excluída.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/variacoes/:id/duplicar', protegerRota, apenasAdmin, async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM variacoes WHERE id = $1', [req.params.id]);
        const variacao = rows[0];
        if (!variacao) return res.status(404).json({ error: "Variação não encontrada." });
        const novoNome = `${variacao.nome} (cópia)`;
        const novoSlug = `${variacao.slug}-copia-${Date.now()}`;
        const { rows: newRows } = await db.query('INSERT INTO variacoes (produto_base_id, nome, slug, preco, quantidade_estoque) VALUES ($1, $2, $3, $4, $5) RETURNING id', [variacao.produto_base_id, novoNome, novoSlug, variacao.preco, variacao.quantidade_estoque]);
        io.emit('cardapio_alterado');
        res.json({ message: 'Variação duplicada com sucesso!', newId: newRows[0].id });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/dashboard/produtos/reordenar', protegerRota, apenasAdmin, async (req, res) => {
    const { order } = req.body;
    if (!order || !Array.isArray(order)) { return res.status(400).json({ error: "Formato de ordem inválido." }); }
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        for (let i = 0; i < order.length; i++) {
            await client.query("UPDATE produtos_base SET ordem = $1 WHERE id = $2", [i, order[i]]);
        }
        await client.query('COMMIT');
        io.emit('cardapio_alterado');
        res.json({ message: "Ordem dos produtos atualizada com sucesso!" });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Erro ao reordenar produtos:", err);
        res.status(500).json({ error: "Falha ao salvar a nova ordem." });
    } finally {
        client.release();
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
            const updateQuery = "UPDATE variacoes SET quantidade_estoque = quantidade_estoque - $1 WHERE id = $2 AND quantidade_estoque >= $1 RETURNING slug, quantidade_estoque";
            const result = await client.query(updateQuery, [item.qtd, item.id]);
            if (result.rowCount === 0) {
                throw new Error(`Estoque insuficiente para o item ID ${item.id}.`);
            }
            const { slug, quantidade_estoque } = result.rows[0];
            liveInventory[slug] = quantidade_estoque;
            io.emit('estoque_atualizado', { [slug]: liveInventory[slug] });
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
app.delete('/api/dashboard/combos/:id', protegerRota, apenasAdmin, async (req, res) => {
    try {
        await db.query('DELETE FROM combos WHERE id = $1', [req.params.id]);
        io.emit('cardapio_alterado');
        res.json({ message: 'Combo excluído com sucesso.' });
    } catch (err) { res.status(500).json({ error: 'Falha ao excluir o combo.' }); }
});

// =================================================================================================
// --- INICIALIZAÇÃO DO SERVIDOR ---
// =================================================================================================
const iniciarServidor = async () => {
    await initializeInventory();
    server.listen(PORT, () => {
        console.log(`Servidor rodando e ouvindo na porta ${PORT}`);
    });
};

iniciarServidor();