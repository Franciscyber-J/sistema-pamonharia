document.addEventListener('DOMContentLoaded', () => {
    // --- ELEMENTOS E VARIÁVEIS GLOBAIS ---
    const backendUrl = 'https://pamonharia-servidor.onrender.com';
    let cache = { produtos: [], setores: [] };
    let sortable = null;

    // Elementos do DOM
    const loginContainer = document.getElementById('login-container');
    const dashboardContainer = document.getElementById('dashboard-container');
    const loginForm = document.getElementById('form-login');
    const loginError = document.getElementById('login-error');
    const btnLogout = document.getElementById('btn-logout');
    const toggleSenhaBtn = document.getElementById('toggle-senha');
    const loginSenhaInput = document.getElementById('login-senha');
    const eyeOpenIcon = document.getElementById('eye-open');
    const eyeClosedIcon = document.getElementById('eye-closed');
    const globalActionsMenu = document.getElementById('global-actions-menu');
    const gerenciadorProdutos = document.getElementById('gerenciador-produtos');
    const btnAddProdutoBase = document.getElementById('btn-add-produto-base'); // <<-- Adicionado

    // --- LÓGICA DE AUTENTICAÇÃO E SESSÃO ---
    async function handleLogin(event) {
        event.preventDefault();
        loginError.textContent = '';
        const email = document.getElementById('login-email').value;
        const senha = loginSenhaInput.value;
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
            loginError.textContent = error.message;
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

    function toggleVisibilidadeSenha() {
        const isPassword = loginSenhaInput.type === 'password';
        loginSenhaInput.type = isPassword ? 'text' : 'password';
        eyeOpenIcon.style.display = isPassword ? 'none' : 'block';
        eyeClosedIcon.style.display = isPassword ? 'block' : 'none';
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
             if (el.classList.contains('tab-button') && !isOperador) {
                el.style.display = 'flex';
            }
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
    
    function verificarSessao() {
        const token = localStorage.getItem('authToken');
        if (token) {
            mostrarDashboard();
            carregarTudo();
        } else {
            mostrarLogin();
        }
    }
    
    function setupTabs() {
        const tabButtons = document.querySelectorAll('.tab-button');
        const tabContents = document.querySelectorAll('.tab-content');
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const targetTabId = button.dataset.tab;
                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabContents.forEach(content => content.style.display = 'none');
                button.classList.add('active');
                document.getElementById(targetTabId).style.display = 'block';
            });
        });
    }

    function setupModalCancelButtons() {
        const cancelButtons = document.querySelectorAll('.btn-modal-cancel');
        cancelButtons.forEach(button => {
            button.addEventListener('click', () => {
                fecharModais();
            });
        });
    }

    function mostrarToast(mensagem, tipo = 'sucesso') {
        const toast = document.getElementById('toast-notification');
        toast.textContent = mensagem;
        toast.className = 'toast';
        toast.classList.add(tipo, 'show');
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    function fecharModais() {
        document.querySelectorAll('.modal-backdrop').forEach(m => m.style.display = 'none');
    }

    function gerarSlug(texto) {
        if (!texto) return '';
        const a = 'àáâäæãåāăąçćčđďèéêëēėęěğǵḧîïíīįìłḿñńǹňôöòóœøōõőṕŕřßśšşșťțûüùúūǘůűųẃẍÿýžźż·/_,:;'
        const b = 'aaaaaaaaaacccddeeeeeeeegghiiiiiilmnnnnoooooooooprrssssssttuuuuuuuuuwxyyzzz------'
        const p = new RegExp(a.split('').join('|'), 'g')
        return texto.toString().toLowerCase()
            .replace(/\s+/g, '-')
            .replace(p, c => b.charAt(a.indexOf(c)))
            .replace(/&/g, '-e-')
            .replace(/[^\w\-]+/g, '')
            .replace(/\-\-+/g, '-')
            .replace(/^-+/, '')
            .replace(/-+$/, '')
    }

    async function carregarTudo() {
        try {
            const [setoresRes, produtosRes] = await Promise.all([
                fetchProtegido(`${backendUrl}/setores`),
                fetchProtegido(`${backendUrl}/dashboard/produtos`)
            ]);
            cache.setores = (await setoresRes.json()).data;
            cache.produtos = (await produtosRes.json()).data;
            renderizarGerenciadorProdutos();
            renderizarGerenciadorSetores();
            inicializarDragAndDrop();
            aplicarPermissoes();
        } catch (err) {
            mostrarToast(err.message, 'erro');
            console.error(err);
        }
    }

    function inicializarDragAndDrop() {
        const container = document.getElementById('gerenciador-produtos');
        if (sortable) sortable.destroy();
        sortable = new Sortable(container, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            handle: '.produto-header',
            onEnd: async function (evt) {
                const productCards = [...container.children];
                const newOrder = productCards.map(card => card.dataset.produtoBaseId);
                try {
                    const response = await fetchProtegido(`${backendUrl}/dashboard/produtos/reordenar`, {
                        method: 'POST',
                        body: JSON.stringify({ order: newOrder })
                    });
                    if (!response.ok) throw new Error('Falha ao salvar a ordem no servidor.');
                    mostrarToast('Ordem salva com sucesso!', 'sucesso');
                } catch (error) {
                    mostrarToast('Erro ao salvar nova ordem.', 'erro');
                    carregarTudo(); 
                }
            }
        });
    }

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
                        <button class="actions-menu-btn" data-action="toggle-actions-menu" data-type="base" data-id="${pb.id}" data-nome="${pb.nome}">⋮</button>
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
        document.getElementById('form-setor').addEventListener('submit', handleFormSetorSubmit);
        document.getElementById('lista-setores').addEventListener('click', handleAcoesSetor);
        document.getElementById('btn-limpar-form-setor').addEventListener('click', () => {
              document.getElementById('form-setor').reset();
              document.getElementById('setor-id').value = '';
        });
    }

    function abrirModalProdutoBase(id = null) {
        const form = document.getElementById('form-produto-base');
        const title = document.getElementById('form-pb-title');
        const dropdownSetores = document.getElementById('pb-setor');
        dropdownSetores.innerHTML = '';
        cache.setores.forEach(s => dropdownSetores.innerHTML += `<option value="${s.id}">${s.nome}</option>`);
        form.reset();
        document.getElementById('pb-id').value = '';
        if (id) {
            const pb = cache.produtos.find(p => p.id === id);
            title.innerText = 'Editando Produto Base';
            document.getElementById('pb-id').value = pb.id;
            document.getElementById('pb-nome').value = pb.nome;
            document.getElementById('pb-descricao').value = pb.descricao;
            document.getElementById('pb-setor').value = pb.setor_id;
            document.getElementById('pb-slug').value = pb.slug || gerarSlug(pb.nome);
        } else {
            title.innerText = 'Cadastrar Novo Produto Base';
        }
        document.getElementById('modal-produto-base').style.display = 'flex';
    }

    function abrirModalVariacao(id = null, produtoBaseId) {
        const form = document.getElementById('form-variacao');
        const title = document.getElementById('form-v-title');
        form.reset();
        document.getElementById('v-id').value = '';
        document.getElementById('v-pb-id').value = produtoBaseId;
        if (id) {
            const pb = cache.produtos.find(p => p.id === produtoBaseId);
            const variacao = pb.variacoes.find(v => v.id === id);
            title.innerText = 'Editando Variação';
            document.getElementById('v-id').value = variacao.id;
            document.getElementById('v-nome').value = variacao.nome;
            document.getElementById('v-preco').value = variacao.preco;
            document.getElementById('v-slug').value = variacao.slug;
        } else {
            const pb = cache.produtos.find(p => p.id === produtoBaseId);
            title.innerText = `Adicionar Variação para: ${pb.nome}`;
        }
        document.getElementById('modal-variacao').style.display = 'flex';
    }
    
    async function handleFormSetorSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('setor-id').value;
        const nome = document.getElementById('nome-setor').value;
        if (!nome) return alert('O nome do setor não pode ser vazio.');
        const method = id ? 'PUT' : 'POST';
        const url = id ? `${backendUrl}/setores/${id}` : `${backendUrl}/setores`;
        try {
            const response = await fetchProtegido(url, { method, body: JSON.stringify({ nome }) });
            if (!response.ok) throw new Error((await response.json()).error);
            document.getElementById('form-setor').reset();
            document.getElementById('setor-id').value = '';
            await carregarTudo();
        } catch(error) {
            mostrarToast(`Erro: ${error.message}`, 'erro');
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
            excluirSetor(id, nome);
        }
    }
    
    async function excluirProdutoBase(id, nome){
        if (!confirm(`Tem certeza que deseja excluir o produto base "${nome}" e TODAS as suas variações?`)) return;
        await fetchProtegido(`${backendUrl}/produtos_base/${id}`, { method: 'DELETE' });
        await carregarTudo();
        mostrarToast(`Produto "${nome}" excluído.`, 'sucesso');
    }

    async function excluirVariacao(id, nome){
        if (!confirm(`Tem certeza que deseja excluir a variação "${nome}"?`)) return;
        await fetchProtegido(`${backendUrl}/variacoes/${id}`, { method: 'DELETE' });
        await carregarTudo();
        mostrarToast(`Variação "${nome}" excluída.`, 'sucesso');
    }

    async function excluirSetor(id, nome){
        if (!confirm(`Tem certeza que deseja excluir o setor "${nome}"?`)) return;
        try {
            const response = await fetchProtegido(`${backendUrl}/setores/${id}`, { method: 'DELETE' });
            if (!response.ok) throw new Error((await response.json()).error);
            await carregarTudo();
            mostrarToast(`Setor "${nome}" excluído.`, 'sucesso');
        } catch (error) {
            alert('Erro ao excluir setor: ' + error.message);
        }
    }

    async function duplicarProdutoBase(id, nome){
        if (!confirm(`Tem certeza que deseja duplicar o produto "${nome}" e todas as suas variações?`)) return;
        try {
            const response = await fetchProtegido(`${backendUrl}/produtos_base/${id}/duplicar`, { method: 'POST' });
            if (!response.ok) throw new Error((await response.json()).error);
            mostrarToast(`Produto "${nome}" duplicado com sucesso!`, 'sucesso');
            await carregarTudo();
        } catch(error) {
            mostrarToast(`Erro ao duplicar: ${error.message}`, 'erro');
        }
    }

    async function duplicarVariacao(id, nome){
        if (!confirm(`Tem certeza que deseja duplicar a variação "${nome}"?`)) return;
        try {
            const response = await fetchProtegido(`${backendUrl}/variacoes/${id}/duplicar`, { method: 'POST' });
            if (!response.ok) throw new Error((await response.json()).error);
            mostrarToast(`Variação "${nome}" duplicada com sucesso!`, 'sucesso');
            await carregarTudo();
        } catch(error) {
            mostrarToast(`Erro ao duplicar: ${error.message}`, 'erro');
        }
    }

    async function atualizarEstoque(variacaoId){
        const input = document.getElementById(`estoque-v-${variacaoId}`);
        const quantidade = input.value;
        if (quantidade === '' || parseInt(quantidade) < 0) {
            return mostrarToast('Insira um valor de estoque válido.', 'erro');
        }
        try {
            const response = await fetchProtegido(`${backendUrl}/variacao/estoque`, { 
                method: 'POST', 
                body: JSON.stringify({ id: variacaoId, quantidade: parseInt(quantidade) }) 
            });
            if (!response.ok) throw new Error((await response.json()).error);
            mostrarToast('Estoque atualizado!', 'sucesso');
            const produtoBase = cache.produtos.find(p => p.variacoes.some(v => v.id === variacaoId));
            const variacao = produtoBase.variacoes.find(v => v.id === variacaoId);
            variacao.quantidade_estoque = parseInt(quantidade);
            const linha = input.closest('tr');
            if (variacao.quantidade_estoque === 0) {
                linha.classList.add('variacao-esgotada');
            } else {
                linha.classList.remove('variacao-esgotada');
            }
        } catch (error) {
            mostrarToast(`Erro ao atualizar estoque: ${error.message}`, 'erro');
            carregarTudo();
        }
    }
    
    function abrirMenuAcoes(targetButton) {
        const type = targetButton.dataset.type;
        const id = parseInt(targetButton.dataset.id);
        const pbId = parseInt(targetButton.dataset.pbId);
        const nome = targetButton.dataset.nome;
    
        globalActionsMenu.innerHTML = '';
    
        if (type === 'base') {
            globalActionsMenu.innerHTML = `
                <button data-action="editar-base" data-id="${id}">Editar</button>
                <button data-action="duplicar-base" data-id="${id}" data-nome="${nome}">Duplicar</button>
                <button data-action="excluir-base" data-id="${id}" data-nome="${nome}">Remover</button>
            `;
        } else if (type === 'variacao') {
            globalActionsMenu.innerHTML = `
                <button data-action="editar-variacao" data-id="${id}" data-pb-id="${pbId}">Editar</button>
                <button data-action="duplicar-variacao" data-id="${id}" data-nome="${nome}">Duplicar</button>
                <button data-action="excluir-variacao" data-id="${id}" data-nome="${nome}">Remover</button>
            `;
        }
    
        const rect = targetButton.getBoundingClientRect();
        globalActionsMenu.style.display = 'block';
        globalActionsMenu.style.top = `${window.scrollY + rect.bottom}px`;
        globalActionsMenu.style.left = `${rect.left}px`;
    }

    function fecharMenuAcoes() {
        if (globalActionsMenu) {
            globalActionsMenu.style.display = 'none';
        }
    }

    // --- INICIALIZAÇÃO E EVENT LISTENERS ---
    
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.actions-menu-btn') && !e.target.closest('#global-actions-menu')) {
            fecharMenuAcoes();
        }
    });

    // <<-- CORREÇÃO APLICADA AQUI -->>
    btnAddProdutoBase.addEventListener('click', () => {
        abrirModalProdutoBase();
    });

    gerenciadorProdutos.addEventListener('click', (e) => {
        const target = e.target;
        const button = target.closest('button');
        const header = target.closest('.produto-header');

        const action = button ? button.dataset.action : (header && !target.closest('.actions-cell') ? 'toggle-variacoes' : null);
        
        if (!action) return;
        
        if (action === 'toggle-actions-menu') {
            e.stopPropagation();
            const isVisible = globalActionsMenu.style.display === 'block';
            const alreadyTargeted = globalActionsMenu.dataset.ownerId === button.dataset.id;
            
            if (isVisible && alreadyTargeted) {
                fecharMenuAcoes();
            } else {
                globalActionsMenu.dataset.ownerId = button.dataset.id;
                abrirMenuAcoes(button);
            }
            return;
        }

        if(action !== 'toggle-variacoes') {
             fecharMenuAcoes();
        }

        const id = button ? parseInt(button.dataset.id) : (header ? parseInt(header.dataset.id) : null);
        const pbId = button ? parseInt(button.dataset.pbId) : null;
        const nome = button ? button.dataset.nome : null;

        const allActions = {
            'toggle-variacoes': () => {
                const container = document.getElementById(`variacoes-pb-${id}`);
                const toggleIcon = header.querySelector('.produto-header-toggle');
                if (container && toggleIcon) {
                    container.classList.toggle('hidden');
                    toggleIcon.style.transform = container.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(90deg)';
                }
            },
            'adicionar-variacao': () => abrirModalVariacao(null, id),
            'salvar-estoque': () => atualizarEstoque(id),
            'stock-minus': () => {
                const input = document.getElementById(`estoque-v-${id}`);
                if (input && parseInt(input.value) > 0) input.value = parseInt(input.value) - 1;
            },
            'stock-plus': () => {
                const input = document.getElementById(`estoque-v-${id}`);
                if (input) input.value = parseInt(input.value) + 1;
            },
        };

        if (allActions[action]) {
            allActions[action]();
        }
    });

    globalActionsMenu.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button) return;
        
        const action = button.dataset.action;
        const id = parseInt(button.dataset.id);
        const pbId = parseInt(button.dataset.pbId);
        const nome = button.dataset.nome;
        
        const menuActions = {
            'editar-base': () => abrirModalProdutoBase(id),
            'duplicar-base': () => duplicarProdutoBase(id, nome),
            'excluir-base': () => excluirProdutoBase(id, nome),
            'editar-variacao': () => abrirModalVariacao(id, pbId),
            'duplicar-variacao': () => duplicarVariacao(id, nome),
            'excluir-variacao': () => excluirVariacao(id, nome)
        };
        
        if (menuActions[action]) {
            menuActions[action]();
            fecharMenuAcoes();
        }
    });
    
    document.getElementById('form-produto-base').addEventListener('submit', async (e) => { e.preventDefault(); const id = document.getElementById('pb-id').value; const formData = new FormData(e.target); const method = id ? 'PUT' : 'POST'; const url = id ? `${backendUrl}/produtos_base/${id}` : `${backendUrl}/produtos_base`; try { const response = await fetchProtegido(url, { method, body: formData }); if (!response.ok) throw new Error((await response.json()).error); fecharModais(); await carregarTudo(); mostrarToast(`Produto base ${id ? 'atualizado' : 'criado'}!`, 'sucesso'); } catch (error) { mostrarToast(`Erro: ${error.message}`, 'erro'); } });
    document.getElementById('form-variacao').addEventListener('submit', async (e) => { e.preventDefault(); const id = document.getElementById('v-id').value; const data = { produto_base_id: document.getElementById('v-pb-id').value, nome: document.getElementById('v-nome').value, preco: document.getElementById('v-preco').value, slug: gerarSlug(document.getElementById('v-nome').value) }; const method = id ? 'PUT' : 'POST'; const url = id ? `${backendUrl}/variacoes/${id}` : `${backendUrl}/variacoes`; try { const response = await fetchProtegido(url, { method, body: JSON.stringify(data) }); if (!response.ok) throw new Error((await response.json()).error); fecharModais(); await carregarTudo(); mostrarToast(`Variação ${id ? 'atualizada' : 'criada'}!`, 'sucesso'); } catch (error) { mostrarToast(`Erro: ${error.message}`, 'erro'); } });

    setupTabs();
    setupModalCancelButtons();
    loginForm.addEventListener('submit', handleLogin);
    btnLogout.addEventListener('click', handleLogout);
    toggleSenhaBtn.addEventListener('click', toggleVisibilidadeSenha);
    
    verificarSessao();
});