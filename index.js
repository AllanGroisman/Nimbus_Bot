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

let roboOcupado = false; 

// ==========================================
// MOTOR COM MEMÓRIA, TURNOS E CÁLCULO DE QTD
// ==========================================
async function rodarRoboDeOfertas(idGrupoEspecifico = null) {
    if (roboOcupado) {
        console.log('⚠️ O robô já está trabalhando em uma fila. Aguarde.');
        return;
    }
    roboOcupado = true;

    let idsDosGrupos = idGrupoEspecifico ? [idGrupoEspecifico] : Object.keys(CONFIG.GRUPOS);

    for (const idGrupo of idsDosGrupos) {
        const regrasDoGrupo = CONFIG.GRUPOS[idGrupo];
        const horaAtual = new Date().getHours();
        const dataHoje = new Date().toLocaleDateString();

        const turnoEncontrado = regrasDoGrupo.TURNOS.find(t => horaAtual >= t.inicio && horaAtual <= t.fim);

        if (!turnoEncontrado) {
            console.log(`🌙 Grupo ${regrasDoGrupo.NOME} fora de horário comercial (${horaAtual}h). Robô descansando.`);
            continue;
        }

        const isRelampago = turnoEncontrado.modo === 'RELAMPAGO';
        const rotaUsada = isRelampago ? regrasDoGrupo.ROTA_RELAMPAGO : regrasDoGrupo.ROTA_PADRAO;
        
        // 👇 ADICIONE ESTAS 3 LINHAS AQUI 👇
        regrasDoGrupo.DESCONTO_ATUAL = isRelampago ? regrasDoGrupo.DESCONTO_MINIMO_RELAMPAGO : regrasDoGrupo.DESCONTO_MINIMO_PADRAO;
        regrasDoGrupo.VENDAS_ATUAIS = isRelampago ? regrasDoGrupo.VENDAS_MINIMAS_RELAMPAGO : regrasDoGrupo.VENDAS_MINIMAS_PADRAO;
        regrasDoGrupo.NOTA_ATUAL = isRelampago ? regrasDoGrupo.NOTA_MINIMA_RELAMPAGO : regrasDoGrupo.NOTA_MINIMA_PADRAO;
        // 👆 ---------------------------- 👆

        // 🧮 CÁLCULO INTELIGENTE DE DEMANDA
        const horasDeDuracao = (turnoEncontrado.fim - turnoEncontrado.inicio) + 1;
        const minutosTotais = horasDeDuracao * 60;
        const qtdUsada = Math.floor(minutosTotais / turnoEncontrado.intervaloMin);
        const intervaloUsado = turnoEncontrado.intervaloMin * 60; // Em segundos

        const ehMesmoTurno = regrasDoGrupo.TURNO_SALVO === turnoEncontrado.id && regrasDoGrupo.DATA_SALVA === dataHoje;

        console.log(`\n📦 Grupo: ${regrasDoGrupo.NOME} | Turno: ${turnoEncontrado.id} (${turnoEncontrado.modo})`);
        console.log(`🧮 Meta calculada: ${qtdUsada} produtos para cobrir ${minutosTotais} minutos (1 a cada ${turnoEncontrado.intervaloMin} min).`);

        if (ehMesmoTurno && regrasDoGrupo.FILA_DE_PRODUTOS.length === 0) {
            console.log(`✅ Todos os produtos deste turno já foram enviados hoje! Aguardando o próximo turno...`);
            continue;
        } 
        
        if (ehMesmoTurno && regrasDoGrupo.FILA_DE_PRODUTOS.length > 0) {
            console.log(`♻️ Memória ativada! Retomando envios da fila salva (${regrasDoGrupo.FILA_DE_PRODUTOS.length} restando).`);
        } else {
            console.log(`🔍 Iniciando nova busca no ML para o turno ${turnoEncontrado.id}...`);
            await client.sendMessage(idGrupo, `⏳ Pessoal, garimpando as melhores ofertas do modo ${turnoEncontrado.modo}...`);
            
            regrasDoGrupo.ROTA_ATUAL = rotaUsada;
            regrasDoGrupo.QTD_ATUAL = qtdUsada;
            
            const novosProdutos = await mercadolivre.buscarOfertasML(regrasDoGrupo);
            
            setGrupo(idGrupo, 'FILA_DE_PRODUTOS', novosProdutos);
            setGrupo(idGrupo, 'TURNO_SALVO', turnoEncontrado.id);
            setGrupo(idGrupo, 'DATA_SALVA', dataHoje);
        }

        while (CONFIG.GRUPOS[idGrupo].FILA_DE_PRODUTOS.length > 0) {
            const produto = CONFIG.GRUPOS[idGrupo].FILA_DE_PRODUTOS[0]; 
            
            let linhaPreco = `💰 *Preço:* R$ ${produto.preco}`;
            if (produto.precoAntigo) linhaPreco = `💰 *Preço:* De ~R$ ${produto.precoAntigo}~ por *R$ ${produto.preco}*`;

            const emoji = isRelampago ? '⚡ *OFERTA RELÂMPAGO* ⚡' : '🔥 *OFERTA ENCONTRADA* 🔥';
            const textoMensagem = `${emoji}\n\n📦 *Produto:* ${produto.titulo}\n⭐ *Nota:* ${produto.nota} (${produto.vendas}+ vendidos)\n📉 *Desconto:* ${produto.desconto}% OFF\n${linhaPreco}\n\n🛒 *Compre aqui:* ${produto.linkComissionado}`;

            const chat = await client.getChatById(idGrupo);

            // 🛡️ ANTI-BAN (DUAS MARCHAS)
            let variacaoEmSegundos = 0;
            if (intervaloUsado >= 300) {
                variacaoEmSegundos = Math.floor(Math.random() * 121) + 60;
            } else {
                variacaoEmSegundos = Math.floor(Math.random() * 11) + 2;
            }
            const tempoFinal = intervaloUsado + variacaoEmSegundos;

            console.log(`   ⏳ Aguardando ${tempoFinal} seg (Base: ${intervaloUsado}s + Atraso: ${variacaoEmSegundos}s)...`);
            
            await chat.sendStateTyping(); 
            await esperar(tempoFinal * 1000); 

            // ⏰ TRAVA DE SEGURANÇA: O TURNO VIROU ENQUANTO EU DORMIA?
            const horaPosEspera = new Date().getHours();
            if (horaPosEspera > turnoEncontrado.fim || horaPosEspera < turnoEncontrado.inicio) {
                console.log(`\n⏰ Virada de turno detectada (${horaPosEspera}h)! Abandonando a fila do turno ${turnoEncontrado.id}...`);
                break; // 🪄 MÁGICA: Quebra o laço 'while' e libera o robô imediatamente!
            }

            // 🚀 DISPARO E MEMÓRIA
            await client.sendMessage(idGrupo, textoMensagem);
            salvarNoHistorico(produto.linkLimpo);

            // ♻️ TIRA O PRODUTO DA FILA
            const filaAtualizada = CONFIG.GRUPOS[idGrupo].FILA_DE_PRODUTOS.slice(1);
            setGrupo(idGrupo, 'FILA_DE_PRODUTOS', filaAtualizada);
        }
        
        await client.sendMessage(idGrupo, `🎉 Fim das ofertas deste turno. Aproveitem!`);
    }
    roboOcupado = false;
    console.log('🏁 Processo finalizado com sucesso. Liberando o robô.');
}

// ==========================================
// EVENTOS E PILOTO AUTOMÁTICO
// ==========================================
client.on('qr', (qr) => qrcode.generate(qr, { small: true }));

client.on('ready', () => {
    console.log('✅ Bot conectado e pronto!');

    setInterval(async () => {
        if (!CONFIG.GERAL.PILOTO_AUTOMATICO_LIGADO || roboOcupado) return;
        
        const horaAtual = new Date().getHours();
        const dataHoje = new Date().toLocaleDateString();
        let temTrabalho = false;

        for (const id in CONFIG.GRUPOS) {
            const regras = CONFIG.GRUPOS[id];
            const turno = regras.TURNOS.find(t => horaAtual >= t.inicio && horaAtual <= t.fim);
            
            if (turno) {
                if (!(regras.TURNO_SALVO === turno.id && regras.DATA_SALVA === dataHoje && regras.FILA_DE_PRODUTOS.length === 0)) {
                    temTrabalho = true;
                }
            }
        }

        if (temTrabalho) {
            console.log(`⏰ Relógio apitou! Iniciando o motor...`);
            await rodarRoboDeOfertas();
        }
    }, 60 * 1000);
});

// ==========================================
// PAINEL DE CONTROLE 
// ==========================================
client.on('message_create', async msg => {

    if (msg.body === '!idgrupo') {
        const chat = await msg.getChat();
        return msg.reply(`🤖 ID deste chat:\n*${chat.id._serialized}*`);
    }

    if (msg.from !== CONFIG.GERAL.ID_GRUPO_ADMIN && msg.to !== CONFIG.GERAL.ID_GRUPO_ADMIN) return;

    if (msg.body.startsWith('!ofertas')) {
        const partes = msg.body.split(' ');
        if (roboOcupado) return msg.reply('⚠️ O robô já está com a mão na massa processando uma fila!');

        if (partes.length > 1) {
            const nomeAlvo = partes[1].toUpperCase();
            const idAlvo = encontrarIdPorNome(nomeAlvo);

            if (!idAlvo) return msg.reply(`❌ Não encontrei nenhum grupo chamado *${nomeAlvo}*.`);

            await msg.reply(`🫡 Iniciando a checagem APENAS para o grupo *${nomeAlvo}*.`);
            await rodarRoboDeOfertas(idAlvo);
        } else {
            await msg.reply('🫡 Checando relógio e fila de TODOS os grupos cadastrados.');
            await rodarRoboDeOfertas();
        }
    }

    if (msg.body.startsWith('!cookie ')) {
        setGeral('COOKIE_ML', msg.body.replace('!cookie ', '').trim());
        await msg.reply('✅ Cookie atualizado!');
    }

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

    if (msg.body.startsWith('!addgrupo ')) {
        const partes = msg.body.split(' ');
        if (partes.length < 3) return msg.reply('❌ Formato: `!addgrupo [ID_DO_GRUPO] [NOME_CURTO]`');

        const idNovo = partes[1];
        const nomeNovo = partes[2].toUpperCase();

        if (addGrupo(idNovo, nomeNovo)) {
            await msg.reply(`✅ Grupo *${nomeNovo}* adicionado! Use !template ${nomeNovo} para configurar os filtros.`);
        } else {
            await msg.reply(`⚠️ Este grupo já estava cadastrado.`);
        }
    }

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

    if (msg.body.startsWith('!resumo ')) {
        const nome = msg.body.replace('!resumo ', '').trim();
        const idGrupo = encontrarIdPorNome(nome);
        if (!idGrupo) return msg.reply(`❌ Não encontrei nenhum grupo chamado *${nome}*.`);

        const regras = CONFIG.GRUPOS[idGrupo];
        let texto = `📊 *FILTROS DO GRUPO: ${regras.NOME}*\n\n`;
        for (const [k, v] of Object.entries(regras)) {
            if (k === 'NOME' || k === 'FILA_DE_PRODUTOS' || k === 'TURNOS') continue;
            texto += `*${k}:* ${JSON.stringify(v)}\n`;
        }
        await msg.reply(texto);
    }

    if (msg.body.startsWith('!template ')) {
        const nome = msg.body.replace('!template ', '').trim();
        const idGrupo = encontrarIdPorNome(nome);
        if (!idGrupo) return msg.reply(`❌ Não encontrei nenhum grupo chamado *${nome}*.`);

        const regras = CONFIG.GRUPOS[idGrupo];
        let texto = `!update ${regras.NOME}\n`;
        for (const [k, v] of Object.entries(regras)) {
            if (k === 'NOME' || k === 'FILA_DE_PRODUTOS' || k === 'TURNOS' || k === 'TURNO_SALVO' || k === 'DATA_SALVA' || k === 'ROTA_ATUAL' || k === 'QTD_ATUAL') continue;
            let valorEditavel = Array.isArray(v) ? v.join(', ') : v;
            texto += `${k}=${valorEditavel}\n`;
        }
        await msg.reply(`Copie a mensagem abaixo inteira, altere os valores depois do sinal de igual (=) e me envie de volta:\n\n${texto}`);
    }

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

    // 🎯 11. VER O CRONOGRAMA DE TURNOS
    if (msg.body.startsWith('!turnos ')) {
        const nome = msg.body.replace('!turnos ', '').trim();
        const idGrupo = encontrarIdPorNome(nome);
        if (!idGrupo) return msg.reply(`❌ Não encontrei nenhum grupo chamado *${nome}*.`);

        const turnos = CONFIG.GRUPOS[idGrupo].TURNOS;
        let texto = `🕒 *CRONOGRAMA: ${nome.toUpperCase()}*\n\n`;
        
        turnos.forEach(t => {
            const emoji = t.modo === 'RELAMPAGO' ? '⚡' : '📦';
            const horaFimHumana = t.fim + 1; // 🪄 TRUQUE DE UX: Soma 1 só para a mensagem do Whats!
            texto += `${emoji} *[${t.id}]* ${t.inicio}h às ${horaFimHumana}h\n`;
            texto += `↳ Modo: ${t.modo} | A cada ${t.intervaloMin} min\n\n`;
        });
        
        await msg.reply(texto);
    }

    // 🎯 12. ALTERAR UM TURNO ESPECÍFICO
    if (msg.body.startsWith('!setturno ')) {
        const partes = msg.body.split(' ');
        if (partes.length < 6) return msg.reply('❌ Formato: `!setturno [GRUPO] [ID_TURNO] [INICIO] [FIM] [MINUTOS]`\nEx: !setturno BEBES T2 12 13 9');

        const nome = partes[1].toUpperCase();
        const idGrupo = encontrarIdPorNome(nome);
        if (!idGrupo) return msg.reply(`❌ Grupo *${nome}* não encontrado.`);

        const idTurno = partes[2].toUpperCase();
        const novoInicio = parseInt(partes[3]);
        
        const novoFimHumano = parseInt(partes[4]);
        const novoFimRobo = novoFimHumano - 1; // 🪄 TRUQUE INVERSO: Subtrai 1 para o robô entender o limite
        
        const novoIntervalo = parseInt(partes[5]);

        const turnosAtuais = CONFIG.GRUPOS[idGrupo].TURNOS;
        const index = turnosAtuais.findIndex(t => t.id === idTurno);

        if (index === -1) return msg.reply(`❌ Turno *${idTurno}* não existe neste grupo.`);

        turnosAtuais[index].inicio = novoInicio;
        turnosAtuais[index].fim = novoFimRobo; // Salva a versão da máquina
        turnosAtuais[index].intervaloMin = novoIntervalo;

        setGrupo(idGrupo, 'TURNOS', turnosAtuais);
        await msg.reply(`✅ Turno *${idTurno}* atualizado com sucesso no grupo *${nome}*!\nNovo horário: ${novoInicio}h às ${novoFimHumano}h a cada ${novoIntervalo} min.`);
    }

    if (msg.body === '!help' || msg.body === '!ajuda') {
        const textoHelp = `🤖 *CENTRAL DE COMANDOS DO ROBÔ* 🤖

⚙️ *CONFIGURAÇÕES GERAIS*
*!idgrupo* - Descobre o ID do chat atual.
*!config* - Mostra as config globais e grupos ativos.
*!cookie [texto]* - Atualiza o cookie do ML.
*!setgeral [CHAVE] [VALOR]* - Altera uma regra geral.

📦 *GERENCIAMENTO DE GRUPOS*
*!addgrupo [ID] [NOME]* - Cadastra um novo grupo.
*!renomear [NOME_ANTIGO] [NOME_NOVO]* - Troca o apelido do grupo.
*!resumo [NOME]* - Mostra os filtros de um grupo.
*!template [NOME]* - Gera o formulário de edição em massa.
*!setgrupo [NOME] [REGRA] [VALOR]* - Altera uma regra específica.

🚀 *AÇÃO*
*!ofertas* - Checa fila e relógio de todos os grupos.
*!ofertas [NOME]* - Checa apenas o grupo específico (Ex: !ofertas BEBE).`;

        await msg.reply(textoHelp);
    }
});

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