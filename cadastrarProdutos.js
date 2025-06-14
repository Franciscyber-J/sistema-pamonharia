const db = require('./database.js');
const bcrypt = require('bcryptjs');

async function criarTabelas() {
  console.log("Verificando e criando tabelas no PostgreSQL...");

  await db.query(`CREATE TABLE IF NOT EXISTS setores (id SERIAL PRIMARY KEY, nome TEXT UNIQUE NOT NULL)`);
  await db.query(`CREATE TABLE IF NOT EXISTS produtos_base (id SERIAL PRIMARY KEY, nome TEXT NOT NULL, descricao TEXT, imagem_url TEXT, setor_id INTEGER, ordem INTEGER DEFAULT 0, FOREIGN KEY (setor_id) REFERENCES setores (id) ON DELETE SET NULL)`);
  
  // ATUALIZADO: Adicionada a coluna 'controlar_estoque'
  await db.query(`
    CREATE TABLE IF NOT EXISTS variacoes (
      id SERIAL PRIMARY KEY, 
      produto_base_id INTEGER NOT NULL, 
      nome TEXT NOT NULL, 
      slug TEXT UNIQUE NOT NULL, 
      preco REAL NOT NULL, 
      quantidade_estoque INTEGER DEFAULT 0, 
      controlar_estoque BOOLEAN DEFAULT true, -- NOVA COLUNA
      FOREIGN KEY (produto_base_id) REFERENCES produtos_base (id) ON DELETE CASCADE
    )
  `);

  await db.query(`CREATE TABLE IF NOT EXISTS usuarios (id SERIAL PRIMARY KEY, nome TEXT NOT NULL, email TEXT UNIQUE NOT NULL, senha TEXT NOT NULL, cargo TEXT NOT NULL DEFAULT 'operador')`);
  await db.query(`CREATE TABLE IF NOT EXISTS combos (id SERIAL PRIMARY KEY, nome TEXT NOT NULL, descricao TEXT, preco_base REAL NOT NULL, imagem_url TEXT, ativo BOOLEAN DEFAULT true, quantidade_itens_obrigatoria INTEGER NOT NULL)`);
  await db.query(`CREATE TABLE IF NOT EXISTS regras_combo (id SERIAL PRIMARY KEY, combo_id INTEGER NOT NULL, setor_id_alvo INTEGER, produto_base_id_alvo INTEGER, upcharge REAL DEFAULT 0, FOREIGN KEY (combo_id) REFERENCES combos (id) ON DELETE CASCADE, FOREIGN KEY (setor_id_alvo) REFERENCES setores (id) ON DELETE CASCADE, FOREIGN KEY (produto_base_id_alvo) REFERENCES produtos_base (id) ON DELETE CASCADE)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS configuracao_loja (
      id INTEGER PRIMARY KEY DEFAULT 1,
      aberta_manualmente BOOLEAN DEFAULT false,
      fechada_manualmente BOOLEAN DEFAULT false, -- Coluna adicionada em deploy anterior
      horarios_json TEXT,
      CHECK (id = 1)
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
  console.log("Setores verificados/cadastrados.");

  // --- CADASTRO DOS PRODUTOS BASE ---
  const produtosBase = [
    { id: 1, nome: 'Pamonha Tradicional', desc: 'A autêntica pamonha goiana, feita com milho verde fresquinho e selecionado.', img: 'https://res.cloudinary.com/dznox4s9b/image/upload/v1718155985/pamonharia/1749597365912-pamonha-tradicional.webp', setor_id: 1 },
    { id: 2, nome: 'Pamonha à Moda', desc: 'A mais recheada de todas, com linguiça caseira, queijo e um tempero goiano especial.', img: 'https://res.cloudinary.com/dznox4s9b/image/upload/v1718155985/pamonharia/1749597423402-pamonha-%C3%A0-moda.webp', setor_id: 1 },
    { id: 3, nome: 'Bolinho de Milho', desc: 'Deliciosos bolinhos de milho fritos na hora, crocantes por fora e macios por dentro.', img: 'https://res.cloudinary.com/dznox4s9b/image/upload/v1718155985/pamonharia/1749597277233-bolinho-de-milho.webp', setor_id: 2 },
    { id: 4, nome: 'Curau Quente', desc: 'Um doce de milho quentinho e irresistível, com a textura aveludada que só o milho da roça tem.', img: 'https://res.cloudinary.com/dznox4s9b/image/upload/v1718155985/pamonharia/1749597338951-curau-quente.webp', setor_id: 3 },
    { id: 5, nome: 'Curau Gelado', desc: 'Refrescante e cremoso, o doce de milho perfeito para qualquer hora do dia.', img: 'https://res.cloudinary.com/dznox4s9b/image/upload/v1718155985/pamonharia/1749597300134-curau-gelado.webp', setor_id: 3 }
  ];

  for (const p of produtosBase) {
    await db.query(`INSERT INTO produtos_base (id, nome, descricao, imagem_url, setor_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`, [p.id, p.nome, p.desc, p.img, p.setor_id]);
  }
  console.log("Produtos base verificados/cadastrados.");
  
  // --- CADASTRO DAS VARIAÇÕES DE CADA PRODUTO ---
  const variacoes = [
    { base_id: 1, nome: 'de Doce', slug: 'doce', preco: 13.00 }, { base_id: 1, nome: 'de Sal', slug: 'sal', preco: 13.00 }, { base_id: 1, nome: 'de Sal com Pimenta', slug: 'salpimenta', preco: 13.00 },
    { base_id: 2, nome: 'Sem Pimenta (Moda 1)', slug: 'moda-sem-pimenta', preco: 15.00 }, { base_id: 2, nome: 'Com Pimenta (Moda 2)', slug: 'moda-com-pimenta', preco: 15.00 },
    { base_id: 3, nome: 'Com Queijo (sem pimenta)', slug: 'bolinhocom', preco: 4.00 }, { base_id: 3, nome: 'Sem Queijo (sem pimenta)', slug: 'bolinhosem', preco: 4.00 }, { base_id: 3, nome: 'Com Queijo e Pimenta', slug: 'bolinhopimentacom', preco: 4.50 }, { base_id: 3, nome: 'Sem Queijo e com Pimenta', slug: 'bolinhopimentasem', preco: 4.50 },
    { base_id: 4, nome: 'Com Canela', slug: 'curauquentecom', preco: 10.00 }, { base_id: 4, nome: 'Sem Canela', slug: 'curauquentesem', preco: 10.00 },
    { base_id: 5, nome: 'Com Canela', slug: 'curaugeladocom', preco: 11.00 }, { base_id: 5, nome: 'Sem Canela', slug: 'curaugeladosem', preco: 11.00 }
  ];
  for (const v of variacoes) {
    await db.query(`INSERT INTO variacoes (produto_base_id, nome, slug, preco, quantidade_estoque) VALUES ($1, $2, $3, $4, 50) ON CONFLICT (slug) DO NOTHING`,[v.base_id, v.nome, v.slug, v.preco]);
  }
  console.log("Variações verificadas/cadastradas.");

  // --- CADASTRO DOS COMBOS INICIAIS ---
  await db.query(`INSERT INTO combos (id, nome, descricao, preco_base, quantidade_itens_obrigatoria, imagem_url) VALUES (1, 'Combo 10 Pamonhas – Monte do seu jeito!', 'Economize levando 10 pamonhas! Escolha 10 unidades do nosso setor de Pamonhas e Derivados e monte o combo perfeito para você.', 119.90, 10, 'https://res.cloudinary.com/dznox4s9b/image/upload/v1718155985/pamonharia/1749601075933-combo-10-pamonhas-%C3%A2%E2%82%AC%E2%80%9D-monte-do-seu-jeito_.webp') ON CONFLICT (id) DO NOTHING`);
  await db.query(`INSERT INTO regras_combo (combo_id, setor_id_alvo) VALUES (1, 1) ON CONFLICT DO NOTHING`);
  await db.query(`INSERT INTO regras_combo (combo_id, produto_base_id_alvo, upcharge) VALUES (1, 2, 2.00) ON CONFLICT DO NOTHING`);
  await db.query(`INSERT INTO combos (id, nome, descricao, preco_base, quantidade_itens_obrigatoria, imagem_url) VALUES (2, 'Combo 10 Bolinhos – Leve mais, pague menos!', 'Aproveite nosso pacote econômico! Escolha 10 dos seus bolinhos ou salgados favoritos e pague um preço especial.', 35.99, 10, 'https://res.cloudinary.com/dznox4s9b/image/upload/v1718155985/pamonharia/1749600932645-combo-10-bolinhos-%C3%A2%E2%82%AC%E2%80%9D-leve-mais,-pague-menos_.webp') ON CONFLICT (id) DO NOTHING`);
  await db.query(`INSERT INTO regras_combo (combo_id, setor_id_alvo) VALUES (2, 2) ON CONFLICT DO NOTHING`);
  console.log("Combos iniciais verificados/cadastrados.");
  
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
      await db.query('INSERT INTO usuarios (nome, email, senha, cargo) VALUES ($1, $2, $3, $4)', [usuario.nome, usuario.email, senhaHash, usuario.cargo]);
      console.log(`Usuário ${usuario.cargo} criado com sucesso! Email: ${usuario.email}, Senha: ${usuario.senha}`);
    }
  }
  console.log("Usuários verificados/cadastrados.");
  
  // --- CADASTRO DA CONFIGURAÇÃO INICIAL DA LOJA ---
  const horariosPadrao = {
      "0": { "ativo": false, "inicio": "11:00", "fim": "22:00" }, // Domingo
      "1": { "ativo": true,  "inicio": "11:00", "fim": "22:00" }, // Segunda
      "2": { "ativo": true,  "inicio": "11:00", "fim": "22:00" }, // Terça
      "3": { "ativo": true,  "inicio": "11:00", "fim": "22:00" }, // Quarta
      "4": { "ativo": true,  "inicio": "11:00", "fim": "22:00" }, // Quinta
      "5": { "ativo": true,  "inicio": "11:00", "fim": "22:00" }, // Sexta
      "6": { "ativo": false, "inicio": "11:00", "fim": "22:00" }  // Sábado
  };

  const { rows } = await db.query("SELECT id FROM configuracao_loja WHERE id = 1");
  if(rows.length === 0) {
      await db.query(
          `INSERT INTO configuracao_loja (id, aberta_manualmente, horarios_json) VALUES (1, false, $1)`,
          [JSON.stringify(horariosPadrao)]
      );
      console.log("Configuração inicial da loja cadastrada.");
  } else {
      console.log("Configuração da loja já existe.");
  }
}

async function main() {
  try {
    await criarTabelas();
    await cadastrarDadosIniciais(); 
    console.log("\nScript finalizado com sucesso.");
  } catch (error) {
    console.error("\nERRO ao executar o script:", error);
  }
}

main();
