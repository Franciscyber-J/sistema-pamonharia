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

async function atualizarStatusLojaPeriodicamente() {
    try {
        log('INFO', 'StatusCheck', 'Verificando status da loja na API...');
        const { data } = await axios.get(`${CONFIG.API_URL}/api/loja/status`, { timeout: 15000 });
        statusLojaCache = data;
        log('INFO', 'StatusCheck', `Status atualizado: ${data.status}`);
    } catch (error) {
        log('ERROR', 'StatusCheck', `Falha ao buscar status da loja: ${error.message}`);
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
    atualizarStatusLojaPeriodicamente();
    setInterval(atualizarStatusLojaPeriodicamente, 60 * 1000);
});

client.on('message_create', async msg => {
    const chat = await msg.getChat();
    if (chat.isGroup || msg.fromMe) return;

    const lowerBody = msg.body?.trim().toLowerCase() ?? '';
    const chatId = msg.from;
    const currentState = chatStates.get(chatId);

    // Se o bot estiver aguardando a localização
    if (currentState === 'AGUARDANDO_LOCALIZACAO') {
        if (msg.hasLocation || msg.type === 'location') {
            await handleLocalizacaoRecebida(chat);
        } else {
            await chat.sendMessage('Não consegui identificar uma localização. Por favor, use a função de anexo do WhatsApp para enviar sua localização atual, ou digite "cancelar".');
        }
        return;
    }

    // Se o usuário estiver falando com um humano
    if (currentState === 'HUMANO_ATIVO') {
        if (lowerBody === 'menu' || lowerBody === 'voltar') {
            chatStates.delete(chatId);
            log('INFO', 'Handover', `Bot reativado para o chat ${chatId}.`);
            await msg.reply('Ok, o atendimento automático foi reativado! 👋');
            await enviarMenuPrincipal(chat);
        }
        return;
    }
    
    // Verifica se a mensagem é um pedido colado do cardápio
    if (lowerBody.includes('itens do pedido') && lowerBody.includes('total: r$')) {
        await handlePedidoRecebido(chat, msg.body);
        return;
    }

    // Se não for nada disso, mostra o menu principal com inteligência
    await enviarMenuPrincipal(chat, lowerBody);
});

// NOVO: Função para lidar com um pedido recebido
async function handlePedidoRecebido(chat, textoPedido) {
    log('INFO', 'OrderHandler', `Pedido recebido e reconhecido para o chat ${chat.id._serialized}.`);
    
    await chat.sendMessage('Seu pedido foi recebido com sucesso e já está com a nossa equipe! ✅');

    if (textoPedido.includes('*RETIRADA NO LOCAL*')) {
        await chat.sendMessage(`Vimos que seu pedido é para retirada. Pode vir buscá-lo em nosso endereço:\n\n*Rua Tulipas, Quadra 01, Lote 06, C-02, Jardim Mondale*\n\n📍 Link para o mapa: https://maps.app.goo.gl/eseCGMFiB857R4BP9`);
    } else if (textoPedido.includes('*NOME PARA ENTREGA*')) {
        await chat.sendMessage('Para agilizar sua entrega, por favor, nos envie sua localização atual usando a função de anexo do WhatsApp (📎).\n\nEste passo é opcional, mas ajuda muito nossos entregadores! Se não quiser, não precisa fazer nada. 😉');
        chatStates.set(chat.id._serialized, 'AGUARDANDO_LOCALIZACAO');
    }
}

// NOVO: Função para lidar com a localização
async function handleLocalizacaoRecebida(chat) {
    log('INFO', 'LocationHandler', `Localização recebida para o chat ${chat.id._serialized}.`);
    await chat.sendMessage('Localização recebida! Muito obrigado, isso ajudará bastante na sua entrega. 😊');
    chatStates.delete(chat.id._serialized); // Finaliza o estado de espera
}


// ATUALIZADO: Função principal com mais inteligência
async function enviarMenuPrincipal(chat, triggerMessage = '') {
    try {
        log('INFO', 'Handler', `Processando mensagem para ${chat.id._serialized}. Gatilho: "${triggerMessage}"`);
        
        const lojaAberta = statusLojaCache.status === 'aberto';
        let saudacao = 'Olá! Bem-vindo(a) à *Pamonharia Saborosa do Goiás*! 🌽\n\n';
        
        // Respostas contextuais
        const keywords = {
            pedido: ['pedido', 'cardapio', 'cardápio', 'pamonha', 'curau', 'bolo', 'bolinho', 'quero'],
            endereco: ['endereço', 'endereco', 'local', 'onde', 'localização'],
            horario: ['horário', 'horario', 'hora', 'abre', 'fecha', 'aberto'],
            atendente: ['atendente', 'falar', 'humano', 'ajuda']
        };

        let respostaFinal = '';

        if (keywords.pedido.some(kw => triggerMessage.includes(kw))) {
            if (lojaAberta) {
                respostaFinal = `Que ótimo! Para fazer seu pedido e ver nosso cardápio completo com estoque em tempo real, clique no link abaixo:\n\n*${CONFIG.CARDAPIO_URL}*`;
            } else {
                respostaFinal = `No momento estamos fechados. ${statusLojaCache.mensagem}\n\nVocê pode conferir as delícias que te esperam em nosso cardápio online: *${CONFIG.CARDAPIO_URL}*`;
            }
        } else if (keywords.endereco.some(kw => triggerMessage.includes(kw))) {
            respostaFinal = `Nosso endereço para retirada é:\n*Rua Tulipas, Quadra 01, Lote 06, C-02, Jardim Mondale*\n\nVocê pode ver no mapa aqui: https://maps.app.goo.gl/eseCGMFiB857R4BP9`;
        } else if (keywords.horario.some(kw => triggerMessage.includes(kw))) {
            respostaFinal = `O status atual da loja é: *${statusLojaCache.status.toUpperCase()}*.\n${statusLojaCache.mensagem}\n\nPara ver todos os horários detalhadamente, acesse nosso cardápio: *${CONFIG.CARDAPIO_URL}*`;
        } else if (keywords.atendente.some(kw => triggerMessage.includes(kw))) {
            respostaFinal = `Ok, estou transferindo seu atendimento. Em instantes um de nossos atendentes irá te responder por aqui.`;
            chatStates.set(chat.id._serialized, 'HUMANO_ATIVO');
            log('INFO', 'Handover', `Transferindo chat ${chat.id._serialized} para atendimento humano.`);
        } else {
            // Resposta padrão
            let mensagemPrincipal = lojaAberta 
                ? `Estamos abertos! Para ver nosso cardápio completo com estoque em tempo real e montar seu pedido, clique no link abaixo:\n\n*${CONFIG.CARDAPIO_URL}*`
                : `No momento estamos fechados. ${statusLojaCache.mensagem}\n\nMas você já pode conferir nosso cardápio para quando voltarmos! Clique no link abaixo:\n\n*${CONFIG.CARDAPIO_URL}*`;

            respostaFinal = `${saudacao}${mensagemPrincipal}\n\n--------------------\nOu, se preferir, me diga o que deseja (ex: "endereço", "horário" ou "falar com atendente").`;
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
