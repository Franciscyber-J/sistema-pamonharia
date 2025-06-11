// Arquivo: cadastrarProdutos.js
const db = require('./database.js');
const bcrypt = require('bcryptjs');

console.log('Iniciando script de cadastro sequencial...');

db.serialize(() => {
    // --- CADASTRO DOS SETORES ---
    db.run(`INSERT OR IGNORE INTO setores (id, nome) VALUES (1, 'Pamonhas e Derivados')`);
    db.run(`INSERT OR IGNORE INTO setores (id, nome) VALUES (2, 'Bolinhos e Salgados')`);
    db.run(`INSERT OR IGNORE INTO setores (id, nome) VALUES (3, 'Doces e Cremes')`);

    // --- CADASTRO DOS PRODUTOS BASE ---
    const produtosBase = [
        { id: 1, nome: 'Pamonha Tradicional', desc: 'A autêntica pamonha goiana, feita com milho verde fresquinho e selecionado.', img: '/images/pamonha.jpg', setor_id: 1 },
        { id: 2, nome: 'Pamonha à Moda', desc: 'A mais recheada de todas, com linguiça caseira, queijo e um tempero goiano especial.', img: '/images/pamonha-moda.jpg', setor_id: 1 },
        { id: 3, nome: 'Bolinho de Milho', desc: 'Deliciosos bolinhos de milho fritos na hora, crocantes por fora e macios por dentro.', img: '/images/bolinho.jpg', setor_id: 2 },
        { id: 4, nome: 'Curau Quente', desc: 'Um doce de milho quentinho e irresistível, com a textura aveludada que só o milho da roça tem.', img: '/images/curau-quente.jpg', setor_id: 3 },
        { id: 5, nome: 'Curau Gelado', desc: 'Refrescante e cremoso, o doce de milho perfeito para qualquer hora do dia.', img: '/images/curau-gelado.jpg', setor_id: 3 }
    ];

    const stmtBase = db.prepare("INSERT OR IGNORE INTO produtos_base (id, nome, descricao, imagem_url, setor_id) VALUES (?, ?, ?, ?, ?)");
    produtosBase.forEach(p => stmtBase.run(p.id, p.nome, p.desc, p.img, p.setor_id));
    stmtBase.finalize();

    // --- CADASTRO DAS VARIAÇÕES DE CADA PRODUTO ---
    const variacoes = [
        { base_id: 1, nome: 'de Doce', slug: 'doce', preco: 13.00 }, { base_id: 1, nome: 'de Sal', slug: 'sal', preco: 13.00 }, { base_id: 1, nome: 'de Sal com Pimenta', slug: 'salpimenta', preco: 13.00 },
        { base_id: 2, nome: 'Sem Pimenta (Moda 1)', slug: 'moda-sem-pimenta', preco: 15.00 }, { base_id: 2, nome: 'Com Pimenta (Moda 2)', slug: 'moda-com-pimenta', preco: 15.00 },
        { base_id: 3, nome: 'Com Queijo (sem pimenta)', slug: 'bolinhocom', preco: 4.00 }, { base_id: 3, nome: 'Sem Queijo (sem pimenta)', slug: 'bolinhosem', preco: 4.00 }, { base_id: 3, nome: 'Com Queijo e Pimenta', slug: 'bolinhopimentacom', preco: 4.50 }, { base_id: 3, nome: 'Sem Queijo e com Pimenta', slug: 'bolinhopimentasem', preco: 4.50 },
        { base_id: 4, nome: 'Com Canela', slug: 'curauquentecom', preco: 10.00 }, { base_id: 4, nome: 'Sem Canela', slug: 'curauquentesem', preco: 10.00 },
        { base_id: 5, nome: 'Com Canela', slug: 'curaugeladocom', preco: 11.00 }, { base_id: 5, nome: 'Sem Canela', slug: 'curaugeladosem', preco: 11.00 }
    ];

    const stmtVar = db.prepare("INSERT OR IGNORE INTO variacoes (produto_base_id, nome, slug, preco, quantidade_estoque) VALUES (?, ?, ?, ?, 50)");
    variacoes.forEach(v => stmtVar.run(v.base_id, v.nome, v.slug, v.preco));
    stmtVar.finalize((err) => {
        if (err) {
            console.error("Erro ao finalizar inserção de variações:", err.message);
            return;
        }
        // A lógica de criação de usuários só começa DEPOIS que a de variações terminou.
        cadastrarUsuarios();
    });
});

function cadastrarUsuarios() {
    const salt = bcrypt.genSaltSync(10);
    const usuarios = [
        { nome: 'Administrador', email: 'admin@pamonharia.com', senha: 'admin123', cargo: 'admin' },
        { nome: 'Operador de Caixa', email: 'operador@pamonharia.com', senha: 'operador123', cargo: 'operador' }
    ];
    
    let usuarioIndex = 0;

    // Esta função processa um usuário de cada vez para evitar erros de concorrência.
    function processarProximoUsuario() {
        if (usuarioIndex >= usuarios.length) {
            // Se todos os usuários foram processados, fecha a conexão.
            console.log("\nProcessamento de usuários concluído.");
            db.close((err) => {
                if (err) return console.error("Erro ao fechar o banco:", err.message);
                console.log("Script finalizado. Conexão com o banco de dados fechada.");
            });
            return;
        }

        const usuario = usuarios[usuarioIndex];
        usuarioIndex++;

        db.get('SELECT id FROM usuarios WHERE email = ?', [usuario.email], (err, row) => {
            if (err) {
                console.error(`Erro ao verificar usuário ${usuario.email}:`, err);
                processarProximoUsuario(); // Tenta o próximo mesmo em caso de erro.
                return;
            }
            
            if (!row) {
                const senhaHash = bcrypt.hashSync(usuario.senha, salt);
                db.run(
                    'INSERT INTO usuarios (nome, email, senha, cargo) VALUES (?, ?, ?, ?)',
                    [usuario.nome, usuario.email, senhaHash, usuario.cargo],
                    (err) => {
                        if (err) {
                            console.error(`Erro ao inserir usuário ${usuario.email}:`, err);
                        } else {
                            console.log(`\nUsuário ${usuario.cargo} criado com sucesso!`);
                            console.log(`   Email: ${usuario.email}`);
                            console.log(`   Senha: ${usuario.senha}`);
                        }
                        processarProximoUsuario(); // Chama a função para o próximo usuário.
                    }
                );
            } else {
                console.log(`\nUsuário com email ${usuario.email} já existe. Nenhuma ação foi necessária.`);
                processarProximoUsuario(); // Chama a função para o próximo usuário.
            }
        });
    }

    // Inicia o processo
    processarProximoUsuario();
}