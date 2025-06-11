// =================================================================================================
// --- INICIALIZAÇÃO E DEPENDÊNCIAS ---
// =================================================================================================
require('dotenv').config(); // ADICIONADO: Carrega as variáveis do arquivo .env
const qrcode = require('qrcode-terminal');
const { Client, MessageMedia, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios'); // Para fazer chamadas ao backend

// Função de Log para padronizar as saídas no console
function log(level, context, message) {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    console.log(`[${timestamp}] [${level}] [${context}] ${message}`);
}

// =================================================================================================
// --- CONFIGURAÇÕES DA PAMONHARIA ---
// =================================================================================================
const CONFIG = {
    BOT_STATE_FILE: 'pamonharia_state.json',
    NOME_DA_PAMONHARIA: 'Saborosa Pamonha do Goiás',
    CHAVE_PIX: 'CNPJ: 54.835.680/0001-92',
    TAXA_ENTREGA: 14.00,
    HORARIO_DELIVERY: { INICIO: 11, FIM_HORA: 21, FIM_MINUTO: 30, DIAS: [1, 2, 3, 4, 5] },
    MENSAGEM_HORARIO: 'de Segunda a Sexta, das 11:00h às 21:30h',
    ENDERECO_RETIRADA: 'Rua Tulipas, Quadra 01, Lote 06, C-02, Jardim Mondale',
    LINK_LOCALIZACAO: 'https://maps.app.goo.gl/eseCGMFiB857R4BP9',
    INSTAGRAM: 'https://www.instagram.com/saborosapamonha/',
    // ALTERADO: As configurações do Telegram e do Backend agora vêm do .env
    TELEGRAM: {
        BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
        CHAT_ID: process.env.TELEGRAM_CHAT_ID
    },
    BACKEND_URL: process.env.BACKEND_URL,
};

// =================================================================================================
// --- ESTADOS E VARIÁVEIS GLOBAIS ---
// =================================================================================================
let cardapioDinamico = [];
let ambiguousItemsMap = {
    'pamonha-ambiguo': { prompt: "Claro! Qual tipo de *Pamonha Tradicional* você gostaria?\n\n*1.* De Doce\n*2.* De Sal\n*3.* De Sal com Pimenta", options: { '1': 'doce', '2': 'sal', '3': 'salpimenta'} },
    'a-moda-ambiguo': { prompt: "Notei que você pediu *Pamonha(s) à Moda*, que legal! 👍\n\nTemos duas opções deliciosas:\n\n*1.* Sem Pimenta (Moda 1)\n*2.* Com Pimenta (Moda 2)", options: { '1': 'moda-sem-pimenta', '2': 'moda-com-pimenta' } },
    'bolinho-ambiguo': { prompt: "Vi que você pediu *Bolinho(s) de Milho*. Como você prefere?\n\n*1.* Com Queijo (sem pimenta)\n*2.* Sem Queijo (sem pimenta)\n*3.* Com Queijo e Pimenta\n*4.* Sem Queijo e com Pimenta", options: { '1': 'bolinhocom', '2': 'bolinhosem', '3': 'bolinhopimentacom', '4': 'bolinhopimentasem' } },
    'curau-ambiguo': { prompt: "Perfeito! Sobre o *Curau*, você prefere ele como?\n\n*1.* Quente\n*2.* Gelado", options: { '1': 'curau-quente-ambiguo', '2': 'curau-gelado-ambiguo'} },
    'curau-quente-ambiguo': { prompt: "Para o *Curau Quente*, você gostaria:\n\n*1.* Com canela\n*2.* Sem canela", options: { '1': 'curauquentecom', '2': 'curauquentesem' } },
    'curau-gelado-ambiguo': { prompt: "Para o *Curau Gelado*, você gostaria:\n\n*1.* Com canela\n*2.* Sem canela", options: { '1': 'curaugeladocom', '2': 'curaugeladosem' } }
};

const STATES = { INICIO: 'inicio', AGUARDANDO_OPCAO_MENU: 'aguardando_opcao_menu', MONTANDO_PEDIDO: 'montando_pedido', AGUARDANDO_ACAO_POS_PEDIDO: 'aguardando_acao_pos_pedido', AGUARDANDO_RESOLUCAO_AMBIGUIDADE: 'aguardando_resolucao_ambiguidade', AGUARDANDO_TIPO_ENTREGA: 'aguardando_tipo_entrega', AGUARDANDO_LOCALIZACAO: 'aguardando_localizacao', AGUARDANDO_ENDERECO: 'aguardando_endereco', AGUARDANDO_FORMA_PAGAMENTO: 'aguardando_forma_pagamento', AGUARDANDO_VALOR_TROCO: 'aguardando_valor_troco', AGUARDANDO_CONFIRMACAO_PIX: 'aguardando_confirmacao_pix', AGUARDANDO_CONFIRMACAO_FINAL: 'aguardando_confirmacao_final', PEDIDO_CONCLUIDO: 'pedido_concluido', HUMANO_ATIVO: 'humano_ativo' };
const client = new Client({ authStrategy: new LocalAuth({ clientId: "bot-pamonharia" }) });
let telegramBot;
const chatStates = new Map();
let botStatus = { lojaAbertaManualmente: false, lojaFechadaManualmente: false };
let botReady = false;
const DRINK_KEYWORDS = ['bebida', 'refrigerante', 'refri', 'suco', 'coca', 'guarana', 'cerveja', 'agua', 'água'];

if (CONFIG.TELEGRAM.BOT_TOKEN && CONFIG.TELEGRAM.CHAT_ID) {
    telegramBot = new TelegramBot(CONFIG.TELEGRAM.BOT_TOKEN);
}

// =================================================================================================
// --- FUNÇÕES DE LÓGICA E UTILITÁRIAS ---
// =================================================================================================
async function carregarCardapio() {
    try {
        log("INFO", "LoadMenu", "Tentando carregar cardápio do backend...");
        const response = await axios.get(`${CONFIG.BACKEND_URL}/produtos`);
        const produtosComEstoque = response.data.data.filter(p => p.quantidade_estoque > 0);

        cardapioDinamico = produtosComEstoque.map(p => ({
            id: p.slug,
            db_id: p.id,
            nome: p.nome,
            preco: p.preco,
            tipo: 'pronta_entrega', 
            keywords: [p.nome.toLowerCase(), p.slug.replace(/-/g, ' '), ...p.nome.toLowerCase().split(' ')]
        }));
        
        cardapioDinamico.push(
            { id: 'a-moda-ambiguo', nome: 'Pamonha à Moda (ambíguo)', preco: 15.00, tipo: 'pronta_entrega', keywords: ['pamonhas a moda', 'pamonhas à moda', 'pamonha a moda', 'pamonha à moda', 'a moda', 'à moda']},
            { id: 'pamonha-ambiguo', nome: 'Pamonha (ambíguo)', preco: 13.00, tipo: 'pronta_entrega', keywords: ['pamonhas', 'pamonha']},
            { id: 'curau-ambiguo', nome: 'Curau (ambíguo)', preco: 10.00, tipo: 'pronta_entrega', keywords: ['curau', 'cural'] },
            { id: 'bolinho-ambiguo', nome: 'Bolinho de Milho (ambíguo)', preco: 4.00, tipo: 'pronta_entrega', keywords: ['bolinhos', 'bolinho', 'bolos de milho', 'bolo de milho'] }
        );

        log("INFO", "LoadMenu", `${produtosComEstoque.length} variações de produtos com estoque carregadas com sucesso.`);
    } catch (error) {
        log("ERROR", "LoadMenu", `Falha ao carregar cardápio do backend: ${error.message}`);
        cardapioDinamico = [];
    }
}

function saveBotState() { try { const stateToSave = { chatStates: Object.fromEntries(chatStates), botStatus }; fs.writeFileSync(CONFIG.BOT_STATE_FILE, JSON.stringify(stateToSave, null, 2)); } catch(e){ log("ERROR", "SaveState", e)} }
function loadBotState() { try { if (fs.existsSync(CONFIG.BOT_STATE_FILE)) { const data = fs.readFileSync(CONFIG.BOT_STATE_FILE, 'utf8'); const loadedData = JSON.parse(data); if (loadedData.chatStates) { for (const chatId in loadedData.chatStates) { chatStates.set(chatId, loadedData.chatStates[chatId]); } } if (loadedData.botStatus) { botStatus = loadedData.botStatus; } log("INFO", "LoadState", `Estados de conversa e status do bot carregados.`); } } catch (e) { log("ERROR", "LoadState", e); } }
async function enviarNotificacaoTelegram(mensagem) { if (!telegramBot) { log("WARN", "Telegram", "Bot não configurado."); return; } try { await telegramBot.sendMessage(CONFIG.TELEGRAM.CHAT_ID, mensagem, { parse_mode: 'Markdown' }); log("INFO", "Telegram", "Notificação enviada."); } catch (e) { log("ERROR", "Telegram", e.message); } }
const delay = ms => new Promise(res => setTimeout(res, ms));
async function sendMessageWithTyping(chat, message) { try { const typingDuration = 500 + (message.length * 15); await chat.sendStateTyping(); await delay(typingDuration); await chat.sendMessage(message); } catch (e) { log("ERROR", "SendMessage", `Falha ao enviar para ${chat.id._serialized}: ${e.message}`); } }
function escapeRegex(string) { return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function parsePedido(texto) {
    if (cardapioDinamico.length === 0) {
        log("WARN", "ParsePedido", "Tentativa de parse sem cardápio carregado.");
        return { pedidoProntaEntrega: {}, pedidoEncomenda: {} };
    }
    log("INFO", "ParsePedido", `Texto original para análise: "${texto}"`);
    let textoRestante = ` ${texto.toLowerCase().replace(/,|\n/g, ' ')} `;
    const pedidoProntaEntrega = {};
    const allKeywords = cardapioDinamico.flatMap(item =>
        (item.keywords || []).map(keyword => ({
            keyword: ` ${keyword.toLowerCase()} `,
            id: item.id,
            tipo: item.tipo
        }))
    );
    allKeywords.sort((a, b) => b.keyword.length - a.keyword.length);
    allKeywords.forEach(({ keyword, id, tipo }) => {
        const keywordPattern = escapeRegex(keyword.trim()).replace(/\s+/g, '\\s*');
        const regex = new RegExp(`(\\d+)?\\s*${keywordPattern}`, 'gi');
        let match;
        while ((match = regex.exec(textoRestante)) !== null) {
            const quantidade = match[1] ? parseInt(match[1], 10) : 1;
            if (tipo === 'pronta_entrega') {
                pedidoProntaEntrega[id] = (pedidoProntaEntrega[id] || 0) + quantidade;
            }
            textoRestante = textoRestante.replace(new RegExp(escapeRegex(match[0]), 'gi'), '');
        }
    });
    log("INFO", "ParsePedido", `Resultado: Pronta Entrega=${JSON.stringify(pedidoProntaEntrega)}`);
    return { pedidoProntaEntrega, pedidoEncomenda: {} };
}

async function finalizarEEnviarNotificacao(chat, state, msg) {
    const chatId = chat.id._serialized;
    log("INFO", "FinalizarPedido", `Finalizando pedido para ${chatId}.`);

    const itensDoPedido = Object.keys(state.pedido).map(slugId => {
        const produto = cardapioDinamico.find(p => p.id === slugId);
        return produto ? { id: produto.db_id, qtd: state.pedido[slugId] } : null;
    }).filter(p => p !== null);

    if (itensDoPedido.length > 0) {
        try {
            await axios.post(`${CONFIG.BACKEND_URL}/pedido`, { itens: itensDoPedido });
            log("INFO", "StockUpdate", "Estoque atualizado com sucesso via backend.");
        } catch (error) {
            log("ERROR", "StockUpdate", `FALHA CRÍTICA ao dar baixa no estoque: ${error.message}`);
            await enviarNotificacaoTelegram(`🔥 *ERRO DE ESTOQUE* 🔥\n\nNão foi possível dar baixa no pedido do cliente ${msg.from.replace('@c.us','')}. *VERIFICAR ESTOQUE MANUALMENTE*.`);
        }
    }

    const finalMsg = `✅ Pedido confirmado com sucesso! Ele já foi para a nossa cozinha e será preparado com muito carinho.\n\nMuito obrigado pela preferência! 🌽\n\n*Aproveite e siga-nos no Instagram:*\n${CONFIG.INSTAGRAM}`;
    await sendMessageWithTyping(chat, finalMsg);

    const contact = await msg.getContact();
    let notificacao = `🔔 *NOVO PEDIDO CONFIRMADO* 🔔\n\n*Cliente:* ${contact.pushname}\n*Contato:* ${msg.from.replace('@c.us','')}\n`;
    if (state.tipoEntrega === 'entrega') { 
        notificacao += `\n*Tipo:* ENTREGA 🛵\n*Dados:* ${state.dadosEntrega}\n`;
        if(state.localizacao) { notificacao += `*Mapa:* http://www.google.com/maps/place/${state.localizacao.latitude},${state.localizacao.longitude}\n`; }
        if(state.formaPagamento) {
            notificacao += `*Pagamento:* ${state.formaPagamento}`;
            if(state.formaPagamento === 'Dinheiro' && state.trocoPara) {
                notificacao += ` (Troco para: ${state.trocoPara})\n`;
            } else if (state.formaPagamento === 'PIX') {
                notificacao += ` (PAGAMENTO CONFIRMADO PELO CLIENTE)\n`;
            } else {
                notificacao += `\n`;
            }
        }
    } else { 
        notificacao += `\n*Tipo:* RETIRADA NO LOCAL 🚶\n`; 
    }

    notificacao += `\n*Itens:*\n`;
    let subtotal = 0;
    for (const slugId in state.pedido) { 
        const item = cardapioDinamico.find(p => p.id === slugId); 
        if(item) {
            notificacao += `*${state.pedido[slugId]}x* ${item.nome}\n`; 
            subtotal += item.preco * state.pedido[slugId]; 
        }
    }

    const totalFinal = state.tipoEntrega === 'entrega' ? subtotal + CONFIG.TAXA_ENTREGA : subtotal;
    notificacao += `*TOTAL:* R$ ${totalFinal.toFixed(2).replace('.',',')}`;

    await enviarNotificacaoTelegram(notificacao);
    chatStates.delete(chatId);
}

async function exibirConfirmacaoFinal(chat, state) {
    let resumoFinal = 'Ok, vamos confirmar tudo!\n\n*Seu Pedido:*\n';
    let subtotal = 0;
    for (const slugId in state.pedido) {
        const item = cardapioDinamico.find(p => p.id === slugId);
        if (item) {
            resumoFinal += `*${state.pedido[slugId]}x* ${item.nome}\n`;
            subtotal += item.preco * state.pedido[slugId];
        }
    }
    resumoFinal += `\nSubtotal: R$ ${subtotal.toFixed(2).replace('.', ',')}\n`;
    let totalFinal = subtotal;
    if (state.tipoEntrega === 'entrega') {
        resumoFinal += `Taxa de Entrega: R$ ${CONFIG.TAXA_ENTREGA.toFixed(2).replace('.', ',')}\n`;
        totalFinal += CONFIG.TAXA_ENTREGA;
        if (state.dadosEntrega) { resumoFinal += `\n*Dados da Entrega:*\n${state.dadosEntrega}\n`; }
        if (state.localizacao) { resumoFinal += `(Recebemos também sua localização no mapa 👍)\n`; }
        if (state.formaPagamento) {
            resumoFinal += `\n*Forma de Pagamento:* ${state.formaPagamento}\n`;
            if (state.formaPagamento === 'Dinheiro' && state.trocoPara) { resumoFinal += `*Troco para:* ${state.trocoPara}\n`; }
        }
    } else {
        resumoFinal += `\n*Retirada no local:* ${CONFIG.ENDERECO_RETIRADA}\n📍 *Link para o mapa:* ${CONFIG.LINK_LOCALIZACAO}\n`;
    }
    resumoFinal += `\n*TOTAL DO PEDIDO: R$ ${totalFinal.toFixed(2).replace('.', ',')}*\n\n`;
    resumoFinal += "Está tudo certo? Responda com *sim* para confirmar ou *não* para cancelar.";
    await sendMessageWithTyping(chat, resumoFinal);
    log("INFO", "StateChange", `Chat ${chat.id._serialized} movido para AGUARDANDO_CONFIRMACAO_FINAL`);
    state.currentState = STATES.AGUARDANDO_CONFIRMACAO_FINAL;
    state.lastTimestamp = Date.now();
}

function isLojaConsideradaAberta() {
    if (botStatus.lojaFechadaManualmente) return false;
    if (botStatus.lojaAbertaManualmente) return true;
    const now = new Date();
    const diaSemana = now.getDay();
    const hora = now.getHours();
    const minuto = now.getMinutes();
    const { INICIO, FIM_HORA, FIM_MINUTO, DIAS } = CONFIG.HORARIO_DELIVERY;
    if (!DIAS.includes(diaSemana)) return false;
    if (hora < INICIO || hora > FIM_HORA) return false;
    if (hora === FIM_HORA && minuto > FIM_MINUTO) return false;
    return true;
}

async function displayMainMenu(chat) { const greeting = new Date().getHours() < 12 ? 'Bom dia' : new Date().getHours() < 18 ? 'Boa tarde' : 'Boa noite'; const welcomeMessage = `🌽 ${greeting}! Bem-vindo(a) à *${CONFIG.NOME_DA_PAMONHARIA}*!\n\nComo podemos te ajudar hoje?`; const menuText = `*1.* 📖 Ver Cardápio e Fazer Pedido\n*2.* ⏰ Nosso Horário e Localização\n*3.* 💬 Falar com um Atendente\n\n_Dica: a qualquer momento, digite \`menu\` para reiniciar ou \`sair\` para cancelar._`; await sendMessageWithTyping(chat, welcomeMessage); await sendMessageWithTyping(chat, menuText); chatStates.set(chat.id._serialized, { currentState: STATES.AGUARDANDO_OPCAO_MENU, pedido: {}, lastTimestamp: Date.now(), parseFailures: 0 }); log("INFO", "StateChange", `Chat ${chat.id._serialized} movido para AGUARDANDO_OPCAO_MENU`); }

async function enviarCardapioEIniciarPedido(chat) {
    const imagePath = path.join(__dirname, 'cardapio.jpg');
    if (fs.existsSync(imagePath)) {
        try {
            const media = MessageMedia.fromFilePath(imagePath);
            await chat.sendMessage(media);
        } catch (e) {
            log("ERROR", "SendMenu", `Falha ao enviar a imagem do cardápio: ${e.message}`);
        }
    }
    const startOrderMessage = 'Para fazer seu pedido, basta me dizer o que você quer e a quantidade.\n\n*Por exemplo:* `2 pamonhas de doce e 1 curau com canela`\n\n*Aviso:* No momento, não estamos trabalhando com bebidas.\n\n_A qualquer momento, digite `menu` ou `sair`._';
    await sendMessageWithTyping(chat, startOrderMessage);
    const state = chatStates.get(chat.id._serialized);
    log("INFO", "StateChange", `Chat ${chat.id._serialized} movido para MONTANDO_PEDIDO`);
    state.currentState = STATES.MONTANDO_PEDIDO;
    state.lastTimestamp = Date.now();
}

async function processNextAmbiguity(chat, state) {
    if (state.ambiguityQueue && state.ambiguityQueue.length > 0) {
        const nextAmbig = state.ambiguityQueue.shift();
        state.itemAmbiguo = nextAmbig;
        const { prompt } = nextAmbig;
        await sendMessageWithTyping(chat, prompt + "\n\nPor favor, responda com o número da opção desejada.");
        log("INFO", "AmbiguityQueue", `Processando ambiguidade: ${nextAmbig.id}. Itens na fila: ${state.ambiguityQueue.length}`);
        state.currentState = STATES.AGUARDANDO_RESOLUCAO_AMBIGUIDADE;
    } else {
        log("INFO", "AmbiguityQueue", "Fila vazia. Exibindo resumo do pedido.");
        delete state.itemAmbiguo;
        delete state.ambiguityQueue;
        let resumoPedido = 'Certo! Seu pedido até agora:\n\n';
        let total = 0;
        if (Object.keys(state.pedido || {}).length === 0) {
            await sendMessageWithTyping(chat, "Ok, vamos lá! O que você gostaria de pedir?");
            state.currentState = STATES.MONTANDO_PEDIDO;
            return;
        }
        for (const slugId in state.pedido) {
            const item = cardapioDinamico.find(p => p.id === slugId);
            if (item) {
                resumoPedido += `*${state.pedido[slugId]}x* ${item.nome}\n`;
                total += item.preco * state.pedido[slugId];
            }
        }
        resumoPedido += `\n*Total Parcial: R$ ${total.toFixed(2).replace('.', ',')}*\n\n`;
        resumoPedido += "O que você deseja fazer agora?\n*1.* ✅ Finalizar pedido\n*2.* ✏️ Corrigir ou remover itens\n*3.* ➕ Adicionar mais itens\n\n_Ou digite `sair` para cancelar._";
        await sendMessageWithTyping(chat, resumoPedido);
        state.currentState = STATES.AGUARDANDO_ACAO_POS_PEDIDO;
    }
}

async function handleMontandoPedido(msg, chat, state) {
    if (!msg.body) {
        if (Object.keys(state.pedido || {}).length > 0) { await processNextAmbiguity(chat, state); }
        return;
    }
    const { pedidoProntaEntrega } = parsePedido(msg.body);
    if (Object.keys(pedidoProntaEntrega).length === 0) {
        state.parseFailures = (state.parseFailures || 0) + 1;
        log("WARN", "ParsePedido", `Falha de interpretação #${state.parseFailures} para ${chat.id._serialized}`);
        if (state.parseFailures >= 2) {
            log("WARN", "HumanHandover", `Limite de falhas atingido. Transferindo ${chat.id._serialized} para humano.`);
            await sendMessageWithTyping(chat, "Parece que estou com dificuldades para entender seu pedido. Para garantir que tudo saia perfeito, estou te transferindo para um de nossos atendentes. Por favor, aguarde um momento! 😊");
            state.currentState = STATES.HUMANO_ATIVO;
            const contact = await msg.getContact();
            enviarNotificacaoTelegram(`🔔 *ATENDIMENTO HUMANO REQUERIDO*\nCliente: *${contact.pushname}* (${msg.from.replace('@c.us','')}) não foi entendido pelo bot após 2 tentativas.`);
        } else {
            await sendMessageWithTyping(chat, "Opa, não consegui identificar os itens no seu pedido. 🤔\n\nPor favor, tente de novo. Você pode dizer, por exemplo: `2 pamonhas de doce e 1 curau com canela`.");
        }
        return;
    }
    state.parseFailures = 0;
    state.ambiguityQueue = state.ambiguityQueue || [];
    for (const ambigId in ambiguousItemsMap) {
        if (pedidoProntaEntrega[ambigId]) {
            const { prompt, options } = ambiguousItemsMap[ambigId];
            state.ambiguityQueue.push({ id: ambigId, quantidade: pedidoProntaEntrega[ambigId], prompt, options });
            delete pedidoProntaEntrega[ambigId];
        }
    }
    for (const id in pedidoProntaEntrega) {
        state.pedido[id] = (state.pedido[id] || 0) + pedidoProntaEntrega[id];
    }
    await processNextAmbiguity(chat, state);
}

// =================================================================================================
// --- CLIENTE WHATSAPP ---
// =================================================================================================
client.on('qr', qr => {
    log("INFO", "Client", "QR Code recebido, escaneie.");
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    botReady = true;
    loadBotState();
    carregarCardapio();
    setInterval(carregarCardapio, 300000); // Recarrega o cardápio a cada 5 minutos
    log("SUCCESS", "Client", `Bot ${CONFIG.NOME_DA_PAMONHARIA} está online!`);
    enviarNotificacaoTelegram(`✅ Bot *${CONFIG.NOME_DA_PAMONHARIA}* ficou online!`);
});

client.on('message_create', async msg => {
    if (!botReady) return;
    const chat = await msg.getChat();
    if (chat.isGroup) { return; }
    const lowerBody = msg.body?.trim().toLowerCase() ?? '';
    log("INFO", "OnMessage", `Mensagem recebida de ${msg.from}: "${msg.body}" (Tipo: ${msg.type})`);

    const globalCommandsReset = ['menu', 'reiniciar'];
    const globalCommandsCancel = ['sair', 'cancelar'];

    if (globalCommandsReset.includes(lowerBody)) { log("INFO", "GlobalCommand", `Cliente ${chat.id._serialized} usou comando para reiniciar.`); await displayMainMenu(chat); saveBotState(); return; }
    if (globalCommandsCancel.includes(lowerBody)) { log("INFO", "GlobalCommand", `Cliente ${chat.id._serialized} usou comando para cancelar.`); await sendMessageWithTyping(chat, "Ok, atendimento encerrado. Se precisar de algo, é só chamar! 👋"); chatStates.delete(chat.id._serialized); saveBotState(); return; }

    if (msg.fromMe) { 
        const fecharRegex = /(fechar|encerrar).*(loja|atendimento)/i; 
        const abrirRegex = /(abrir|iniciar|voltar).*(loja|atendimento)/i; 
        if (fecharRegex.test(lowerBody)) { log("INFO", "AdminCommand", "Comando para fechar a loja recebido."); botStatus.lojaFechadaManualmente = true; botStatus.lojaAbertaManualmente = false; saveBotState(); await client.sendMessage(msg.to, '[AVISO] A loja foi fechada manualmente.'); } 
        else if (abrirRegex.test(lowerBody)) { log("INFO", "AdminCommand", "Comando para abrir a loja recebido."); botStatus.lojaFechadaManualmente = false; botStatus.lojaAbertaManualmente = true; saveBotState(); await client.sendMessage(msg.to, '[AVISO] A loja foi aberta manualmente.'); } 
        else if (lowerBody.includes('assumir')) { const targetChatId = msg.to; const state = chatStates.get(targetChatId); if (state && state.currentState !== STATES.HUMANO_ATIVO) { log("INFO", "AdminCommand", `Atendimento para ${targetChatId} foi assumido.`); state.currentState = STATES.HUMANO_ATIVO; state.lastTimestamp = Date.now(); chatStates.set(targetChatId, state); saveBotState(); } } 
        return; 
    }

    const chatId = chat.id._serialized;
    let state = chatStates.get(chatId);

    if (!state) { 
        if (!isLojaConsideradaAberta()) { 
            const closedMessage = `Olá! Agradecemos seu contato com a *${CONFIG.NOME_DA_PAMONHARIA}*.\n\nNo momento estamos fechados. Nosso horário de atendimento é *${CONFIG.MENSAGEM_HORARIO}*.\n\nRetornaremos no próximo dia útil. 😊`; 
            await sendMessageWithTyping(chat, closedMessage); 
            log("INFO", "OnMessage", `Mensagem para ${chatId} bloqueada (loja fechada).`); 
            return; 
        } 
        state = { currentState: STATES.INICIO, pedido: {}, lastTimestamp: Date.now(), parseFailures: 0 }; 
        chatStates.set(chatId, state); 
        log("INFO", "OnMessage", `Novo estado criado para ${chatId}. Estado: ${state.currentState}`); 
    } else { 
        log("INFO", "OnMessage", `Estado atual de ${chatId}: ${state.currentState}`); 
    }

    state.lastTimestamp = Date.now();

    if (state.currentState === STATES.HUMANO_ATIVO) { 
        if(lowerBody === 'menu' || lowerBody === 'reiniciar'){ 
            log("INFO", "GlobalCommand", `Cliente ${chatId} reativou o bot.`); 
            await displayMainMenu(chat); 
        } 
        saveBotState(); 
        return; 
    }

    const askedForDrink = DRINK_KEYWORDS.some(keyword => lowerBody.includes(keyword));
    if (askedForDrink && !state.informedNoDrinks) { 
        log("INFO", "DrinkInfo", `Cliente ${chatId} perguntou sobre bebidas.`); 
        await sendMessageWithTyping(chat, "Só para te avisar, no momento não estamos trabalhando com bebidas, ok? Vou processar os outros itens do seu pedido. 😊"); 
        state.informedNoDrinks = true; 
    }

    try {
        switch (state.currentState) {
            case STATES.INICIO: 
                await displayMainMenu(chat); 
                break;

            case STATES.AGUARDANDO_OPCAO_MENU:
                if (cardapioDinamico.length === 0 && lowerBody === '1') {
                    await sendMessageWithTyping(chat, "Desculpe, nosso sistema de cardápio está temporariamente fora do ar ou estamos sem produtos em estoque. Por favor, fale com um atendente digitando *3*.");
                    break;
                }
                if (lowerBody === '1') { await enviarCardapioEIniciarPedido(chat); } 
                else if (lowerBody === '2') { const infoMsg = `Nosso horário de delivery é *${CONFIG.MENSAGEM_HORARIO}*.\n\nNosso endereço para retirada é: *${CONFIG.ENDERECO_RETIRADA}*\n\n📍 Link para o mapa: ${CONFIG.LINK_LOCALIZACAO}`; await sendMessageWithTyping(chat, infoMsg); await delay(1500); const followupMsg = "Posso te ajudar com mais alguma coisa?\n*1.* Ver Cardápio e Fazer Pedido\n*3.* Falar com um Atendente"; await sendMessageWithTyping(chat, followupMsg); } 
                else if (lowerBody === '3') { state.currentState = STATES.HUMANO_ATIVO; log("INFO", "StateChange", `Chat ${chatId} movido para HUMANO_ATIVO`); await sendMessageWithTyping(chat, "Ok! Um de nossos atendentes irá te responder por aqui em instantes."); const contact = await msg.getContact(); enviarNotificacaoTelegram(`🔔 *ATENDIMENTO HUMANO SOLICITADO*\nCliente: *${contact.pushname}* (${msg.from.replace('@c.us','')})`); } 
                else { await sendMessageWithTyping(chat, "Opção inválida. Por favor, digite *1*, *2* ou *3*."); }
                break;

            case STATES.MONTANDO_PEDIDO: 
                await handleMontandoPedido(msg, chat, state); 
                break;

            case STATES.AGUARDANDO_ACAO_POS_PEDIDO:
                if (lowerBody === '1') { state.currentState = STATES.AGUARDANDO_TIPO_ENTREGA; log("INFO", "StateChange", `Chat ${chatId} movido para AGUARDANDO_TIPO_ENTREGA`); const deliveryMessage = `Perfeito, seu pedido está quase finalizado! Como você gostaria de recebê-lo?\n\n*1.* 🛵 Entrega\n_Nós levamos até você! Taxa de entrega: *R$ ${CONFIG.TAXA_ENTREGA.toFixed(2).replace('.', ',')}*_ \n\n*2.* 🚶 Retirada no Local\n_Sem custo adicional. Nosso endereço é: ${CONFIG.ENDERECO_RETIRADA}_`; await sendMessageWithTyping(chat, deliveryMessage); } 
                else if (lowerBody === '2') { state.pedido = {}; state.currentState = STATES.MONTANDO_PEDIDO; log("INFO", "StateChange", `Pedido de ${chatId} limpo. Voltando para MONTANDO_PEDIDO.`); await sendMessageWithTyping(chat, "Ok, sem problemas! Para garantir 100% de precisão, vamos montar seu pedido corrigido do zero.\n\nPor favor, me diga a lista completa de como você quer que ela fique agora."); } 
                else if (lowerBody === '3') { state.currentState = STATES.MONTANDO_PEDIDO; log("INFO", "StateChange", `Chat ${chatId} voltando para MONTANDO_PEDIDO.`); await sendMessageWithTyping(chat, "Certo! O que mais você gostaria de adicionar ao seu pedido?"); } 
                else { await sendMessageWithTyping(chat, "Opção inválida. Por favor, digite *1*, *2* ou *3*."); }
                break;

            case STATES.AGUARDANDO_RESOLUCAO_AMBIGUIDADE:
                const chosenOption = state.itemAmbiguo.options[lowerBody];
                if (chosenOption && state.itemAmbiguo) {
                    if (ambiguousItemsMap[chosenOption]) { log("INFO", "Ambiguidade", `Aninhada detectada: ${state.itemAmbiguo.id} -> ${chosenOption}. Perguntando de novo.`); const { prompt, options } = ambiguousItemsMap[chosenOption]; state.ambiguityQueue.unshift({ id: chosenOption, quantidade: state.itemAmbiguo.quantidade, prompt, options });
                    } else { state.pedido[chosenOption] = (state.pedido[chosenOption] || 0) + state.itemAmbiguo.quantidade; log("INFO", "Ambiguidade", `Resolvido: Cliente escolheu ${chosenOption} para o item ${state.itemAmbiguo.id}.`); }
                    await processNextAmbiguity(chat, state);
                } else { await sendMessageWithTyping(chat, "Opção inválida. Por favor, escolha um dos números apresentados."); }
                break;

            case STATES.AGUARDANDO_TIPO_ENTREGA:
                if (lowerBody === '1' || lowerBody.includes('entrega')) { state.tipoEntrega = 'entrega'; state.currentState = STATES.AGUARDANDO_LOCALIZACAO; log("INFO", "StateChange", `Chat ${chatId} movido para AGUARDANDO_LOCALIZACAO`); await sendMessageWithTyping(chat, `Ótimo! Para facilitar a entrega, por favor, nos envie sua localização atual.\n\nToque no ícone de clipe (📎), depois em 'Localização' e 'Localização Atual'.\n\n*Se preferir não enviar, basta digitar seu endereço completo.*`); } 
                else if (lowerBody === '2' || lowerBody.includes('retirada')) { state.tipoEntrega = 'retirada'; await exibirConfirmacaoFinal(chat, state); } 
                else { await sendMessageWithTyping(chat, "Opção inválida. Por favor, digite *1* para Entrega ou *2* para Retirada."); }
                break;

            case STATES.AGUARDANDO_LOCALIZACAO:
                if (msg.type === 'location') {
                    state.localizacao = msg.location;
                    state.currentState = STATES.AGUARDANDO_ENDERECO;
                    log("INFO", "StateChange", `Chat ${chatId} movido para AGUARDANDO_ENDERECO`);
                    await sendMessageWithTyping(chat, "Localização recebida! 👍 Para finalizar, por favor, me informe em uma *única mensagem*:\n\n*1.* O nome de quem irá receber.\n*2.* O endereço completo com bairro e um ponto de referência.");
                } else if (msg.body) {
                    log("INFO", "LocationSkip", `Cliente ${chatId} pulou a etapa de localização e digitou o endereço.`);
                    state.dadosEntrega = msg.body;
                    state.currentState = STATES.AGUARDANDO_FORMA_PAGAMENTO;
                    log("INFO", "StateChange", `Chat ${chatId} movido para AGUARDANDO_FORMA_PAGAMENTO`);
                    await sendMessageWithTyping(chat, "Qual será a forma de pagamento?\n\n*1.* 💳 Cartão (Crédito/Débito)\n*2.* 💲 PIX\n*3.* 💵 Dinheiro");
                }
                else { await sendMessageWithTyping(chat, "Opa, não recebi sua localização ou endereço. Por favor, envie sua localização pelo mapa ou digite o endereço completo."); }
                break;

            case STATES.AGUARDANDO_ENDERECO:
                state.dadosEntrega = msg.body;
                state.currentState = STATES.AGUARDANDO_FORMA_PAGAMENTO;
                log("INFO", "StateChange", `Chat ${chatId} movido para AGUARDANDO_FORMA_PAGamento`);
                await sendMessageWithTyping(chat, "Qual será a forma de pagamento?\n\n*1.* 💳 Cartão (Crédito/Débito)\n*2.* 💲 PIX\n*3.* 💵 Dinheiro");
                break;

            case STATES.AGUARDANDO_FORMA_PAGAMENTO:
                if (lowerBody === '1' || lowerBody.includes('cartão') || lowerBody.includes('cartao')) {
                    state.formaPagamento = 'Cartão (Crédito/Débito)';
                    await exibirConfirmacaoFinal(chat, state);
                } else if (lowerBody === '2' || lowerBody.includes('pix')) {
                    state.formaPagamento = 'PIX';
                    log("INFO", "Payment", `Cliente escolheu PIX. Movendo para AGUARDANDO_CONFIRMACAO_PIX.`);
                    let subtotal = 0;
                    let resumoPix = 'Confirmando seu pedido para pagamento com PIX:\n\n';
                    for (const slugId in state.pedido) {
                        const item = cardapioDinamico.find(p => p.id === slugId);
                        if (item) {
                            resumoPix += `*${state.pedido[slugId]}x* ${item.nome}\n`;
                            subtotal += item.preco * state.pedido[slugId];
                        }
                    }
                    const totalFinal = state.tipoEntrega === 'entrega' ? subtotal + CONFIG.TAXA_ENTREGA : subtotal;
                    resumoPix += `\nSubtotal: R$ ${subtotal.toFixed(2).replace('.', ',')}`;
                    if (state.tipoEntrega === 'entrega') { resumoPix += `\nTaxa de Entrega: R$ ${CONFIG.TAXA_ENTREGA.toFixed(2).replace('.', ',')}`; }
                    resumoPix += `\n\n*TOTAL A PAGAR: R$ ${totalFinal.toFixed(2).replace('.', ',')}*`;
                    resumoPix += `\n\nNossa chave PIX é:\n*${CONFIG.CHAVE_PIX}*`;
                    resumoPix += `\n\nPor favor, realize o pagamento e, em seguida, responda com *"paguei"* ou *"feito"* para confirmarmos o seu pedido.`;
                    state.currentState = STATES.AGUARDANDO_CONFIRMACAO_PIX;
                    await sendMessageWithTyping(chat, resumoPix);
                } else if (lowerBody === '3' || lowerBody.includes('dinheiro')) {
                    state.formaPagamento = 'Dinheiro';
                    state.currentState = STATES.AGUARDANDO_VALOR_TROCO;
                    log("INFO", "StateChange", `Chat ${chatId} movido para AGUARDANDO_VALOR_TROCO`);
                    await sendMessageWithTyping(chat, "Você precisará de troco? Se sim, para qual valor? (Ex: `troco para 100` ou `não preciso`)");
                } else {
                    await sendMessageWithTyping(chat, "Opção inválida. Por favor, digite *1* para Cartão, *2* para PIX ou *3* para Dinheiro.");
                }
                break;

            case STATES.AGUARDANDO_VALOR_TROCO:
                state.trocoPara = msg.body;
                log("INFO", "Payment", `Informação de troco recebida: ${msg.body}`);
                await exibirConfirmacaoFinal(chat, state);
                break;

            case STATES.AGUARDANDO_CONFIRMACAO_PIX:
                const pixConfirmadoKeywords = ['paguei', 'feito', 'pago', 'pronto', 'confirmo', 'confirmado'];
                if (pixConfirmadoKeywords.some(keyword => lowerBody.includes(keyword))) {
                    log("INFO", "Payment", `Cliente ${chatId} confirmou o pagamento do PIX.`);
                    state.currentState = STATES.PEDIDO_CONCLUIDO;
                    await finalizarEEnviarNotificacao(chat, state, msg);
                } else {
                    await sendMessageWithTyping(chat, "Ainda estou aguardando a sua confirmação de pagamento. Assim que realizar o PIX, me avise respondendo com *'paguei'* ou *'feito'* para que eu possa enviar seu pedido para a cozinha. 😊");
                }
                break;

            case STATES.AGUARDANDO_CONFIRMACAO_FINAL:
                if (lowerBody === 'sim') {
                    state.currentState = STATES.PEDIDO_CONCLUIDO;
                    await finalizarEEnviarNotificacao(chat, state, msg);
                } else if (lowerBody === 'não' || lowerBody === 'nao') {
                    await sendMessageWithTyping(chat, "Ok, seu pedido foi cancelado. Se quiser começar de novo, é só digitar *menu*.");
                    chatStates.delete(chatId);
                } else { 
                    await sendMessageWithTyping(chat, "Resposta inválida. Por favor, digite *sim* para confirmar ou *não* para cancelar."); 
                }
                break;

            case STATES.PEDIDO_CONCLUIDO:
                await sendMessageWithTyping(chat, `Olá! Vi que você já fez um pedido. Para um novo atendimento, digite *menu*.`);
                break;
        }
    } catch (e) {
        log("ERROR", "MainSwitch", `Erro na conversa com ${chatId}: ${e.message}\n${e.stack}`);
        chatStates.delete(chatId);
    }
    saveBotState();
});

// =================================================================================================
// --- TAREFAS AGENDADAS E INICIALIZAÇÃO ---
// =================================================================================================
setInterval(async () => {
    if (!botReady) return;
    const now = Date.now();
    const RECAPTURE_TIMEOUT = 20 * 60 * 1000;
    const SESSION_CLEANUP_TIMEOUT = 90 * 60 * 1000;
    for (const [chatId, state] of chatStates.entries()) {
        const timeSinceLastInteraction = now - (state.lastTimestamp || now);
        if (timeSinceLastInteraction > SESSION_CLEANUP_TIMEOUT) {
            log("INFO", "Inactivity", `Sessão de ${chatId} expirou e foi limpa.`);
            chatStates.delete(chatId);
            continue;
        }
        const statesForRecapture = [STATES.AGUARDANDO_OPCAO_MENU, STATES.MONTANDO_PEDIDO, STATES.AGUARDANDO_ACAO_POS_PEDIDO, STATES.AGUARDANDO_TIPO_ENTREGA, STATES.AGUARDANDO_ENDERECO, STATES.AGUARDANDO_RESOLUCAO_AMBIGUIDADE, STATES.AGUARDANDO_CONFIRMACAO_PIX];
        if (statesForRecapture.includes(state.currentState) && !state.recapMessageSent && timeSinceLastInteraction > RECAPTURE_TIMEOUT) {
            try {
                const chat = await client.getChatById(chatId);
                const recapMessage = "Olá! Vi que começamos nosso atendimento, mas não continuamos. 😊\n\nSe ainda precisar de ajuda ou quiser fazer um pedido, é só me chamar! Se não, pode ignorar esta mensagem. 🌽";
                await sendMessageWithTyping(chat, recapMessage);
                log("INFO", "Inactivity", `Mensagem de recaptura enviada para ${chatId}.`);
                state.recapMessageSent = true;
                chatStates.set(chatId, state);
            } catch (e) {
                log("ERROR", "Inactivity", `Falha ao enviar recaptura para ${chatId}: ${e.message}`);
            }
        }
    }
    saveBotState();
}, 60000);

client.initialize().catch(err => {
    log("FATAL", "Initialize", `Falha ao inicializar o cliente: ${err}`);
    enviarNotificacaoTelegram(`🔥 *ERRO CRÍTICO NO BOT*\n\nO bot da pamonharia não conseguiu iniciar. Verificar o console imediatamente.`);
});