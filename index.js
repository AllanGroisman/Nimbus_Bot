// index.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const { CONFIG, setGeral, addGrupo, setGrupo, encontrarIdPorNome } = require('./config');
const { salvarNoHistorico } = require('./memoria');
const mercadolivre = require('./scrapers/mercadolivre');

const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { args: ['--no-sandbox'] }
});

// ==========================================
// MOTOR DE MÚLTIPLOS GRUPOS 
// ==========================================
async function rodarRoboDeOfertas(idGrupoEspecifico = null) {
    let idsDosGrupos = Object.keys(CONFIG.GRUPOS);

    if (idGrupoEspecifico) {
        idsDosGrupos = [idGrupoEspecifico];
        console.log('🚀 Iniciando o robô de ofertas para um GRUPO ESPECÍFICO...');
    } else {
        console.log('🚀 Iniciando o robô de ofertas para TODOS os grupos cadastrados...');
    }

    if (idsDosGrupos.length === 0) {
        console.log('⚠️ Nenhum grupo de clientes cadastrado.');
        return;
    }

    for (const idGrupo of idsDosGrupos) {
        const regrasDoGrupo = CONFIG.GRUPOS[idGrupo];
        console.log(`\n📦 Processando envio para o Grupo: ${regrasDoGrupo.NOME} | Categoria: ${regrasDoGrupo.CATEGORIA_ESCOLHIDA}`);

        await client.sendMessage(idGrupo, `⏳ Pessoal, garimpando as melhores ofertas da categoria ${regrasDoGrupo.CATEGORIA_ESCOLHIDA}...`);

        const produtos = await mercadolivre.buscarOfertasML(regrasDoGrupo);

        if (produtos.length === 0) {
            await client.sendMessage(idGrupo, 'Poxa, não encontrei ofertas inéditas que batessem com os filtros agora. Tente mais tarde!');
            continue;
        }

        for (let i = 0; i < produtos.length; i++) {
            const produto = produtos[i];
            const linkComissionado = await mercadolivre.gerarLinkAfiliadoML(produto.linkOriginal);

            let linhaPreco = `💰 *Preço:* R$ ${produto.preco}`;
            if (produto.precoAntigo) linhaPreco = `💰 *Preço:* De ~R$ ${produto.precoAntigo}~ por *R$ ${produto.preco}*`;

            const textoMensagem = `🔥 *OFERTA ENCONTRADA* 🔥\n\n📦 *Produto:* ${produto.titulo}\n⭐ *Nota:* ${produto.nota} (${produto.vendas}+ vendidos)\n📉 *Desconto:* ${produto.desconto}% OFF\n${linhaPreco}\n\n🛒 *Compre aqui:* ${linkComissionado}`;

            const chat = await client.getChatById(idGrupo);

            // 🛡️ ANTI-BAN 1: HUMANIZAÇÃO DAS MENSAGENS (DUAS MARCHAS)
            const tempoBase = regrasDoGrupo.INTERVALO_MENSAGENS_SEGUNDOS;
            let variacaoEmSegundos = 0;

            if (tempoBase >= 300) {
                // MARCHA ALTA: Se o intervalo for de 5 minutos ou mais
                // Sorteia um atraso entre 60 e 180 segundos (1 a 3 minutos)
                variacaoEmSegundos = Math.floor(Math.random() * 121) + 60;
            } else {
                // MARCHA BAIXA: Se o intervalo for curtinho (ex: 15s)
                // Sorteia um atraso entre 2 e 12 segundos
                variacaoEmSegundos = Math.floor(Math.random() * 11) + 2;
            }

            const tempoFinal = tempoBase + variacaoEmSegundos;

            console.log(`   ⏳ Aguardando ${tempoFinal} segundos (Base: ${tempoBase}s + Atraso Humano: ${variacaoEmSegundos}s)...`);

            await chat.sendStateTyping(); // Fica "digitando" para dar mais realismo
            await esperar(tempoFinal * 1000);

            await client.sendMessage(idGrupo, textoMensagem);
            salvarNoHistorico(produto.linkLimpo);
        }
        await client.sendMessage(idGrupo, '🎉 Fim das ofertas dessa rodada. Aproveitem!');
    }
    console.log('🏁 Processo finalizado com sucesso.');
}

// Eventos de Conexão
client.on('qr', (qr) => qrcode.generate(qr, { small: true }));

client.on('ready', () => {
    console.log('✅ Bot conectado e pronto!');

    if (CONFIG.GERAL.PILOTO_AUTOMATICO_LIGADO) {
        console.log(`🤖 Piloto Automático ON! Iniciando ciclo...`);

        // 🛡️ ANTI-BAN 2: HUMANIZAÇÃO DO PILOTO AUTOMÁTICO
        // Em vez de usar um setInterval duro, criamos uma função que se agenda sozinha com tempos variados
        const agendarProximaRodada = () => {
            const horasBase = CONFIG.GERAL.INTERVALO_ROBO_HORAS;
            const msBase = horasBase * 60 * 60 * 1000;

            // Cria uma variação aleatória de até 20 minutos (para mais ou para menos)
            const variacaoMs = (Math.floor(Math.random() * 40) - 20) * 60 * 1000;
            const proximoVoo = msBase + variacaoMs;

            const minutosAteProximoVoo = (proximoVoo / 1000 / 60).toFixed(0);
            console.log(`⏰ Piloto Automático: Próxima rodada agendada para daqui a aprox. ${minutosAteProximoVoo} minutos (Camuflagem ativada).`);

            setTimeout(async () => {
                await rodarRoboDeOfertas();
                agendarProximaRodada(); // Ao terminar a rodada, ele joga o dado e agenda a próxima
            }, proximoVoo);
        };

        // Dá a primeira partida no agendamento
        agendarProximaRodada();
    }
});

// ==========================================
// O NOVO PAINEL DE CONTROLE 
// ==========================================
client.on('message_create', async msg => {

    // 🛠️ Descobrir ID
    if (msg.body === '!idgrupo') {
        const chat = await msg.getChat();
        return msg.reply(`🤖 ID deste chat:\n*${chat.id._serialized}*`);
    }

    // 🛡️ TRAVA DE SEGURANÇA
    if (msg.from !== CONFIG.GERAL.ID_GRUPO_ADMIN && msg.to !== CONFIG.GERAL.ID_GRUPO_ADMIN) return;

    // 🎯 1. GATILHO (GERAL OU ESPECÍFICO)
    if (msg.body.startsWith('!ofertas')) {
        const partes = msg.body.split(' ');

        if (partes.length > 1) {
            const nomeAlvo = partes[1].toUpperCase();
            const idAlvo = encontrarIdPorNome(nomeAlvo);

            if (!idAlvo) return msg.reply(`❌ Não encontrei nenhum grupo chamado *${nomeAlvo}*.`);

            await msg.reply(`🫡 Iniciando a raspagem APENAS para o grupo *${nomeAlvo}*.`);
            await rodarRoboDeOfertas(idAlvo);
        } else {
            await msg.reply('🫡 Iniciando a raspagem para TODOS os grupos cadastrados.');
            await rodarRoboDeOfertas();
        }
    }

    // 🎯 2. ATUALIZAR COOKIE
    if (msg.body.startsWith('!cookie ')) {
        setGeral('COOKIE_ML', msg.body.replace('!cookie ', '').trim());
        await msg.reply('✅ Cookie atualizado!');
    }

    // 🎯 3. VER CONFIGURAÇÕES (GERAL E LISTA DE GRUPOS)
    if (msg.body === '!config') {
        let texto = '⚙️ *CONFIGURAÇÕES GERAIS:*\n';
        for (const [chave, valor] of Object.entries(CONFIG.GERAL)) {
            if (chave === 'COOKIE_ML') continue;
            texto += `*${chave}:* ${JSON.stringify(valor)}\n`;
        }
        texto += '\n📦 *GRUPOS ATIVOS:*\n';
        for (const [id, regras] of Object.entries(CONFIG.GRUPOS)) {
            texto += `🏷️ *${regras.NOME}* (ID: ${id})\n`;
        }
        texto += '\n_Use !resumo NOME_DO_GRUPO para ver os filtros dele._';
        await msg.reply(texto);
    }

    // 🎯 4. ADICIONAR GRUPO
    if (msg.body.startsWith('!addgrupo ')) {
        const partes = msg.body.split(' ');
        if (partes.length < 3) return msg.reply('❌ Formato: `!addgrupo [ID_DO_GRUPO] [NOME_CURTO]`\nEx: !addgrupo 123@g.us BEBES');

        const idNovo = partes[1];
        const nomeNovo = partes[2].toUpperCase();

        if (addGrupo(idNovo, nomeNovo)) {
            await msg.reply(`✅ Grupo *${nomeNovo}* adicionado! Use !template ${nomeNovo} para configurar os filtros.`);
        } else {
            await msg.reply(`⚠️ Este grupo já estava cadastrado.`);
        }
    }

    // 🎯 5. RENOMEAR GRUPO
    if (msg.body.startsWith('!renomear ')) {
        const partes = msg.body.split(' ');
        if (partes.length < 3) return msg.reply('❌ Formato: `!renomear NOME_ANTIGO NOME_NOVO`');

        const nomeAntigo = partes[1].toUpperCase();
        const nomeNovo = partes[2].toUpperCase();

        const idGrupo = encontrarIdPorNome(nomeAntigo);
        if (!idGrupo) return msg.reply(`❌ Não encontrei nenhum grupo chamado *${nomeAntigo}*.`);

        if (encontrarIdPorNome(nomeNovo)) return msg.reply(`❌ Já existe um grupo com o nome *${nomeNovo}*. Escolha outro.`);

        setGrupo(idGrupo, 'NOME', nomeNovo);
        await msg.reply(`✅ O grupo *${nomeAntigo}* foi renomeado para *${nomeNovo}* com sucesso!`);
    }

    // 🎯 6. RESUMO DE UM GRUPO ESPECÍFICO
    if (msg.body.startsWith('!resumo ')) {
        const nome = msg.body.replace('!resumo ', '').trim();
        const idGrupo = encontrarIdPorNome(nome);
        if (!idGrupo) return msg.reply(`❌ Não encontrei nenhum grupo chamado *${nome}*.`);

        const regras = CONFIG.GRUPOS[idGrupo];
        let texto = `📊 *FILTROS DO GRUPO: ${regras.NOME}*\n\n`;
        for (const [k, v] of Object.entries(regras)) {
            if (k === 'NOME') continue;
            texto += `*${k}:* ${JSON.stringify(v)}\n`;
        }
        await msg.reply(texto);
    }

    // 🎯 7. GERAR O TEMPLATE PARA EDIÇÃO EM MASSA
    if (msg.body.startsWith('!template ')) {
        const nome = msg.body.replace('!template ', '').trim();
        const idGrupo = encontrarIdPorNome(nome);
        if (!idGrupo) return msg.reply(`❌ Não encontrei nenhum grupo chamado *${nome}*.`);

        const regras = CONFIG.GRUPOS[idGrupo];
        let texto = `!update ${regras.NOME}\n`;
        for (const [k, v] of Object.entries(regras)) {
            if (k === 'NOME') continue;
            let valorEditavel = Array.isArray(v) ? v.join(', ') : v;
            texto += `${k}=${valorEditavel}\n`;
        }
        await msg.reply(`Copie a mensagem abaixo inteira, altere os valores depois do sinal de igual (=) e me envie de volta:\n\n${texto}`);
    }

    // 🎯 8. PROCESSAR A ATUALIZAÇÃO EM MASSA
    if (msg.body.startsWith('!update ')) {
        const linhas = msg.body.split('\n');
        const cabecalho = linhas[0].split(' ');
        if (cabecalho.length < 2) return;

        const nome = cabecalho[1];
        const idGrupo = encontrarIdPorNome(nome);
        if (!idGrupo) return msg.reply(`❌ Não encontrei nenhum grupo chamado *${nome}*.`);

        let atualizados = 0;
        for (let i = 1; i < linhas.length; i++) {
            const linha = linhas[i].trim();
            if (!linha || !linha.includes('=')) continue;

            const separadorIndex = linha.indexOf('=');
            const chave = linha.substring(0, separadorIndex).trim().toUpperCase();
            const valorBruto = linha.substring(separadorIndex + 1).trim();

            if (CONFIG.GRUPOS[idGrupo][chave] !== undefined) {
                let valorFinal = valorBruto;
                const tipoAtual = typeof CONFIG.GRUPOS[idGrupo][chave];
                const isArray = Array.isArray(CONFIG.GRUPOS[idGrupo][chave]);

                if (isArray) {
                    valorFinal = valorBruto.split(',').filter(x => x.trim() !== '').map(x => x.trim());
                } else if (tipoAtual === 'number') {
                    valorFinal = Number(valorBruto);
                    if (isNaN(valorFinal)) continue;
                } else if (tipoAtual === 'boolean') {
                    valorFinal = valorBruto.toLowerCase() === 'true';
                }

                setGrupo(idGrupo, chave, valorFinal);
                atualizados++;
            }
        }
        await msg.reply(`✅ Atualização em massa concluída! ${atualizados} configurações alteradas no grupo *${nome}*.`);
    }

    // 🎯 9. SET INDIVIDUAL 
    if (msg.body.startsWith('!setgrupo ')) {
        const partes = msg.body.split(' ');
        if (partes.length < 4) return msg.reply('❌ Formato: `!setgrupo NOME_DO_GRUPO CHAVE valor`');

        const nome = partes[1];
        const idGrupo = encontrarIdPorNome(nome);
        if (!idGrupo) return msg.reply(`❌ Não encontrei nenhum grupo chamado *${nome}*.`);

        const chave = partes[2].toUpperCase();
        let valorBruto = msg.body.substring(msg.body.indexOf(partes[3]));

        if (CONFIG.GRUPOS[idGrupo][chave] === undefined) return msg.reply(`❌ Regra inválida.`);

        let valorFinal = valorBruto;
        const tipoAtual = typeof CONFIG.GRUPOS[idGrupo][chave];

        if (Array.isArray(CONFIG.GRUPOS[idGrupo][chave])) {
            valorFinal = valorBruto.split(',').map(i => i.trim());
        } else if (tipoAtual === 'number') {
            valorFinal = Number(valorBruto);
        }

        setGrupo(idGrupo, chave, valorFinal);
        await msg.reply(`✅ O grupo *${nome}* teve a regra *${chave}* atualizada!`);
    }

    // 🎯 10. MANUAL DE INSTRUÇÕES (HELP)
    if (msg.body === '!help' || msg.body === '!ajuda') {
        const textoHelp = `🤖 *CENTRAL DE COMANDOS DO ROBÔ* 🤖

⚙️ *CONFIGURAÇÕES GERAIS*
*!idgrupo* - Descobre o ID do chat atual.
*!config* - Mostra as config globais e grupos ativos.
*!cookie [texto]* - Atualiza o cookie do ML.

📦 *GERENCIAMENTO DE GRUPOS*
*!addgrupo [ID] [NOME]* - Cadastra um novo grupo.
*!renomear [NOME_ANTIGO] [NOME_NOVO]* - Troca o apelido do grupo.
*!resumo [NOME]* - Mostra os filtros de um grupo.
*!template [NOME]* - Gera o formulário de edição em massa.
*!setgrupo [NOME] [REGRA] [VALOR]* - Altera uma regra específica.

🚀 *AÇÃO*
*!ofertas* - Roda todos os grupos na sequência.
*!ofertas [NOME]* - Roda apenas o grupo específico (Ex: !ofertas BEBE).`;

        await msg.reply(textoHelp);
    }
});

// ALTERAR CONFIGURAÇÕES GERAIS (Ex: !setgeral INTERVALO_ROBO_HORAS 3)
client.on('message_create', async msg => {
    if (msg.body.startsWith('!setgeral ') && (msg.from === CONFIG.GERAL.ID_GRUPO_ADMIN || msg.to === CONFIG.GERAL.ID_GRUPO_ADMIN)) {
        const partes = msg.body.split(' ');
        if (partes.length < 3) return msg.reply('❌ Formato: `!setgeral CHAVE valor`');

        const chave = partes[1].toUpperCase();
        let valorFinal = msg.body.substring(msg.body.indexOf(partes[2]));

        if (CONFIG.GERAL[chave] === undefined) return msg.reply(`❌ Chave geral inexistente.`);

        if (typeof CONFIG.GERAL[chave] === 'number') valorFinal = Number(valorFinal);
        if (typeof CONFIG.GERAL[chave] === 'boolean') valorFinal = valorFinal.toLowerCase() === 'true';

        setGeral(chave, valorFinal);
        await msg.reply(`✅ Config Geral *${chave}* atualizada!`);
    }
});

client.initialize();