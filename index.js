// index.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const { CONFIG, setGeral, addGrupo, setGrupo, encontrarIdPorNome } = require('./config');
const { salvarNoHistorico } = require('./memoria');
const mercadolivre = require('./scrapers/mercadolivre');

const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Configuração base do navegador
const puppeteerConfig = {
    args: ['--no-sandbox', '--disable-setuid-sandbox']
};

// Se o sistema for Linux (sua VPS na nuvem), ele usa o caminho de lá. 
// Se for Windows (seu PC), ele ignora isso e usa o navegador padrão que o Node já baixou.
if (process.platform === 'linux') {
    puppeteerConfig.executablePath = '/usr/bin/chromium-browser';
}

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: puppeteerConfig
});

let roboOcupado = false; 

// ==========================================
// 1. O GARIMPEIRO (Busca e Agenda)
// ==========================================
async function rodarRoboDeOfertas(idGrupoEspecifico = null) {
    if (roboOcupado) {
        console.log('⚠️ O Garimpeiro já está ocupado. Aguarde.');
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
            console.log(`🌙 Grupo ${regrasDoGrupo.NOME} fora de horário comercial.`);
            continue;
        }

        const ehMesmoTurno = regrasDoGrupo.TURNO_SALVO === turnoEncontrado.id && regrasDoGrupo.DATA_SALVA === dataHoje;

        if (ehMesmoTurno && regrasDoGrupo.FILA_DE_PRODUTOS.length === 0) {
            console.log(`✅ O turno ${turnoEncontrado.id} já foi finalizado hoje. Aguardando o próximo.`);
            continue;
        } 
        
        if (ehMesmoTurno && regrasDoGrupo.FILA_DE_PRODUTOS.length > 0) {
            console.log(`♻️ A fila já está cheia. O Despachante cuidará do envio.`);
            continue;
        }

        const isRelampago = turnoEncontrado.modo === 'RELAMPAGO';
        regrasDoGrupo.ROTA_ATUAL = isRelampago ? regrasDoGrupo.ROTA_RELAMPAGO : regrasDoGrupo.ROTA_PADRAO;
        regrasDoGrupo.DESCONTO_ATUAL = isRelampago ? regrasDoGrupo.DESCONTO_MINIMO_RELAMPAGO : regrasDoGrupo.DESCONTO_MINIMO_PADRAO;
        regrasDoGrupo.VENDAS_ATUAIS = isRelampago ? regrasDoGrupo.VENDAS_MINIMAS_RELAMPAGO : regrasDoGrupo.VENDAS_MINIMAS_PADRAO;
        regrasDoGrupo.NOTA_ATUAL = isRelampago ? regrasDoGrupo.NOTA_MINIMA_RELAMPAGO : regrasDoGrupo.NOTA_MINIMA_PADRAO;

        const horasDeDuracao = (turnoEncontrado.fim - turnoEncontrado.inicio) + 1;
        const minutosTotais = horasDeDuracao * 60;
        const qtdUsada = Math.floor(minutosTotais / turnoEncontrado.intervaloMin);

        console.log(`\n🔍 Iniciando garimpo para ${regrasDoGrupo.NOME} | Turno: ${turnoEncontrado.id}`);
        console.log(`🧮 Meta: ${qtdUsada} produtos (1 a cada ${turnoEncontrado.intervaloMin} min).`);
        await client.sendMessage(idGrupo, `⏳ Pessoal, garimpando as melhores ofertas do modo ${turnoEncontrado.modo}...`);

        regrasDoGrupo.QTD_ATUAL = qtdUsada;
        const novosProdutos = await mercadolivre.buscarOfertasML(regrasDoGrupo);

        // 🪄 A MÁGICA DO AGENDAMENTO (O 1º vai pra AGORA)
        const agoraMS = Date.now();
        const intervaloEmMS = turnoEncontrado.intervaloMin * 60 * 1000;

        const filaAgendada = novosProdutos.map((prod, index) => {
            return {
                produto: prod,
                horarioEnvio: agoraMS + (index * intervaloEmMS) // Index 0 = sai na hora!
            };
        });

        setGrupo(idGrupo, 'FILA_DE_PRODUTOS', filaAgendada);
        setGrupo(idGrupo, 'TURNO_SALVO', turnoEncontrado.id);
        setGrupo(idGrupo, 'DATA_SALVA', dataHoje);

        // 👇 ADICIONE ESTE BLOCO AQUI 👇
        console.log(`\n📅 Cronograma de Envios Gerado:`);
        filaAgendada.forEach((item, i) => {
            const horaFormatada = new Date(item.horarioEnvio).toLocaleTimeString('pt-BR');
            // Corta o título com substring para o log não ficar uma bagunça gigante
            console.log(`[${i + 1}/${filaAgendada.length}] ⏰ ${horaFormatada} -> ${item.produto.titulo.substring(0, 35)}...`);
        });
        // 👆 FIM DO BLOCO 👆
        
        console.log(`✅ ${filaAgendada.length} produtos agendados! O Garimpeiro vai descansar.\n`);
    }
    
    roboOcupado = false;
}

// ==========================================
// 2. O DESPACHANTE (Motor de Eventos)
// ==========================================
client.on('qr', (qr) => qrcode.generate(qr, { small: true }));

client.on('ready', () => {
    console.log('✅ Bot conectado e Despachante Operacional!');

    setInterval(async () => {
        if (!CONFIG.GERAL.PILOTO_AUTOMATICO_LIGADO) return;

        const agora = new Date();
        const horaAtual = agora.getHours();
        const minutoAtual = agora.getMinutes();
        const agoraMS = agora.getTime();
        const dataHoje = agora.toLocaleDateString();

        for (const idGrupo in CONFIG.GRUPOS) {
            const regras = CONFIG.GRUPOS[idGrupo];
            let fila = regras.FILA_DE_PRODUTOS;
            const turnoAtual = regras.TURNOS.find(t => horaAtual >= t.inicio && horaAtual <= t.fim);

            // 🛡️ Prevenção: Limpa a fila velha que não tem horário de envio
            if (fila.length > 0 && !fila[0].horarioEnvio) {
                setGrupo(idGrupo, 'FILA_DE_PRODUTOS', []);
                continue;
            }

            // 🛑 REGRA DE CORTE: Faltam 5 min ou menos para acabar o turno? Joga a fila fora.
            if (turnoAtual && fila.length > 0) {
                if (horaAtual === turnoAtual.fim && minutoAtual >= 55) {
                    console.log(`⏰ Fim do turno ${turnoAtual.id} se aproximando no grupo ${regras.NOME}. Descartando a fila...`);
                    setGrupo(idGrupo, 'FILA_DE_PRODUTOS', []);
                    await client.sendMessage(idGrupo, `🎉 Fim das ofertas deste turno. O próximo começa em breve!`);
                    continue;
                }
            }

            // 🚀 DISPARO E AUTOCURA (CRASH RECOVERY)
            if (fila.length > 0) {
                // Chegou a hora do primeiro da fila? (Ou passou da hora por causa de queda de luz)
                if (agoraMS >= fila[0].horarioEnvio) {
                    const itemDaVez = fila.shift(); // Tira da fila
                    const prod = itemDaVez.produto;

                    console.log(`\n🚀 Disparando: ${prod.titulo}`);

                    const isRelampago = turnoAtual ? turnoAtual.modo === 'RELAMPAGO' : false;
                    let linhaPreco = `💰 *Preço:* R$ ${prod.preco}`;
                    if (prod.precoAntigo) linhaPreco = `💰 *Preço:* De ~R$ ${prod.precoAntigo}~ por *R$ ${prod.preco}*`;
                    const emoji = isRelampago ? '⚡ *OFERTA RELÂMPAGO* ⚡' : '🔥 *OFERTA ENCONTRADA* 🔥';
                    
                    const textoMensagem = `${emoji}\n\n📦 *Produto:* ${prod.titulo}\n⭐ *Nota:* ${prod.nota} (${prod.vendas}+ vendidos)\n📉 *Desconto:* ${prod.desconto}% OFF\n${linhaPreco}\n\n🛒 *Compre aqui:* ${prod.linkComissionado}`;

                    const chat = await client.getChatById(idGrupo);
                    await chat.sendStateTyping(); 
                    await esperar(3000); // 3 segundinhos só pra dar o efeito "Digitando..." natural

                    await client.sendMessage(idGrupo, textoMensagem);
                    salvarNoHistorico(prod.linkLimpo);

                    // 🔧 A MÁGICA DA AUTOCURA: Atrasou? Ajusta o resto pra não tomar ban do Zap!
                    if (fila.length > 0) {
                        const tempoRespiroMS = 3 * 60 * 1000; // 3 Minutos de atraso obrigatório entre mensagens encavaladas
                        let tempoMinimoSeguro = Date.now() + tempoRespiroMS;
                        let houveRecalculo = false;

                        for (let i = 0; i < fila.length; i++) {
                            // Se o próximo produto está marcado para sair antes do tempo de respiro seguro, empurra ele!
                            if (fila[i].horarioEnvio < tempoMinimoSeguro) {
                                fila[i].horarioEnvio = tempoMinimoSeguro;
                                houveRecalculo = true;
                            }
                            tempoMinimoSeguro = fila[i].horarioEnvio + tempoRespiroMS; // O seguinte vai precisar de mais 3 min
                        }

                        if (houveRecalculo) {
                            console.log(`⚠️ Sistema recálculou os próximos envios com 3 minutos de respiro para evitar flood.`);
                        }
                    }

                    setGrupo(idGrupo, 'FILA_DE_PRODUTOS', fila); // Salva o estado novo

                    if (fila.length === 0) {
                        await client.sendMessage(idGrupo, `🎉 Fim das ofertas deste turno. Aproveitem!`);
                    }
                }
            } 
            // 🔍 GATILHO INICIAL: Fila vazia + Tá no turno certo + Ainda não rodou hoje
            else if (!roboOcupado && turnoAtual) {
                if (!(regras.TURNO_SALVO === turnoAtual.id && regras.DATA_SALVA === dataHoje)) {
                    console.log(`\n⏰ Relógio apitou para o turno ${turnoAtual.id} (${regras.NOME})! Acordando o Garimpeiro...`);
                    rodarRoboDeOfertas(idGrupo); 
                }
            }
        }
    }, 30 * 1000); // O Despachante acorda a cada 30 SEGUNDOS. Preciso e leve.
});

// ==========================================
// PAINEL DE CONTROLE (Sem alterações profundas)
// ==========================================
client.on('message_create', async msg => {

    if (msg.body === '!idgrupo') {
        const chat = await msg.getChat();
        return msg.reply(`🤖 ID deste chat:\n*${chat.id._serialized}*`);
    }

    if (msg.from !== CONFIG.GERAL.ID_GRUPO_ADMIN && msg.to !== CONFIG.GERAL.ID_GRUPO_ADMIN) return;

    if (msg.body.startsWith('!ofertas')) {
        const partes = msg.body.split(' ');
        if (roboOcupado) return msg.reply('⚠️ O robô já está com a mão na massa processando uma busca!');

        if (partes.length > 1) {
            const nomeAlvo = partes[1].toUpperCase();
            const idAlvo = encontrarIdPorNome(nomeAlvo);
            if (!idAlvo) return msg.reply(`❌ Não encontrei nenhum grupo chamado *${nomeAlvo}*.`);
            await msg.reply(`🫡 Forçando a busca para o grupo *${nomeAlvo}*.`);
            await rodarRoboDeOfertas(idAlvo);
        } else {
            await msg.reply('🫡 Forçando busca para TODOS os grupos.');
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
            texto += `🏷️ *${regras.NOME}* (ID: ${id}) - Fila: ${regras.FILA_DE_PRODUTOS.length}\n`;
        }
        await msg.reply(texto);
    }

    if (msg.body.startsWith('!addgrupo ')) {
        const partes = msg.body.split(' ');
        if (partes.length < 3) return msg.reply('❌ Formato: `!addgrupo [ID] [NOME]`');
        if (addGrupo(partes[1], partes[2].toUpperCase())) {
            await msg.reply(`✅ Grupo adicionado! Use !template ${partes[2].toUpperCase()} para configurar.`);
        } else {
            await msg.reply(`⚠️ Este grupo já estava cadastrado.`);
        }
    }
    

    if (msg.body.startsWith('!renomear ')) {
        const partes = msg.body.split(' ');
        if (partes.length < 3) return;
        const idGrupo = encontrarIdPorNome(partes[1].toUpperCase());
        if (!idGrupo) return;
        setGrupo(idGrupo, 'NOME', partes[2].toUpperCase());
        await msg.reply(`✅ Renomeado para *${partes[2].toUpperCase()}*!`);
    }

    if (msg.body.startsWith('!resumo ')) {
        const nome = msg.body.replace('!resumo ', '').trim();
        const idGrupo = encontrarIdPorNome(nome);
        if (!idGrupo) return;
        let texto = `📊 *FILTROS: ${CONFIG.GRUPOS[idGrupo].NOME}*\n\n`;
        for (const [k, v] of Object.entries(CONFIG.GRUPOS[idGrupo])) {
            if (['NOME', 'FILA_DE_PRODUTOS', 'TURNOS'].includes(k)) continue;
            texto += `*${k}:* ${JSON.stringify(v)}\n`;
        }
        await msg.reply(texto);
    }

    if (msg.body.startsWith('!template ')) {
        const nome = msg.body.replace('!template ', '').trim();
        const idGrupo = encontrarIdPorNome(nome);
        if (!idGrupo) return;
        let texto = `!update ${nome}\n`;
        for (const [k, v] of Object.entries(CONFIG.GRUPOS[idGrupo])) {
            if (['NOME', 'FILA_DE_PRODUTOS', 'TURNOS', 'TURNO_SALVO', 'DATA_SALVA', 'ROTA_ATUAL', 'QTD_ATUAL'].includes(k)) continue;
            texto += `${k}=${Array.isArray(v) ? v.join(', ') : v}\n`;
        }
        await msg.reply(`Copie, altere e devolva:\n\n${texto}`);
    }

    if (msg.body.startsWith('!update ')) {
        const linhas = msg.body.split('\n');
        const nome = linhas[0].split(' ')[1];
        const idGrupo = encontrarIdPorNome(nome);
        if (!idGrupo) return;
        let atualizados = 0;
        for (let i = 1; i < linhas.length; i++) {
            const linha = linhas[i].trim();
            if (!linha || !linha.includes('=')) continue;
            const sep = linha.indexOf('=');
            const chave = linha.substring(0, sep).trim().toUpperCase();
            const valorBruto = linha.substring(sep + 1).trim();
            if (CONFIG.GRUPOS[idGrupo][chave] !== undefined) {
                let valorFinal = valorBruto;
                const tipoAtual = typeof CONFIG.GRUPOS[idGrupo][chave];
                if (Array.isArray(CONFIG.GRUPOS[idGrupo][chave])) valorFinal = valorBruto.split(',').filter(x => x.trim()).map(x => x.trim());
                else if (tipoAtual === 'number') valorFinal = Number(valorBruto) || 0;
                else if (tipoAtual === 'boolean') valorFinal = valorBruto.toLowerCase() === 'true';
                setGrupo(idGrupo, chave, valorFinal);
                atualizados++;
            }
        }
        await msg.reply(`✅ ${atualizados} configurações alteradas no grupo *${nome}*.`);
    }

    if (msg.body.startsWith('!turnos ')) {
        const nome = msg.body.replace('!turnos ', '').trim();
        const idGrupo = encontrarIdPorNome(nome);
        if (!idGrupo) return;
        let texto = `🕒 *CRONOGRAMA: ${nome.toUpperCase()}*\n\n`;
        CONFIG.GRUPOS[idGrupo].TURNOS.forEach(t => {
            texto += `${t.modo === 'RELAMPAGO' ? '⚡' : '📦'} *[${t.id}]* ${t.inicio}h às ${t.fim + 1}h - A cada ${t.intervaloMin} min\n`;
        });
        await msg.reply(texto);
    }

    if (msg.body === '!help' || msg.body === '!ajuda') {
        const textoHelp = `🤖 *PAINEL DE COMANDOS - NIMBUS BOT* ☁️\n\n` +
        `*🛠️ GERENCIAMENTO DE GRUPOS*\n` +
        `🔸 *!idgrupo* - Descobre o ID do chat atual\n` +
        `🔸 *!addgrupo [ID] [NOME]* - Cadastra um novo grupo\n` +
        `🔸 *!renomear [ANTIGO] [NOVO]* - Muda o nome de um grupo\n` +
        `🔸 *!template [NOME]* - Gera o molde para configurar filtros\n` +
        `🔸 *!update [NOME]* - Atualiza filtros (cole o template abaixo)\n` +
        `🔸 *!resumo [NOME]* - Mostra os filtros atuais do grupo\n\n` +
        `*⏰ CRONOGRAMA E FILA*\n` +
        `🔸 *!turnos [NOME]* - Mostra os horários de funcionamento\n` +
        `🔸 *!setturno [NOME] [ID] [INICIO] [FIM] [INTERVALO]* - Altera um turno\n` +
        `🔸 *!fila [NOME]* - Mostra os próximos produtos agendados\n` +
        `🔸 *!ofertas [NOME]* - Força o garimpo e o envio imediato\n` +
        `🔸 *!resetar [NOME]* - Zera a fila e a memória do dia\n\n` +
        `*⚙️ SISTEMA*\n` +
        `🔸 *!config* - Mostra o status do piloto automático e grupos\n` +
        `🔸 *!setgeral PILOTO_AUTOMATICO_LIGADO [true/false]* - Liga/Desliga o bot\n` +
        `🔸 *!cookie [VALOR]* - Atualiza o cookie do Mercado Livre`;
        
        await msg.reply(textoHelp);
    }

    if (msg.body.startsWith('!setturno ')) {
        const partes = msg.body.split(' ');
        if (partes.length < 6) return;
        const idGrupo = encontrarIdPorNome(partes[1].toUpperCase());
        if (!idGrupo) return;
        const turnos = CONFIG.GRUPOS[idGrupo].TURNOS;
        const index = turnos.findIndex(t => t.id === partes[2].toUpperCase());
        if (index === -1) return;
        turnos[index].inicio = parseInt(partes[3]);
        turnos[index].fim = parseInt(partes[4]) - 1;
        turnos[index].intervaloMin = parseInt(partes[5]);
        setGrupo(idGrupo, 'TURNOS', turnos);
        await msg.reply(`✅ Turno atualizado!`);
    }
    // 👇 NOVO COMANDO PARA VER A FILA 👇
    if (msg.body.startsWith('!fila ')) {
        const nome = msg.body.replace('!fila ', '').trim().toUpperCase();
        const idGrupo = encontrarIdPorNome(nome);
        
        if (!idGrupo) return msg.reply(`❌ Não encontrei nenhum grupo chamado *${nome}*.`);
        
        const fila = CONFIG.GRUPOS[idGrupo].FILA_DE_PRODUTOS;
        if (!fila || fila.length === 0) return msg.reply(`📭 A fila do grupo *${nome}* está vazia no momento.`);

        let texto = `📋 *FILA DE ENVIOS - ${nome}*\n📦 Total aguardando: ${fila.length} produtos\n\n`;
        
        // Mostra no máximo os próximos 10 envios para não travar o zap
        const limite = Math.min(fila.length, 10);
        for (let i = 0; i < limite; i++) {
            const item = fila[i];
            const horaFormatada = new Date(item.horarioEnvio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            texto += `⏰ *${horaFormatada}* - ${item.produto.titulo.substring(0, 25)}...\n`;
        }
        
        if (fila.length > limite) {
            texto += `\n_...e mais ${fila.length - limite} produtos agendados para depois._`;
        }

        await msg.reply(texto);
    }
    // 👆 FIM DO NOVO COMANDO 👆
});

client.on('message_create', async msg => {
    if (msg.body.startsWith('!setgeral ') && (msg.from === CONFIG.GERAL.ID_GRUPO_ADMIN || msg.to === CONFIG.GERAL.ID_GRUPO_ADMIN)) {
        const partes = msg.body.split(' ');
        const chave = partes[1].toUpperCase();
        let valorFinal = msg.body.substring(msg.body.indexOf(partes[2]));
        if (CONFIG.GERAL[chave] === undefined) return;
        if (typeof CONFIG.GERAL[chave] === 'number') valorFinal = Number(valorFinal);
        if (typeof CONFIG.GERAL[chave] === 'boolean') valorFinal = valorFinal.toLowerCase() === 'true';
        setGeral(chave, valorFinal);
        await msg.reply(`✅ Config Geral *${chave}* atualizada!`);
    }
});

client.initialize();