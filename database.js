// Arquivo: database.js
const sqlite3 = require('sqlite3').verbose();
const dbPath = process.env.DATABASE_PATH || './pamonharia.db';
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    console.log("Conectado ao banco de dados para verificação de tabelas.");

    // Tabela para os setores/categorias (será ignorada se já existir)
    db.run(`
        CREATE TABLE IF NOT EXISTS setores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT UNIQUE NOT NULL
        )
    `);

    // Tabela para o produto "pai" (será ignorada se já existir)
    db.run(`
        CREATE TABLE IF NOT EXISTS produtos_base (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            descricao TEXT,
            imagem_url TEXT,
            setor_id INTEGER,
            ordem INTEGER DEFAULT 0,
            FOREIGN KEY (setor_id) REFERENCES setores (id)
        )
    `);

    // Tabela para as variações (será ignorada se já existir)
    db.run(`
        CREATE TABLE IF NOT EXISTS variacoes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            produto_base_id INTEGER NOT NULL,
            nome TEXT NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            preco REAL NOT NULL,
            quantidade_estoque INTEGER DEFAULT 0,
            FOREIGN KEY (produto_base_id) REFERENCES produtos_base (id) ON DELETE CASCADE
        )
    `);

    // ADICIONADO: Tabela para os usuários do sistema (será criada se não existir)
    db.run(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            senha TEXT NOT NULL,
            cargo TEXT NOT NULL DEFAULT 'operador' -- pode ser 'admin' ou 'operador'
        )
    `);

    // Migração da coluna 'ordem' (será ignorada se a coluna já existir)
    db.all("PRAGMA table_info(produtos_base)", (err, columns) => {
        if (err) {
            console.error("Erro ao verificar a estrutura da tabela 'produtos_base':", err);
            return;
        }
        if (columns.findIndex(c => c.name === 'ordem') === -1) {
            console.log("Aplicando migração: adicionando coluna 'ordem'...");
            db.run("ALTER TABLE produtos_base ADD COLUMN ordem INTEGER DEFAULT 0");
        }
    });

    console.log("Estrutura de tabelas garantida. Nenhuma tabela existente foi modificada.");
});

module.exports = db;