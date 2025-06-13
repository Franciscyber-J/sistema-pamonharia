// =================================================================================================
// --- DEPENDÊNCIAS E CONFIGURAÇÃO INICIAL ---
// =================================================================================================
require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const axios = require('axios');
const qrcode = require('qrcode');

// =================================================================================================
// --- CONFIGURAÇÕES E ESTADO GLOBAL ---
// =================================================================================================

function log(level, context, message) {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    console.log(`[${timestamp}] [${level}] [${context}] ${message}`);
}

const CONFIG = {
    CARDAPIO_URL: 'https://pamonhariasaborosa.expertbr.com/cardapio',
    API_URL: process.env.BACKEND_URL || 'http://localhost:10000',
    ATENDENTE_CONTATO: '5562992819889'
};

// NOVO: Cache para o status da loja. Começa como fechado por padrão.
let statusLojaCache = {
    status: 'fechado',
    mensagem: 'Verificando status da loja, um momento...'
};

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "bot-pamonharia-concierge",
        dataPath: process.env.WWJS_SESSION_PATH || './sessions'
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ],
    }
});

const chatStates = new Map();

// =================================================================================================
// --- LÓGICA PRINCIPAL DO BOT ---
// =================================================================================================

// NOVO: Função para atualizar o status da loja em segundo plano
async function atualizarStatusLojaPeriodicamente() {
    try {
        log('INFO', 'StatusCheck', 'Verificando status da loja na API...');
        const { data } = await axios.get(`${CONFIG.API_URL}/api/loja/status`, { timeout: 15000 });
        statusLojaCache = data;
        log('INFO', 'StatusCheck', `Status atualizado: ${data.status}`);
    } catch (error) {
        log('ERROR', 'StatusCheck', `Falha ao buscar status da loja: ${error.message}`);
        // Em caso de falha, mantém o último status conhecido ou assume como fechado
        statusLojaCache.mensagem = "Estamos com problemas para verificar nosso horário. Por favor, tente novamente em instantes.";
    }
}

client.on('qr', qr => {
    log('INFO', 'QRCode', 'QR Code recebido. Convertendo para texto...');
    qrcode.toString(qr, { type: 'terminal', small: true }, (err, url) => {
        if (err) return console.error(err);
        console.log(url);
        log('INFO', 'QRCode', 'Escaneie o código acima com o seu WhatsApp.');
    });
});

client.on('ready', () => {
    log('SUCCESS', 'Client', 'Bot Concierge da Pamonharia está online!');
    // NOVO: Inicia a verificação periódica assim que o bot fica pronto.
    atualizarStatusLojaPeriodicamente(); // Faz a primeira verificação imediatamente
    setInterval(atualizarStatusLojaPeriodicamente, 60 * 1000); // E depois a cada 60 segundos
});

client.on('message_create', async msg => {
    const chat = await msg.getChat();
    if (chat.isGroup || msg.fromMe) return;

    const lowerBody = msg.body?.trim().toLowerCase() ?? '';
    const chatId = msg.from;
    
    if (chatStates.get(chatId) === 'HUMANO_ATIVO') {
        if (lowerBody === 'menu' || lowerBody === 'voltar') {
            chatStates.delete(chatId);
            log('INFO', 'Handover', `Bot reativado para o chat ${chatId}.`);
            await msg.reply('Ok, o atendimento automático foi reativado! 👋');
            await enviarMenuPrincipal(chat);
        }
        return;
    }

    await enviarMenuPrincipal(chat, lowerBody);
});

// ATUALIZADO: Esta função agora é instantânea, pois usa o cache.
async function enviarMenuPrincipal(chat, triggerMessage = '') {
    try {
        log('INFO', 'Handler', `Processando mensagem para ${chat.id._serialized}. Usando status em cache: ${statusLojaCache.status}`);
        
        // USA O CACHE, NÃO FAZ MAIS CHAMADA DE API AQUI
        const lojaAberta = statusLojaCache.status === 'aberto';
        let saudacao = 'Olá! Bem-vindo(a) à *Pamonharia Saborosa do Goiás*! 🌽\n\n';
        
        let mensagemPrincipal;
        if (lojaAberta) {
            mensagemPrincipal = `Estamos abertos! Para ver nosso cardápio completo com estoque em tempo real e montar seu pedido, clique no link abaixo:\n\n*${CONFIG.CARDAPIO_URL}*`;
        } else {
            mensagemPrincipal = `No momento estamos fechados. ${statusLojaCache.mensagem}\n\nMas você já pode conferir nosso cardápio para quando voltarmos! Clique no link abaixo:\n\n*${CONFIG.CARDAPIO_URL}*`;
        }

        const respostasRapidas = {
            'endereco': `Nosso endereço para retirada é:\n*Rua Tulipas, Quadra 01, Lote 06, C-02, Jardim Mondale*\n\nVocê pode ver no mapa aqui: https://maps.app.goo.gl/eseCGMFiB857R4BP9`,
            'horario': `Nossos horários de funcionamento estão sempre atualizados em nosso cardápio online. Confira no link acima!`,
            'atendente': `Ok, estou transferindo seu atendimento. Em instantes um de nossos atendentes irá te responder por aqui.`,
        };
        
        let respostaFinal = `${saudacao}${mensagemPrincipal}\n\n--------------------\nOu, se preferir, digite o número de uma das opções:\n*1.* Saber nosso endereço\n*2.* Saber nosso horário\n*3.* Falar com um atendente`;

        if (triggerMessage === '1' || triggerMessage.includes('endere')) {
            respostaFinal = respostasRapidas.endereco;
        } else if (triggerMessage === '2' || triggerMessage.includes('horario')) {
            respostaFinal = respostasRapidas.horario;
        } else if (triggerMessage === '3' || triggerMessage.includes('atendente') || triggerMessage.includes('falar')) {
            respostaFinal = respostasRapidas.atendente;
            chatStates.set(chat.id._serialized, 'HUMANO_ATIVO');
            log('INFO', 'Handover', `Transferindo chat ${chat.id._serialized} para atendimento humano.`);
        }

        await chat.sendMessage(respostaFinal);

    } catch (error) {
        log('ERROR', 'Handler', `Falha ao processar mensagem para ${chat.id._serialized}: ${error.message}`);
    }
}

// =================================================================================================
// --- INICIALIZAÇÃO DO CLIENTE ---
// =================================================================================================
client.initialize().catch(err => {
    console.error('[ERRO FATAL NA INICIALIZAÇÃO]', err);
    log("FATAL", "Initialize", `Falha ao inicializar o cliente. Verifique o erro detalhado acima.`);
});