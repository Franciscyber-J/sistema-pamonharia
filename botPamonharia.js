// =================================================================================================
// --- DEPENDÊNCIAS E CONFIGURAÇÃO INICIAL ---
// =================================================================================================
require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const axios = require('axios');
const qrcode = require('qrcode-terminal');

// =================================================================================================
// --- CONFIGURAÇÕES ---
// =================================================================================================

function log(level, context, message) {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    console.log(`[${timestamp}] [${level}] [${context}] ${message}`);
}

const CONFIG = {
    CARDAPIO_URL: 'https://pamonhariasaborosa.expertbr.com/cardapio',
    API_URL: process.env.BACKEND_URL || 'http://localhost:10000',
    ATENDENTE_CONTATO: '5562992819889' // ATENÇÃO: Coloque seu número de teste aqui por enquanto
};

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "bot-pamonharia-concierge",
        dataPath: process.env.WWJS_SESSION_PATH || './sessions'
    }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

const chatStates = new Map();

// =================================================================================================
// --- LÓGICA PRINCIPAL DO BOT ---
// =================================================================================================

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
    log('INFO', 'QRCode', 'QR Code gerado. Por favor, escaneie.');
});

client.on('ready', () => {
    log('SUCCESS', 'Client', 'Bot Concierge da Pamonharia está online!');
});

client.on('message_create', async msg => {
    const chat = await msg.getChat();
    if (chat.isGroup || msg.fromMe) {
        return;
    }

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

async function enviarMenuPrincipal(chat, triggerMessage = '') {
    try {
        log('INFO', 'Handler', `Processando mensagem para ${chat.id._serialized}. Gatilho: "${triggerMessage}"`);

        const { data: statusLoja } = await axios.get(`${CONFIG.API_URL}/api/loja/status`);
        
        const lojaAberta = statusLoja.status === 'aberto';
        let saudacao = 'Olá! Bem-vindo(a) à *Pamonharia Saborosa do Goiás*! 🌽\n\n';
        
        let mensagemPrincipal;
        if (lojaAberta) {
            mensagemPrincipal = `Estamos abertos! Para ver nosso cardápio completo com estoque em tempo real e montar seu pedido, clique no link abaixo:\n\n*${CONFIG.CARDAPIO_URL}*`;
        } else {
            mensagemPrincipal = `No momento estamos fechados. ${statusLoja.mensagem}\n\nMas você já pode conferir nosso cardápio para quando voltarmos! Clique no link abaixo:\n\n*${CONFIG.CARDAPIO_URL}*`;
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
        await chat.sendMessage('Ops! Parece que estou com um problema para me conectar ao nosso sistema. Por favor, aguarde um momento e tente novamente.');
    }
}

// =================================================================================================
// --- INICIALIZAÇÃO DO CLIENTE ---
// =================================================================================================
client.initialize().catch(err => {
    log("FATAL", "Initialize", `Falha ao inicializar o cliente: ${err}`);
});