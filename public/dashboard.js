document.addEventListener('DOMContentLoaded', () => {
    // --- ELEMENTOS E VARIÁVEIS GLOBAIS ---
    const backendUrl = 'https://pamonharia-servidor.onrender.com';
    let cache = { produtos: [], setores: [], combos: [] };
    let sortable = null;
    let regrasTemporarias = [];

    // --- ELEMENTOS DO DOM ---
    const loginContainer = document.getElementById('login-container');
    const dashboardContainer = document.getElementById('dashboard-container');
    const loginForm = document.getElementById('form-login');
    const btnLogout = document.getElementById('btn-logout');
    const btnAddProdutoBase = document.getElementById('btn-add-produto-base');
    const btnAddCombo = document.getElementById('btn-add-combo');
    const globalActionsMenu = document.getElementById('global-actions-menu');
    const gerenciadorProdutos = document.getElementById('gerenciador-produtos');
    const gerenciadorCombos = document.getElementById('gerenciador-combos');
    
    // --- FUNÇÃO DE INICIALIZAÇÃO PRINCIPAL ---
    function init() {
        verificarSessao();
        setupEventListeners();
    }

    // --- SETUP DE EVENTOS ---
    function setupEventListeners() {
        // Função auxiliar para adicionar listeners de forma segura
        const safeAddEventListener = (selector, event, handler) => {
            const element = document.querySelector(selector);
            if (element) {
                element.addEventListener(event, handler);
            } else {
                console.warn(`Elemento não encontrado para o seletor: ${selector}`);
            }
        };

        safeAddEventListener('#form-login', 'submit', handleLogin);
        safeAddEventListener('#btn-logout', 'click', handleLogout);
        safeAddEventListener('#toggle-senha', 'click', () => {
             const input = document.getElementById('login-senha');
             const eyeOpen = document.getElementById('eye-open');
             const eyeClosed = document.getElementById('eye-closed');
             if(!input || !eyeOpen || !eyeClosed) return;
             const isPassword = input.type === 'password';
             input.type = isPassword ? 'text' : 'password';
             eyeOpen.style.display = isPassword ? 'none' : 'block';
             eyeClosed.style.display = isPassword ? 'block' : 'none';
        });

        setupTabs();
        document.querySelectorAll('.btn-modal-cancel').forEach(btn => btn.addEventListener('click', fecharModais));
        
        safeAddEventListener('#btn-add-produto-base', 'click', () => abrirModalProdutoBase());
        safeAddEventListener('#btn-add-combo', 'click', () => abrirModalCombo());

        safeAddEventListener('#gerenciador-produtos', 'click', handleAcoesProdutos);
        safeAddEventListener('#gerenciador-combos', 'click', handleAcoesCombos);
        safeAddEventListener('#global-actions-menu', 'click', handleMenuAcoesClick);
        safeAddEventListener('#lista-setores', 'click', handleAcoesSetor);

        safeAddEventListener('#form-produto-base', 'submit', handleFormProdutoSubmit);
        safeAddEventListener('#form-variacao', 'submit', handleFormVariacaoSubmit);
        safeAddEventListener('#form-setor', 'submit', handleFormSetorSubmit);
        safeAddEventListener('#form-combo', 'submit', handleFormComboSubmit);

        safeAddEventListener('#btn-add-regra', 'click', adicionarRegra);
        safeAddEventListener('#regra-tipo', 'change', toggleRegraInputs);
        safeAddEventListener('#regras-container', 'click', handleAcaoRegra);

         document.addEventListener('click', (e) => {
            if (!e.target.closest('.actions-menu-btn') && !e.target.closest('#global-actions-menu')) {
                fecharMenuAcoes();
            }
        });
    }

    // --- LÓGICA DE CARREGAMENTO DE DADOS ---
    async function carregarTudo() {
        try {
            mostrarToast('Carregando dados...', 'info');
            const [setoresRes, produtosRes, combosRes] = await Promise.all([
                fetchProtegido(`${backendUrl}/setores`),
                fetchProtegido(`${backendUrl}/dashboard/produtos`),
                fetchProtegido(`${backendUrl}/api/dashboard/combos`)
            ]);
            if(!setoresRes.ok || !produtosRes.ok || !combosRes.ok) throw new Error("Falha ao carregar dados do servidor.");
            
            cache.setores = (await setoresRes.json()).data;
            cache.produtos = (await produtosRes.json()).data;
            cache.combos = (await combosRes.json()).data;
            
            renderizarGerenciadorProdutos();
            renderizarGerenciadorSetores();
            renderizarGerenciadorCombos();

            inicializarDragAndDrop();
            aplicarPermissoes();
        } catch (err) {
            mostrarToast(err.message, 'erro');
            console.error(err);
        }
    }

    // --- LÓGICA DE AUTENTICAÇÃO E SESSÃO ---
    async function handleLogin(event) {
        event.preventDefault();
        document.getElementById('login-error').textContent = '';
        const email = document.getElementById('login-email').value;
        const senha = document.getElementById('login-senha').value;
        try {
            const response = await fetch(`${backendUrl}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, senha })
            });
            const data = await response.json();
            if (!response.ok) { throw new Error(data.error || 'Erro ao fazer login.'); }
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('usuario', JSON.stringify(data.usuario));
            mostrarDashboard();
            await carregarTudo();
        } catch (error) {
            document.getElementById('login-error').textContent = error.message;
        }
    }

    function handleLogout() {
        localStorage.removeItem('authToken');
        localStorage.removeItem('usuario');
        mostrarLogin();
    }
    
    function mostrarDashboard() {
        loginContainer.style.display = 'none';
        dashboardContainer.style.display = 'block';
    }

    function mostrarLogin() {
        loginContainer.style.display = 'flex';
        dashboardContainer.style.display = 'none';
    }

    function aplicarPermissoes() {
        const usuarioString = localStorage.getItem('usuario');
        if (!usuarioString) return;
        const usuario = JSON.parse(usuarioString);
        const elementosAdmin = document.querySelectorAll('[data-admin-only]');
        const isOperador = usuario.cargo === 'operador';
        if (sortable) sortable.option("disabled", isOperador);
        elementosAdmin.forEach(el => {
            el.style.display = isOperador ? 'none' : '';
        });
        document.querySelectorAll('.produto-header').forEach(el => {
            el.style.cursor = isOperador ? 'default' : 'grab';
        });
    }

    async function fetchProtegido(url, options = {}) {
        const token = localStorage.getItem('authToken');
        const headers = { ...options.headers };
        if (token) { headers['Authorization'] = `Bearer ${token}`; }
        if (!(options.body instanceof FormData)) { headers['Content-Type'] = 'application/json'; }
        const response = await fetch(url, { ...options, headers });
        if (response.status === 401 || response.status === 403) {
            handleLogout();
            throw new Error('Sessão inválida ou expirada. Faça login novamente.');
        }
        return response;
    }
    
    // --- LÓGICA DE RENDERIZAÇÃO (CRIAR HTML) ---
    function renderizarGerenciadorProdutos() {
        gerenciadorProdutos.innerHTML = ''; 
        cache.produtos.forEach(pb => {
            const cardDiv = document.createElement('div');
            cardDiv.className = 'produto-card';
            cardDiv.dataset.produtoBaseId = pb.id;
            cardDiv.innerHTML = `
                <div class="produto-header" data-id="${pb.id}">
                    <span class="produto-header-toggle">▶</span>
                    <img src="${pb.imagem_url}" alt="${pb.nome}" class="produto-header-imagem">
                    <div class="produto-header-info">
                        <h3>${pb.nome}</h3>
                        <p>Setor: ${pb.setor_nome || 'Não definido'}</p>
                    </div>
                    <div class="actions-cell" data-admin-only>
                        <button class="actions-menu-btn" data-action="toggle-actions-menu" data-type="produto_base" data-id="${pb.id}" data-nome="${pb.nome}">⋮</button>
                    </div>
                </div>
                <div class="variacoes-container hidden" id="variacoes-pb-${pb.id}">
                    <table class="variacoes-table">
                        <thead><tr><th>Variação</th><th>Preço</th><th>Estoque</th><th>Ações</th></tr></thead>
                        <tbody>${renderizarLinhasVariacoes(pb)}</tbody>
                    </table>
                    <button class="add-btn" data-action="adicionar-variacao" data-id="${pb.id}" data-admin-only>+ Adicionar Nova Variação</button>
                </div>
            `;
            gerenciadorProdutos.appendChild(cardDiv);
        });
    }

    function renderizarLinhasVariacoes(produtoBase) {
        if (!produtoBase.variacoes || produtoBase.variacoes.length === 0) {
            return '<tr><td colspan="4" style="text-align:center; padding: 20px;">Nenhuma variação cadastrada.</td></tr>';
        }
        return produtoBase.variacoes.map(v => `
            <tr class="${v.quantidade_estoque === 0 ? 'variacao-esgotada' : ''}">
                <td>${v.nome}</td>
                <td>R$ ${Number(v.preco).toFixed(2).replace('.',',')}</td>
                <td>
                    <div class="stock-controls">
                        <button class="stock-btn" data-action="stock-minus" data-id="${v.id}">-</button>
                        <input type="number" value="${v.quantidade_estoque}" id="estoque-v-${v.id}" min="0">
                        <button class="stock-btn" data-action="stock-plus" data-id="${v.id}">+</button>
                        <button class="save-btn btn-sm" data-action="salvar-estoque" data-id="${v.id}">Salvar</button>
                    </div>
                </td>
                <td class="actions-cell" data-admin-only>
                    <button class="actions-menu-btn" data-action="toggle-actions-menu" data-type="variacao" data-id="${v.id}" data-pb-id="${produtoBase.id}" data-nome="${v.nome}">⋮</button>
                </td>
            </tr>
        `).join('');
    }
    
    function renderizarGerenciadorSetores() {
        const containerSetores = document.getElementById('Setores');
        containerSetores.innerHTML = `<div class="form-section"><h2>Gerenciar Setores</h2><form id="form-setor"><input type="hidden" id="setor-id"><label for="nome-setor">Nome do Setor:</label><input type="text" id="nome-setor" placeholder="Ex: Pamonhas, Bebidas, Doces" required><div class="form-buttons"><button type="submit" class="save-btn">Salvar Setor</button><button type="button" class="cancel-btn" id="btn-limpar-form-setor">Limpar</button></div></form><h3>Setores Existentes:</h3><ul id="lista-setores"></ul></div>`;
        const listaUl = document.getElementById('lista-setores');
        listaUl.innerHTML = '';
        cache.setores.forEach(setor => {
            listaUl.innerHTML += `<li><span>${setor.nome}</span><div class="actions-cell"><button class="edit-btn btn-sm" data-action="editar-setor" data-id="${setor.id}" data-nome="${setor.nome}">Editar</button><button class="delete-btn btn-sm" data-action="excluir-setor" data-id="${setor.id}" data-nome="${setor.nome}">Excluir</button></div></li>`;
        });
        document.querySelector('#btn-limpar-form-setor').addEventListener('click', () => {
              document.querySelector('#form-setor').reset();
              document.querySelector('#setor-id').value = '';
        });
    }

    function renderizarGerenciadorCombos() {
        gerenciadorCombos.innerHTML = '';
        if (!cache.combos) return;
        cache.combos.forEach(combo => {
            const statusClass = combo.ativo ? 'status-ativo' : 'status-inativo';
            const cardDiv = document.createElement('div');
            cardDiv.className = 'produto-card';
            cardDiv.dataset.comboId = combo.id;
            cardDiv.innerHTML = `
                <div class="produto-header" data-id="${combo.id}" data-action="editar-combo">
                     <img src="${combo.imagem_url}" alt="${combo.nome}" class="produto-header-imagem">
                    <div class="produto-header-info">
                        <h3>${combo.nome} <span class="status-dot ${statusClass}" title="${combo.ativo ? 'Ativo' : 'Inativo'}"></span></h3>
                        <p>Preço Base: R$ ${Number(combo.preco_base).toFixed(2).replace('.',',')}</p>
                    </div>
                    <div class="actions-cell" data-admin-only>
                        <button class="actions-menu-btn" data-action="toggle-actions-menu" data-type="combo" data-id="${combo.id}" data-nome="${combo.nome}">⋮</button>
                    </div>
                </div>
            `;
            gerenciadorCombos.appendChild(cardDiv);
        });
    }

    function renderizarRegrasCombo() {
        const container = document.getElementById('regras-container');
        container.innerHTML = '<h4>Regras Atuais:</h4>';
        if (regrasTemporarias.length === 0) {
            container.innerHTML += '<p>Nenhuma regra adicionada.</p>';
            return;
        }
        const lista = document.createElement('ul');
        lista.className = 'regras-lista';
        regrasTemporarias.forEach((regra, index) => {
            let nomeAlvo = '';
            if (regra.setor_id_alvo) {
                const setor = cache.setores.find(s => s.id == regra.setor_id_alvo);
                nomeAlvo = `Setor: ${setor ? setor.nome : 'Desconhecido'}`;
            } else if (regra.produto_base_id_alvo) {
                const produto = cache.produtos.find(p => p.id == regra.produto_base_id_alvo);
                nomeAlvo = `Produto: ${produto ? produto.nome : 'Desconhecido'}`;
            }
            const upchargeTexto = regra.upcharge > 0 ? ` (Acréscimo: R$ ${Number(regra.upcharge).toFixed(2).replace('.',',')})` : '';
            lista.innerHTML += `
                <li>
                    <span>${nomeAlvo}${upchargeTexto}</span>
                    <button type="button" class="delete-btn btn-sm" data-action="remover-regra" data-index="${index}">Remover</button>
                </li>
            `;
        });
        container.appendChild(lista);
    }
    
    // --- LÓGICA DOS MODAIS E FORMULÁRIOS ---
    function abrirModalProdutoBase(id = null) {
        const form = document.getElementById('form-produto-base');
        const dropdownSetores = document.getElementById('pb-setor');
        dropdownSetores.innerHTML = cache.setores.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
        form.reset();
        document.getElementById('pb-id').value = '';
        if (id) {
            const pb = cache.produtos.find(p => p.id === id);
            document.getElementById('form-pb-title').innerText = 'Editando Produto Base';
            document.getElementById('pb-id').value = pb.id;
            document.getElementById('pb-nome').value = pb.nome;
            document.getElementById('pb-descricao').value = pb.descricao;
            document.getElementById('pb-setor').value = pb.setor_id;
        } else {
            document.getElementById('form-pb-title').innerText = 'Cadastrar Novo Produto Base';
        }
        document.getElementById('modal-produto-base').style.display = 'flex';
    }

    function abrirModalVariacao(id = null, produtoBaseId) {
        const form = document.getElementById('form-variacao');
        form.reset();
        document.getElementById('v-id').value = '';
        document.getElementById('v-pb-id').value = produtoBaseId;
        if (id) {
            const pb = cache.produtos.find(p => p.id === produtoBaseId);
            const variacao = pb.variacoes.find(v => v.id === id);
            document.getElementById('form-v-title').innerText = 'Editando Variação';
            document.getElementById('v-id').value = variacao.id;
            document.getElementById('v-nome').value = variacao.nome;
            document.getElementById('v-preco').value = variacao.preco;
        } else {
            const pb = cache.produtos.find(p => p.id === produtoBaseId);
            document.getElementById('form-v-title').innerText = `Adicionar Variação para: ${pb.nome}`;
        }
        document.getElementById('modal-variacao').style.display = 'flex';
    }

    function abrirModalCombo(id = null) {
        regrasTemporarias = [];
        const form = document.getElementById('form-combo');
        form.reset();
        document.getElementById('combo-id').value = '';
        
        const setorSelect = document.getElementById('regra-setor-alvo');
        const produtoSelect = document.getElementById('regra-produto-alvo');
        setorSelect.innerHTML = cache.setores.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
        produtoSelect.innerHTML = cache.produtos.map(p => `<option value="${p.id}">${p.nome}</option>`).join('');

        if (id) {
            const combo = cache.combos.find(c => c.id === id);
            document.getElementById('form-combo-title').innerText = 'Editando Combo';
            document.getElementById('combo-id').value = combo.id;
            document.getElementById('combo-nome').value = combo.nome;
            document.getElementById('combo-descricao').value = combo.descricao;
            document.getElementById('combo-preco').value = combo.preco_base;
            document.getElementById('combo-qtd-itens').value = combo.quantidade_itens_obrigatoria;
            document.getElementById('combo-ativo').value = String(combo.ativo);
            regrasTemporarias = combo.regras ? JSON.parse(JSON.stringify(combo.regras)) : [];
        } else {
            document.getElementById('form-combo-title').innerText = 'Criar Novo Combo';
            regrasTemporarias = [];
        }

        renderizarRegrasCombo();
        toggleRegraInputs();
        document.getElementById('modal-combo').style.display = 'flex';
    }

    async function handleFormProdutoSubmit(e) {
        e.preventDefault(); 
        const id = document.getElementById('pb-id').value;
        const formData = new FormData(e.target);
        const method = id ? 'PUT' : 'POST'; 
        const url = id ? `${backendUrl}/produtos_base/${id}` : `${backendUrl}/produtos_base`; 
        try { 
            const response = await fetchProtegido(url, { method, body: formData }); 
            if (!response.ok) throw new Error((await response.json()).error); 
            fecharModais(); 
            await carregarTudo(); 
            mostrarToast(`Produto base ${id ? 'atualizado' : 'criado'}!`, 'sucesso'); 
        } catch (error) { mostrarToast(`Erro: ${error.message}`, 'erro'); }
    }
    
    async function handleFormVariacaoSubmit(e) {
        e.preventDefault(); 
        const id = document.getElementById('v-id').value;
        const data = { 
            produto_base_id: document.getElementById('v-pb-id').value, 
            nome: document.getElementById('v-nome').value, 
            preco: document.getElementById('v-preco').value, 
            slug: gerarSlug(document.getElementById('v-nome').value) 
        };
        const method = id ? 'PUT' : 'POST'; 
        const url = id ? `${backendUrl}/variacoes/${id}` : `${backendUrl}/variacoes`; 
        try { 
            const response = await fetchProtegido(url, { method, body: JSON.stringify(data) }); 
            if (!response.ok) throw new Error((await response.json()).error); 
            fecharModais(); 
            await carregarTudo(); 
            mostrarToast(`Variação ${id ? 'atualizada' : 'criada'}!`, 'sucesso'); 
        } catch (error) { mostrarToast(`Erro: ${error.message}`, 'erro'); }
    }

    async function handleFormSetorSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('setor-id').value;
        const nome = document.getElementById('nome-setor').value;
        if (!nome) return;
        const method = id ? 'PUT' : 'POST';
        const url = id ? `${backendUrl}/setores/${id}` : `${backendUrl}/setores`;
        try {
            await fetchProtegido(url, { method, body: JSON.stringify({ nome }) });
            document.getElementById('form-setor').reset();
            document.getElementById('setor-id').value = '';
            await carregarTudo();
        } catch(error) { mostrarToast(`Erro: ${error.message}`, 'erro'); }
    }

    async function handleFormComboSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('combo-id').value;
        const dados = {
            nome: document.getElementById('combo-nome').value,
            descricao: document.getElementById('combo-descricao').value,
            preco_base: document.getElementById('combo-preco').value,
            quantidade_itens_obrigatoria: document.getElementById('combo-qtd-itens').value,
            ativo: document.getElementById('combo-ativo').value === 'true',
            regras: regrasTemporarias,
        };
        const imagemFile = document.getElementById('combo-imagem').files[0];
        
        const formData = new FormData();
        formData.append('dados', JSON.stringify(dados));
        if (imagemFile) {
            formData.append('imagem', imagemFile);
        }

        const method = id ? 'PUT' : 'POST';
        const url = id ? `${backendUrl}/api/dashboard/combos/${id}` : `${backendUrl}/api/dashboard/combos`;

        try {
            const response = await fetchProtegido(url, { method, body: formData });
            if (!response.ok) throw new Error((await response.json()).error);
            fecharModais();
            await carregarTudo();
            mostrarToast(`Combo ${id ? 'atualizado' : 'criado'} com sucesso!`, 'sucesso');
        } catch (error) {
            mostrarToast(`Erro ao salvar combo: ${error.message}`, 'erro');
        }
    }

    // --- LÓGICA DE EVENTOS (AÇÕES) ---
    function handleAcoesProdutos(e) {
        const target = e.target;
        const button = target.closest('button');
        const header = target.closest('.produto-header');
        const action = button ? button.dataset.action : (header && !target.closest('.actions-cell') ? 'toggle-variacoes' : null);
        if (!action) return;
        if (action === 'toggle-actions-menu') {
            abrirMenuAcoes(button); return;
        }
        if(action !== 'toggle-variacoes') { fecharMenuAcoes(); }
        const id = parseInt(button?.dataset.id || header?.dataset.id);
        const allActions = {
            'toggle-variacoes': () => {
                const container = document.getElementById(`variacoes-pb-${id}`);
                const toggleIcon = header.querySelector('.produto-header-toggle');
                container.classList.toggle('hidden');
                toggleIcon.style.transform = container.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(90deg)';
            },
            'adicionar-variacao': () => abrirModalVariacao(null, id),
            'salvar-estoque': async () => {
                const input = document.getElementById(`estoque-v-${id}`);
                const quantidade = input.value;
                try {
                    await fetchProtegido(`${backendUrl}/variacao/estoque`, { method: 'POST', body: JSON.stringify({ id, quantidade: parseInt(quantidade) }) });
                    mostrarToast('Estoque atualizado!', 'sucesso');
                    const variacao = cache.produtos.flatMap(p => p.variacoes).find(v => v.id === id);
                    if(variacao) variacao.quantidade_estoque = parseInt(quantidade);
                } catch (error) { mostrarToast(`Erro: ${error.message}`, 'erro'); }
            },
            'stock-minus': () => {
                const input = document.getElementById(`estoque-v-${id}`);
                if (input && parseInt(input.value) > 0) input.value = parseInt(input.value) - 1;
            },
            'stock-plus': () => {
                const input = document.getElementById(`estoque-v-${id}`);
                if (input) input.value = parseInt(input.value) + 1;
            },
        };
        if (allActions[action]) allActions[action]();
    }
    
    function handleAcoesCombos(e) {
        const button = e.target.closest('button');
        const header = e.target.closest('.produto-header');
        if (!button && !header) return;
        const id = parseInt(button?.dataset.id || header?.dataset.id);
        let action = button?.dataset.action;
        if (!action && header && !e.target.closest('.actions-cell')) { action = 'editar-combo'; }
        if (!action) return;
        if (action === 'toggle-actions-menu') {
            abrirMenuAcoes(button);
        } else if (action === 'editar-combo') {
            abrirModalCombo(id);
        }
    }

    function handleAcoesSetor(e) {
        const target = e.target.closest('button');
        if (!target) return;
        const action = target.dataset.action;
        const id = parseInt(target.dataset.id);
        const nome = target.dataset.nome;
        if (action === 'editar-setor') {
            document.getElementById('setor-id').value = id;
            document.getElementById('nome-setor').value = nome;
            document.getElementById('nome-setor').focus();
        } else if (action === 'excluir-setor') {
             if (!confirm(`Tem certeza que deseja excluir o setor "${nome}"?`)) return;
             fetchProtegido(`${backendUrl}/setores/${id}`, { method: 'DELETE' }).then(carregarTudo).catch(err => mostrarToast(err.message, 'erro'));
        }
    }

    function handleMenuAcoesClick(e) {
        const button = e.target.closest('button');
        if (!button) return;
        const { action, id, pbId, nome } = button.dataset;
        const actions = {
            'editar-produto_base': () => abrirModalProdutoBase(parseInt(id)),
            'duplicar-produto_base': () => fetchProtegido(`${backendUrl}/produtos_base/${id}/duplicar`, { method: 'POST' }).then(carregarTudo).catch(err => mostrarToast(err.message, 'erro')),
            'excluir-produto_base': () => {
                if(confirm(`Excluir "${nome}" e todas as suas variações?`)) 
                fetchProtegido(`${backendUrl}/produtos_base/${id}`, { method: 'DELETE' }).then(carregarTudo).catch(err => mostrarToast(err.message, 'erro'));
            },
            'editar-variacao': () => abrirModalVariacao(parseInt(id), parseInt(pbId)),
            'duplicar-variacao': () => fetchProtegido(`${backendUrl}/variacoes/${id}/duplicar`, { method: 'POST' }).then(carregarTudo).catch(err => mostrarToast(err.message, 'erro')),
            'excluir-variacao': () => {
                if(confirm(`Excluir a variação "${nome}"?`))
                fetchProtegido(`${backendUrl}/variacoes/${id}`, { method: 'DELETE' }).then(carregarTudo).catch(err => mostrarToast(err.message, 'erro'));
            },
            'editar-combo': () => abrirModalCombo(parseInt(id)),
            'excluir-combo': () => {
                 if(confirm(`Excluir o combo "${nome}"?`))
                 fetchProtegido(`${backendUrl}/api/dashboard/combos/${id}`, { method: 'DELETE' }).then(carregarTudo).catch(err => mostrarToast(err.message, 'erro'));
            }
        };
        if (actions[action]) {
            actions[action]();
            fecharMenuAcoes();
        }
    }
    
    function adicionarRegra() {
        const tipo = document.getElementById('regra-tipo').value;
        const upcharge = parseFloat(document.getElementById('regra-upcharge').value) || 0;
        let novaRegra = { upcharge };
        if (tipo === 'setor') {
            novaRegra.setor_id_alvo = parseInt(document.getElementById('regra-setor-alvo').value);
        } else {
            novaRegra.produto_base_id_alvo = parseInt(document.getElementById('regra-produto-alvo').value);
        }
        regrasTemporarias.push(novaRegra);
        renderizarRegrasCombo();
    }

    function handleAcaoRegra(e){
        const button = e.target.closest('button');
        if(!button || button.dataset.action !== 'remover-regra') return;
        const index = parseInt(button.dataset.index);
        regrasTemporarias.splice(index, 1);
        renderizarRegrasCombo();
    }
    
    function toggleRegraInputs(){
        const tipo = document.getElementById('regra-tipo').value;
        document.getElementById('group-regra-setor').style.display = tipo === 'setor' ? 'block' : 'none';
        document.getElementById('group-regra-produto').style.display = tipo === 'produto' ? 'block' : 'none';
    }

    // --- FUNÇÕES UTILITÁRIAS ---
    function fecharModais() {
        regrasTemporarias = [];
        document.querySelectorAll('.modal-backdrop').forEach(m => m.style.display = 'none');
    }
    function mostrarToast(mensagem, tipo = 'sucesso') {
        const toast = document.getElementById('toast-notification');
        toast.textContent = mensagem; toast.className = 'toast';
        toast.classList.add(tipo, 'show');
        setTimeout(() => { toast.classList.remove('show');}, 3000);
    }
    function setupTabs() {
        const tabButtons = document.querySelectorAll('.tab-button');
        const tabContents = document.querySelectorAll('.tab-content');
        tabButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const targetTabId = button.dataset.tab;
                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabContents.forEach(content => {
                    content.style.display = 'none';
                    content.classList.remove('active');
                });
                button.classList.add('active');
                const targetContent = document.getElementById(targetTabId);
                targetContent.style.display = 'block';
                targetContent.classList.add('active');
            });
        });
        if(document.querySelector('.tab-button')) {
            document.querySelector('.tab-button').click();
        }
    }
    function inicializarDragAndDrop() {
        const container = document.getElementById('gerenciador-produtos');
        if (sortable) sortable.destroy();
        sortable = new Sortable(container, {
            animation: 150, handle: '.produto-header',
            onEnd: async (evt) => {
                const newOrder = [...container.children].map(card => card.dataset.produtoBaseId);
                try {
                    await fetchProtegido(`${backendUrl}/dashboard/produtos/reordenar`, { method: 'POST', body: JSON.stringify({ order: newOrder }) });
                    mostrarToast('Ordem salva!', 'sucesso');
                } catch (error) { mostrarToast('Erro ao salvar ordem.', 'erro'); carregarTudo(); }
            }
        });
    }
     function abrirMenuAcoes(targetButton) {
        const type = targetButton.dataset.type;
        const id = parseInt(targetButton.dataset.id);
        const pbId = parseInt(targetButton.dataset.pbId);
        const nome = targetButton.dataset.nome;
    
        globalActionsMenu.innerHTML = '';
        
        let actionsHtml = '';
        if (type === 'produto_base') {
            actionsHtml = `<button data-action="editar-produto_base" data-id="${id}">Editar</button><button data-action="duplicar-produto_base" data-id="${id}" data-nome="${nome}">Duplicar</button><button data-action="excluir-produto_base" data-id="${id}" data-nome="${nome}">Remover</button>`;
        } else if (type === 'variacao') {
            actionsHtml = `<button data-action="editar-variacao" data-id="${id}" data-pb-id="${pbId}">Editar</button><button data-action="duplicar-variacao" data-id="${id}" data-nome="${nome}">Duplicar</button><button data-action="excluir-variacao" data-id="${id}" data-nome="${nome}">Remover</button>`;
        } else if (type === 'combo') {
             actionsHtml = `<button data-action="editar-combo" data-id="${id}">Editar</button><button data-action="excluir-combo" data-id="${id}" data-nome="${nome}">Remover</button>`;
        }
        globalActionsMenu.innerHTML = actionsHtml;

        const rect = targetButton.getBoundingClientRect();
        globalActionsMenu.style.display = 'block';
        globalActionsMenu.style.top = `${window.scrollY + rect.bottom}px`;
        globalActionsMenu.style.left = `${rect.right - globalActionsMenu.offsetWidth}px`;
    }

    function fecharMenuAcoes() {
        if (globalActionsMenu) globalActionsMenu.style.display = 'none';
    }

    function verificarSessao() {
        const token = localStorage.getItem('authToken');
        if (token) {
            mostrarDashboard();
        } else {
            mostrarLogin();
        }
    }

    // --- INICIALIZAÇÃO ---
    init();
});