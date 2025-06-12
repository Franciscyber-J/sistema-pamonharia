const db = require('./database.js');
const bcrypt = require('bcryptjs');

async function criarTabelas() {
  console.log("Verificando e criando tabelas no PostgreSQL...");

  await db.query(`
    CREATE TABLE IF NOT EXISTS setores (
        id SERIAL PRIMARY KEY,
        nome TEXT UNIQUE NOT NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS produtos_base (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        descricao TEXT,
        imagem_url TEXT,
        setor_id INTEGER,
        ordem INTEGER DEFAULT 0,
        FOREIGN KEY (setor_id) REFERENCES setores (id) ON DELETE SET NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS variacoes (
        id SERIAL PRIMARY KEY,
        produto_base_id INTEGER NOT NULL,
        nome TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        preco REAL NOT NULL,
        quantidade_estoque INTEGER DEFAULT 0,
        FOREIGN KEY (produto_base_id) REFERENCES produtos_base (id) ON DELETE CASCADE
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        senha TEXT NOT NULL,
        cargo TEXT NOT NULL DEFAULT 'operador'
    )
  `);

  console.log("Estrutura de tabelas garantida.");
}

async function cadastrarDadosIniciais() {
  console.log("Iniciando cadastro de dados iniciais...");

  // --- CADASTRO DOS SETORES ---
  await db.query(`INSERT INTO setores (id, nome) VALUES (1, 'Pamonhas e Derivados') ON CONFLICT (id) DO NOTHING`);
  await db.query(`INSERT INTO setores (id, nome) VALUES (2, 'Bolinhos e Salgados') ON CONFLICT (id) DO NOTHING`);
  await db.query(`INSERT INTO setores (id, nome) VALUES (3, 'Doces e Cremes') ON CONFLICT (id) DO NOTHING`);
  console.log("Setores cadastrados.");

  // --- CADASTRO DOS PRODUTOS BASE ---
  const produtosBase = [
    { id: 1, nome: 'Pamonha Tradicional', desc: 'A autêntica pamonha goiana, feita com milho verde fresquinho e selecionado.', img: '/images/pamonha.jpg', setor_id: 1 },
    { id: 2, nome: 'Pamonha à Moda', desc: 'A mais recheada de todas, com linguiça caseira, queijo e um tempero goiano especial.', img: '/images/pamonha-moda.jpg', setor_id: 1 },
    { id: 3, nome: 'Bolinho de Milho', desc: 'Deliciosos bolinhos de milho fritos na hora, crocantes por fora e macios por dentro.', img: '/images/bolinho.jpg', setor_id: 2 },
    { id: 4, nome: 'Curau Quente', desc: 'Um doce de milho quentinho e irresistível, com a textura aveludada que só o milho da roça tem.', img: '/images/curau-quente.jpg', setor_id: 3 },
    { id: 5, nome: 'Curau Gelado', desc: 'Refrescante e cremoso, o doce de milho perfeito para qualquer hora do dia.', img: '/images/curau-gelado.jpg', setor_id: 3 }
  ];

  for (const p of produtosBase) {
    await db.query(`INSERT INTO produtos_base (id, nome, descricao, imagem_url, setor_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`, 
    [p.id, p.nome, p.desc, p.img, p.setor_id]);
  }
  console.log("Produtos base cadastrados.");

  // --- CADASTRO DAS VARIAÇÕES DE CADA PRODUTO ---
  const variacoes = [
    { base_id: 1, nome: 'de Doce', slug: 'doce', preco: 13.00 }, { base_id: 1, nome: 'de Sal', slug: 'sal', preco: 13.00 }, { base_id: 1, nome: 'de Sal com Pimenta', slug: 'salpimenta', preco: 13.00 },
    { base_id: 2, nome: 'Sem Pimenta (Moda 1)', slug: 'moda-sem-pimenta', preco: 15.00 }, { base_id: 2, nome: 'Com Pimenta (Moda 2)', slug: 'moda-com-pimenta', preco: 15.00 },
    { base_id: 3, nome: 'Com Queijo (sem pimenta)', slug: 'bolinhocom', preco: 4.00 }, { base_id: 3, nome: 'Sem Queijo (sem pimenta)', slug: 'bolinhosem', preco: 4.00 }, { base_id: 3, nome: 'Com Queijo e Pimenta', slug: 'bolinhopimentacom', preco: 4.50 }, { base_id: 3, nome: 'Sem Queijo e com Pimenta', slug: 'bolinhopimentasem', preco: 4.50 },
    { base_id: 4, nome: 'Com Canela', slug: 'curauquentecom', preco: 10.00 }, { base_id: 4, nome: 'Sem Canela', slug: 'curauquentesem', preco: 10.00 },
    { base_id: 5, nome: 'Com Canela', slug: 'curaugeladocom', preco: 11.00 }, { base_id: 5, nome: 'Sem Canela', slug: 'curaugeladosem', preco: 11.00 }
  ];

  for (const v of variacoes) {
    await db.query(`INSERT INTO variacoes (produto_base_id, nome, slug, preco, quantidade_estoque) VALUES ($1, $2, $3, $4, 50) ON CONFLICT (slug) DO NOTHING`,
    [v.base_id, v.nome, v.slug, v.preco]);
  }
  console.log("Variações cadastradas.");

  // --- CADASTRO DOS USUÁRIOS ---
  const salt = bcrypt.genSaltSync(10);
  const usuarios = [
    { nome: 'Administrador', email: 'admin@pamonharia.com', senha: 'admin123', cargo: 'admin' },
    { nome: 'Operador de Caixa', email: 'operador@pamonharia.com', senha: 'operador123', cargo: 'operador' }
  ];

  for (const usuario of usuarios) {
    const { rows } = await db.query('SELECT id FROM usuarios WHERE email = $1', [usuario.email]);
    if (rows.length === 0) {
      const senhaHash = bcrypt.hashSync(usuario.senha, salt);
      await db.query('INSERT INTO usuarios (nome, email, senha, cargo) VALUES ($1, $2, $3, $4)',
      [usuario.nome, usuario.email, senhaHash, usuario.cargo]);
      console.log(`Usuário ${usuario.cargo} criado com sucesso! Email: ${usuario.email}, Senha: ${usuario.senha}`);
    } else {
      console.log(`Usuário com email ${usuario.email} já existe.`);
    }
  }
}

async function main() {
  try {
    await criarTabelas();
    await cadastrarDadosIniciais();
    console.log("\nScript finalizado com sucesso.");
  } catch (error) {
    console.error("\nERRO ao executar o script:", error);
  } finally {
    // A biblioteca 'pg' gerencia o pool de conexões, então não precisamos fechar manualmente aqui.
  }
}

main();