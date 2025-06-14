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
        origin: "*", // Em produção, restrinja para a URL do seu frontend
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
let productDetails = {};
const userCarts = new Map();
const CART_TIMEOUT_MS = 15 * 60 * 1000;

async function initializeInventory() {
    try {
        console.log('Inicializando o inventário e detalhes de produtos...');
        const { rows } = await db.query(`
            SELECT v.id, v.slug, v.quantidade_estoque, v.preco, v.controlar_estoque, pb.nome as produto_base_nome, v.nome as variacao_nome
            FROM variacoes v
            JOIN produtos_base pb ON v.produto_base_id = pb.id
        `);
        liveInventory = {};
        productDetails = {};
        rows.forEach(item => {
            liveInventory[item.slug] = item.quantidade_estoque;
            productDetails[item.slug] = {
                id: item.id,
                nome: `${item.produto_base_nome} ${item.variacao_nome}`.trim(),
                preco: item.preco,
                controlar_estoque: item.controlar_estoque
            };
        });
        console.log('Inventário e detalhes inicializados com sucesso.');
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

    socket.on('adicionar_item_carrinho', (itemRequest) => {
        const userSession = userCarts.get(socket.id);
        if (!userSession) return;
        
        userSession.lastActivity = Date.now();
        
        const details = productDetails[itemRequest.slug];
        if (!details) return;

        if (!details.controlar_estoque || liveInventory[itemRequest.slug] >= itemRequest.quantidade) {
            if (details.controlar_estoque) {
                updateLiveInventoryAndBroadcast(itemRequest.slug, -itemRequest.quantidade);
            }
            
            const existingItem = userSession.cart.find(i => i.slug === itemRequest.slug && !i.isCombo);

            if (existingItem) {
                existingItem.quantidade += itemRequest.quantidade;
            } else {
                userSession.cart.push({
                    id: `prod-${details.id}`,
                    slug: itemRequest.slug,
                    nome: details.nome,
                    preco: details.preco,
                    quantidade: itemRequest.quantidade,
                    isCombo: false
                });
            }
            socket.emit('carrinho_atualizado', userSession.cart);
        } else {
            socket.emit('falha_adicionar_item', { nome: details.nome, estoque_disponivel: liveInventory[itemRequest.slug] });
        }
    });

    socket.on('adicionar_combo_carrinho', (comboRequest) => {
        const userSession = userCarts.get(socket.id);
        if (!userSession) return;

        userSession.lastActivity = Date.now();
        const { comboDetails, subItens } = comboRequest;

        let podeAdicionarCombo = true;
        for (const subItem of subItens) {
            const details = productDetails[subItem.slug];
            if (details.controlar_estoque && liveInventory[subItem.slug] < subItem.quantidade) {
                podeAdicionarCombo = false;
                socket.emit('falha_adicionar_item', { nome: details.nome, estoque_disponivel: liveInventory[subItem.slug] });
                break;
            }
        }

        if (podeAdicionarCombo) {
            subItens.forEach(subItem => {
                if (productDetails[subItem.slug].controlar_estoque) {
                    updateLiveInventoryAndBroadcast(subItem.slug, -subItem.quantidade);
                }
            });

            userSession.cart.push({
                ...comboDetails,
                isCombo: true,
                id: `combo-${Date.now()}`
            });
            socket.emit('carrinho_atualizado', userSession.cart);
        }
    });

    socket.on('remover_item_carrinho', (itemId) => {
        const userSession = userCarts.get(socket.id);
        if (!userSession) return;

        userSession.lastActivity = Date.now();
        const itemIndex = userSession.cart.findIndex(i => i.id === itemId);

        if (itemIndex > -1) {
            const item = userSession.cart[itemIndex];
            if (item.isCombo) {
                item.subItens.forEach(subItem => {
                    if (productDetails[subItem.slug] && productDetails[subItem.slug].controlar_estoque) {
                        updateLiveInventoryAndBroadcast(subItem.slug, subItem.quantidade);
                    }
                });
            } else {
                if (productDetails[item.slug] && productDetails[item.slug].controlar_estoque) {
                    updateLiveInventoryAndBroadcast(item.slug, item.quantidade);
                }
            }
            userSession.cart.splice(itemIndex, 1);
            socket.emit('carrinho_atualizado', userSession.cart);
        }
    });
    
    socket.on('limpar_carrinho', () => {
        const userSession = userCarts.get(socket.id);
        if (userSession && userSession.cart.length > 0) {
            userSession.cart = [];
            socket.emit('carrinho_atualizado', userSession.cart);
        }
    });

    socket.on('disconnect', () => {
        console.log('Um cliente se desconectou:', socket.id);
        const userSession = userCarts.get(socket.id);
        if (userSession && userSession.cart) {
            for (const item of userSession.cart) {
                 if (item.isCombo) {
                    item.subItens.forEach(sub => {
                        if(productDetails[sub.slug] && productDetails[sub.slug].controlar_estoque) {
                            updateLiveInventoryAndBroadcast(sub.slug, sub.quantidade);
                        }
                    });
                 } else {
                    if(productDetails[item.slug] && productDetails[item.slug].controlar_estoque) {
                        updateLiveInventoryAndBroadcast(item.slug, item.quantidade);
                    }
                }
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
                    if (item.isCombo) {
                        item.subItens.forEach(sub => {
                            if (productDetails[sub.slug] && productDetails[sub.slug].controlar_estoque) {
                                updateLiveInventoryAndBroadcast(sub.slug, sub.quantidade);
                            }
                        });
                    } else {
                        if (productDetails[item.slug] && productDetails[item.slug].controlar_estoque) {
                            updateLiveInventoryAndBroadcast(item.slug, item.quantidade);
                        }
                    }
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
    const sql = `SELECT pb.id, pb.nome, pb.descricao, pb.imagem_url, pb.ordem, s.nome as setor_nome, s.id as setor_id, COALESCE((SELECT json_agg(json_build_object('id', v.id, 'nome', v.nome, 'preco', v.preco, 'slug', v.slug, 'quantidade_estoque', v.quantidade_estoque, 'controlar_estoque', v.controlar_estoque) ORDER BY v.id) FROM variacoes v WHERE v.produto_base_id = pb.id), '[]'::json) as variacoes FROM produtos_base pb LEFT JOIN setores s ON pb.setor_id = s.id ORDER BY pb.ordem, pb.nome`;
    const { rows } = await db.query(sql);
    return rows;
};

app.get('/api/cardapio', async (req, res) => {
    try { const cardapio = await getCardapioCompleto(); res.json({ data: cardapio }); } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/produtos', async (req, res) => {
    try {
        const sql = `SELECT v.id, v.slug, v.nome AS nome_variacao, v.preco, v.quantidade_estoque, pb.nome AS nome_base, v.controlar_estoque FROM variacoes v JOIN produtos_base pb ON v.produto_base_id = pb.id`;
        const { rows } = await db.query(sql);
        const data = rows.map(r => ({id: r.id, slug: r.slug, nome: `${r.nome_base} ${r.nome_variacao}`, preco: r.preco, quantidade_estoque: r.quantidade_estoque, controlar_estoque: r.controlar_estoque}));
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
        const combosResult = await db.query('SELECT * FROM combos ORDER BY id');
        const combos = combosResult.rows;

        const regrasResult = await db.query('SELECT * FROM regras_combo');
        const todasAsRegras = regrasResult.rows;

        const combosComRegras = combos.map(combo => {
            return {
                ...combo,
                regras: todasAsRegras.filter(regra => regra.combo_id === combo.id)
            };
        });

        res.json({ data: combosComRegras });
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
            await client.query('INSERT INTO variacoes (produto_base_id, nome, slug, preco, quantidade_estoque, controlar_estoque) VALUES ($1, $2, $3, $4, $5, $6)', [novoProdutoBaseId, v.nome, novoSlug, v.preco, v.quantidade_estoque, v.controlar_estoque]);
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

app.post('/variacao/estoque', protegerRota, async (req, res) => {
    try {
        const { id, quantidade } = req.body;

        if (quantidade < 0) {
            return res.status(400).json({ error: "Quantidade não pode ser negativa." });
        }
        
        const { rows } = await db.query(
            `UPDATE variacoes SET quantidade_estoque = $1 WHERE id = $2 RETURNING slug`, 
            [quantidade, id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: "Variação não encontrada." });
        }

        const slug = rows[0].slug;
        
        if (liveInventory[slug] !== undefined) {
            liveInventory[slug] = parseInt(quantidade);
        }

        io.emit('estoque_atualizado', { [slug]: liveInventory[slug] });
        
        res.json({ message: `Estoque da variação ${slug} atualizado.` });
    } catch (err) {
        console.error('[ERRO DETALHADO] em /variacao/estoque:', err);
        res.status(500).json({ "error": err.message });
    }
});

app.post('/variacoes', protegerRota, apenasAdmin, async (req, res) => {
    try {
        const { produto_base_id, nome, slug, preco } = req.body;
        await db.query(`INSERT INTO variacoes (produto_base_id, nome, slug, preco, quantidade_estoque, controlar_estoque) VALUES ($1, $2, $3, $4, 0, true) RETURNING id`, [produto_base_id, nome, slug, preco]);
        await initializeInventory();
        io.emit('cardapio_alterado');
        res.status(201).send();
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/variacoes/:id', protegerRota, apenasAdmin, async (req, res) => {
    try {
        const { nome, slug, preco } = req.body;
        await db.query(`UPDATE variacoes SET nome = $1, slug = $2, preco = $3 WHERE id = $4`, [nome, slug, preco, req.params.id]);
        await initializeInventory();
        io.emit('cardapio_alterado');
        res.json({ message: 'Variação atualizada!' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// *** MUDANÇA: Middleware 'apenasAdmin' removido para permitir que operadores acessem ***
app.put('/api/dashboard/variacoes/:id/toggle-stock', protegerRota, async (req, res) => {
    try {
        const { id } = req.params;
        const { controlar_estoque } = req.body;
        await db.query(`UPDATE variacoes SET controlar_estoque = $1 WHERE id = $2`, [controlar_estoque, id]);
        await initializeInventory();
        io.emit('cardapio_alterado'); 
        res.json({ message: 'Controle de estoque atualizado.' });
    } catch(err) {
        res.status(500).json({ error: 'Falha ao atualizar controle de estoque.' });
    }
});

app.delete('/variacoes/:id', protegerRota, apenasAdmin, async (req, res) => {
    try {
        await db.query(`DELETE FROM variacoes WHERE id = $1`, [req.params.id]);
        await initializeInventory();
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
        await db.query('INSERT INTO variacoes (produto_base_id, nome, slug, preco, quantidade_estoque, controlar_estoque) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id', [variacao.produto_base_id, novoNome, novoSlug, variacao.preco, variacao.quantidade_estoque, variacao.controlar_estoque]);
        await initializeInventory();
        io.emit('cardapio_alterado');
        res.json({ message: 'Variação duplicada com sucesso!'});
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

app.post('/pedido', async (req, res) => {
    const { itens } = req.body;
    if (!itens || !Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({ error: 'Formato de itens inválido.' });
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        const itensComProblema = [];
        for (const item of itens) {
            const stockCheck = await client.query("SELECT quantidade_estoque, controlar_estoque FROM variacoes WHERE id = $1 FOR UPDATE", [item.id]);
            if (stockCheck.rows.length === 0) continue; 

            const { quantidade_estoque, controlar_estoque } = stockCheck.rows[0];
            if (controlar_estoque && quantidade_estoque < item.quantidade) {
                const details = productDetails[item.slug] || { nome: `Item com ID ${item.id}` };
                itensComProblema.push(details.nome);
            }
        }

        if (itensComProblema.length > 0) {
            await client.query('ROLLBACK');
            const erroMsg = `Estoque insuficiente para: ${itensComProblema.join(', ')}. Por favor, ajuste seu carrinho.`;
            return res.status(409).json({ error: erroMsg }); 
        }
        
        const updates = [];
        for (const item of itens) {
            const variacaoDetails = Object.values(productDetails).find(p => p.id === item.id);
            if (variacaoDetails && variacaoDetails.controlar_estoque) {
                const updateQuery = "UPDATE variacoes SET quantidade_estoque = quantidade_estoque - $1 WHERE id = $2 RETURNING slug, quantidade_estoque";
                const result = await client.query(updateQuery, [item.quantidade, item.id]);
                updates.push(result.rows[0]);
            }
        }

        await client.query('COMMIT');
        
        const stockUpdates = {};
        updates.forEach(upd => {
            liveInventory[upd.slug] = upd.quantidade_estoque;
            stockUpdates[upd.slug] = upd.quantidade_estoque;
        });
        io.emit('estoque_atualizado', stockUpdates);
        
        res.json({ message: "Pedido processado e estoque deduzido com sucesso." });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Erro na transação de pedido, rollback executado:", err);
        res.status(500).json({ error: err.message || "Erro interno ao processar o pedido." });
    } finally {
        client.release();
    }
});
app.post('/api/dashboard/combos', protegerRota, apenasAdmin, upload.single('imagem'), async (req, res) => {
    if (!req.body.dados) return res.status(400).json({ error: "Dados do combo ausentes." });
    const { nome, descricao, preco_base, quantidade_itens_obrigatoria, ativo, regras } = JSON.parse(req.body.dados);
    if (!req.file) return res.status(400).json({ error: "A imagem para o combo é obrigatória." });
    const imagem_url = req.file.path;
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const comboSql = `INSERT INTO combos (nome, descricao, preco_base, quantidade_itens_obrigatoria, ativo, imagem_url) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id;`;
        const comboResult = await client.query(comboSql, [nome, descricao, parseFloat(preco_base), parseInt(quantidade_itens_obrigatoria), ativo, imagem_url]);
        const comboId = comboResult.rows[0].id;
        if (regras && regras.length > 0) {
            for (const regra of regras) {
                const regraSql = `INSERT INTO regras_combo (combo_id, setor_id_alvo, produto_base_id_alvo, upcharge) VALUES ($1, $2, $3, $4);`;
                await client.query(regraSql, [comboId, regra.setor_id_alvo || null, regra.produto_base_id_alvo || null, parseFloat(regra.upcharge) || 0]);
            }
        }
        await client.query('COMMIT');
        io.emit('cardapio_alterado');
        res.status(201).json({ id: comboId, message: 'Combo criado com sucesso!' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Erro ao criar combo:", err);
        res.status(500).json({ error: "Falha ao criar o combo." });
    } finally {
        client.release();
    }
});
app.put('/api/dashboard/combos/:id', protegerRota, apenasAdmin, upload.single('imagem'), async (req, res) => {
    const { id } = req.params;
    if (!req.body.dados) return res.status(400).json({ error: "Dados do combo ausentes." });
    const { nome, descricao, preco_base, quantidade_itens_obrigatoria, ativo, regras } = JSON.parse(req.body.dados);
    let imagem_url;
    if (req.file) { imagem_url = req.file.path; }
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        let comboSql = 'UPDATE combos SET nome = $1, descricao = $2, preco_base = $3, quantidade_itens_obrigatoria = $4, ativo = $5';
        const params = [nome, descricao, parseFloat(preco_base), parseInt(quantidade_itens_obrigatoria), ativo];
        let paramCount = 6;
        if (imagem_url) {
            comboSql += `, imagem_url = $${paramCount++}`;
            params.push(imagem_url);
        }
        comboSql += ` WHERE id = $${paramCount}`;
        params.push(id);
        await client.query(comboSql, params);
        await client.query('DELETE FROM regras_combo WHERE combo_id = $1', [id]);
        if (regras && regras.length > 0) {
            for (const regra of regras) {
                const regraSql = `INSERT INTO regras_combo (combo_id, setor_id_alvo, produto_base_id_alvo, upcharge) VALUES ($1, $2, $3, $4);`;
                await client.query(regraSql, [id, regra.setor_id_alvo || null, regra.produto_base_id_alvo || null, parseFloat(regra.upcharge) || 0]);
            }
        }
        await client.query('COMMIT');
        io.emit('cardapio_alterado');
        res.json({ message: 'Combo atualizado com sucesso!' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Erro ao atualizar combo ${id}:`, err);
        res.status(500).json({ error: "Falha ao atualizar o combo." });
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
