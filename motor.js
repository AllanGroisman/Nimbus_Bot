// motor.js
const { CONFIG, setGrupo } = require('./config');
const { salvarNoHistorico } = require('./memoria');
const mercadolivre = require('./scrapers/mercadolivre');
const { esperar, converterParaMinutos } = require('./utils');
const { MessageMedia } = require('whatsapp-web.js');

let roboOcupado = false;

// Exporta o status para o painel de comandos saber se ele tá ocupado
function obterStatusRobo() {
    return roboOcupado;
}

// ==========================================
// 1. O GARIMPEIRO
// ==========================================
async function rodarRoboDeOfertas(client, idGrupoEspecifico = null) {
    if (roboOcupado) {
        console.log('⚠️ O Garimpeiro já está ocupado. Aguarde.');
        return;
    }
    roboOcupado = true;

    let idsDosGrupos = idGrupoEspecifico ? [idGrupoEspecifico] : Object.keys(CONFIG.GRUPOS);

    for (const idGrupo of idsDosGrupos) {
        const regrasDoGrupo = CONFIG.GRUPOS[idGrupo];
        const agora = new Date();
        const minutosAtuais = (agora.getHours() * 60) + agora.getMinutes();
        const dataHoje = agora.toLocaleDateString();

        const turnoEncontrado = regrasDoGrupo.TURNOS.find(t => {
            const inicioMin = converterParaMinutos(t.inicio);
            const fimMin = converterParaMinutos(t.fim);
            return minutosAtuais >= inicioMin && minutosAtuais <= fimMin;
        });

        if (!turnoEncontrado) {
            console.log(`🌙 Grupo ${regrasDoGrupo.NOME} fora de horário comercial.`);
            continue;
        }

        const ehMesmoTurno = regrasDoGrupo.TURNO_SALVO === turnoEncontrado.id && regrasDoGrupo.DATA_SALVA === dataHoje;

        // 👇 NOVA LÓGICA DE ESPERA 👇
        if (ehMesmoTurno) {
            if (regrasDoGrupo.FILA_AGUARDANDO_APROVACAO && regrasDoGrupo.FILA_AGUARDANDO_APROVACAO.length > 0) {
                console.log(`⏳ Aguardando aprovação do admin para o grupo ${regrasDoGrupo.NOME}.`);
                continue;
            }
            if (regrasDoGrupo.FILA_DE_PRODUTOS.length === 0) {
                console.log(`✅ O turno ${turnoEncontrado.id} já foi finalizado hoje.`);
                continue;
            } else {
                console.log(`♻️ A fila já está cheia. O Despachante cuidará do envio.`);
                continue;
            }
        }

        const isRelampago = turnoEncontrado.modo === 'RELAMPAGO';
        regrasDoGrupo.ROTA_ATUAL = isRelampago ? regrasDoGrupo.ROTA_RELAMPAGO : regrasDoGrupo.ROTA_PADRAO;
        regrasDoGrupo.DESCONTO_ATUAL = isRelampago ? regrasDoGrupo.DESCONTO_MINIMO_RELAMPAGO : regrasDoGrupo.DESCONTO_MINIMO_PADRAO;
        regrasDoGrupo.VENDAS_ATUAIS = isRelampago ? regrasDoGrupo.VENDAS_MINIMAS_RELAMPAGO : regrasDoGrupo.VENDAS_MINIMAS_PADRAO;
        regrasDoGrupo.NOTA_ATUAL = isRelampago ? regrasDoGrupo.NOTA_MINIMA_RELAMPAGO : regrasDoGrupo.NOTA_MINIMA_PADRAO;

        const inicioMin = converterParaMinutos(turnoEncontrado.inicio);
        const fimMin = converterParaMinutos(turnoEncontrado.fim);
        const minutosTotaisDoTurno = fimMin - inicioMin;
        
        // Calcula a cota TOTAL do turno
        const qtdTotalDoTurno = Math.max(1, Math.floor(minutosTotaisDoTurno / turnoEncontrado.intervaloMin));
        
        // 👇 A MATEMÁTICA NOVA: Vê quantos já tem na fila oficial pra buscar só a diferença 👇
        const qtdFaltante = qtdTotalDoTurno - regrasDoGrupo.FILA_DE_PRODUTOS.length;

        if (qtdFaltante <= 0) {
            console.log(`✅ A fila do grupo ${regrasDoGrupo.NOME} já está cheia (${regrasDoGrupo.FILA_DE_PRODUTOS.length}/${qtdTotalDoTurno}).`);
            CONFIG.GRUPOS[idGrupo].TURNO_SALVO = turnoEncontrado.id;
            CONFIG.GRUPOS[idGrupo].DATA_SALVA = dataHoje;
            continue; // Pula pra não buscar além da conta
        }

        console.log(`\n🔍 Iniciando garimpo para ${regrasDoGrupo.NOME} | Turno: ${turnoEncontrado.id} (Buscando ${qtdFaltante} faltantes)`);
        
        try {
            await client.sendMessage(idGrupo, `⏳ Pessoal, garimpando as melhores ofertas...`);
            
            // Ele vai caçar exatamente a quantidade que falta!
            regrasDoGrupo.QTD_ATUAL = qtdFaltante; 
            
            const novosProdutos = await mercadolivre.buscarOfertasML(regrasDoGrupo);

            // 👇 TRAVA DE SEGURANÇA 👇
            if (!novosProdutos || !Array.isArray(novosProdutos) || novosProdutos.length === 0) {
                console.log(`⚠️ O Mercado Livre não retornou produtos válidos para ${regrasDoGrupo.NOME}.`);
                await client.sendMessage(idGrupo, `❌ Ocorreu um problema na busca ou não há produtos no padrão exigido agora. O Garimpeiro vai tentar de novo mais tarde.`);
                continue; // Aborta o agendamento e pula para o próximo grupo
            }

            // 👇 COLOCANDO NA FILA DE ESPERA 👇
            CONFIG.GRUPOS[idGrupo].FILA_AGUARDANDO_APROVACAO = novosProdutos;
            setGrupo(idGrupo, 'TURNO_SALVO', turnoEncontrado.id);
            setGrupo(idGrupo, 'DATA_SALVA', dataHoje);

            // Monta o Menu de Aprovação
            let textoAprovacao = `🚨 *APROVAÇÃO PENDENTE - ${regrasDoGrupo.NOME}* 🚨\nTurno: ${turnoEncontrado.id}\n\n`;
            novosProdutos.forEach((prod, idx) => {
                textoAprovacao += `*${idx + 1}.* ${prod.titulo.substring(0, 35)}... (R$ ${prod.preco})\n`;
            });
            textoAprovacao += `\n✅ Aprovar TODOS:\n*!aprovar ${regrasDoGrupo.NOME}*\n\n✅ Aprovar alguns:\n*!aprovar ${regrasDoGrupo.NOME} 1,3,4*\n\n❌ Rejeitar e buscar novos:\n*!rejeitar ${regrasDoGrupo.NOME}*`;

            // Puxando o ID do grupo de Admin direto do config
            const idGrupoAdmin = CONFIG.GERAL.ID_GRUPO_ADMIN; 
            
            await client.sendMessage(idGrupoAdmin, textoAprovacao);
            console.log(`\n⏸️ Menu de aprovação enviado para o Grupo Admin. Aguardando comandos...`);
            console.log(`✅ ${novosProdutos.length} produtos enviados para a fila de espera. O Garimpeiro vai aguardar a sua ordem.\n`);

        } catch (erro) {
            console.log("❌ Erro fatal no Garimpeiro:", erro);
        }
    }
    
    roboOcupado = false;
}

// ==========================================
// 2. O DESPACHANTE
// ==========================================
function iniciarDespachante(client) {
    setInterval(async () => {
        if (!CONFIG.GERAL.PILOTO_AUTOMATICO_LIGADO) return;

        const agora = new Date();
        const minutosAtuais = (agora.getHours() * 60) + agora.getMinutes();
        const agoraMS = agora.getTime();
        const dataHoje = agora.toLocaleDateString();

        for (const idGrupo in CONFIG.GRUPOS) {
            const regras = CONFIG.GRUPOS[idGrupo];
            let fila = regras.FILA_DE_PRODUTOS;
            
            const turnoAtual = regras.TURNOS.find(t => {
                const inicioMin = converterParaMinutos(t.inicio);
                const fimMin = converterParaMinutos(t.fim);
                return minutosAtuais >= inicioMin && minutosAtuais <= fimMin;
            });

            if (fila.length > 0 && !fila[0].horarioEnvio) {
                setGrupo(idGrupo, 'FILA_DE_PRODUTOS', []);
                continue;
            }

            if (turnoAtual && fila.length > 0) {
                const fimMin = converterParaMinutos(turnoAtual.fim);
                if (fimMin - minutosAtuais <= 5) {
                    console.log(`⏰ Fim do turno se aproximando. Descartando a fila...`);
                    setGrupo(idGrupo, 'FILA_DE_PRODUTOS', []);
                    await client.sendMessage(idGrupo, `🎉 Fim das ofertas deste turno. O próximo começa em breve!`);
                    continue;
                }
            }

            if (fila.length > 0) {
                if (agoraMS >= fila[0].horarioEnvio) {
                    const itemDaVez = fila.shift();
                    const prod = itemDaVez.produto;

                    console.log(`\n🚀 Disparando: ${prod.titulo}`);

                    const isRelampago = turnoAtual ? turnoAtual.modo === 'RELAMPAGO' : false;
                    let linhaPreco = `💰 *Preço:* R$ ${prod.preco}`;
                    if (prod.precoAntigo) linhaPreco = `💰 *Preço:* De ~R$ ${prod.precoAntigo}~ por *R$ ${prod.preco}*`;
                    const emoji = isRelampago ? '⚡ *OFERTA RELÂMPAGO* ⚡' : '🔥 *OFERTA ENCONTRADA* 🔥';
                    
                    const textoMensagem = `${emoji}\n\n📦 *Produto:* ${prod.titulo}\n⭐ *Nota:* ${prod.nota} (${prod.vendas}+ vendidos)\n📉 *Desconto:* ${prod.desconto}% OFF\n${linhaPreco}\n\n🛒 *Compre aqui:* ${prod.linkComissionado}`;

                    try {
                        const chat = await client.getChatById(idGrupo);
                        await chat.sendStateTyping(); 
                        await esperar(2000); 

                        try {
                            if (prod.imagem && prod.imagem.startsWith('http')) {
                                console.log(`   📸 Baixando foto do produto...`);
                                const media = await MessageMedia.fromUrl(prod.imagem, { unsafeMime: true });
                                await client.sendMessage(idGrupo, media, { caption: textoMensagem });
                            } else {
                                await client.sendMessage(idGrupo, textoMensagem);
                            }
                        } catch (erroDeMidia) {
                            console.log(`   ⚠️ Erro ao enviar foto, enviando apenas texto. Erro: ${erroDeMidia.message}`);
                            await client.sendMessage(idGrupo, textoMensagem);
                        } 
                        
                        salvarNoHistorico(prod.linkLimpo);
                        
                    } catch (e) {
                        console.log(`⚠️ Falha ao enviar o produto. Erro: ${e.message}`);
                    }

                    if (fila.length > 0) {
                        const tempoRespiroMS = 3 * 60 * 1000; 
                        let tempoMinimoSeguro = Date.now() + tempoRespiroMS;
                        let houveRecalculo = false;

                        for (let i = 0; i < fila.length; i++) {
                            if (fila[i].horarioEnvio < tempoMinimoSeguro) {
                                fila[i].horarioEnvio = tempoMinimoSeguro;
                                houveRecalculo = true;
                            }
                            tempoMinimoSeguro = fila[i].horarioEnvio + tempoRespiroMS; 
                        }
                    }

                    setGrupo(idGrupo, 'FILA_DE_PRODUTOS', fila); 

                    if (fila.length === 0) {
                        await client.sendMessage(idGrupo, `🎉 Fim das ofertas deste turno. Aproveitem!`);
                    }
                }
            } 
            else if (!roboOcupado && turnoAtual) {
                if (!(regras.TURNO_SALVO === turnoAtual.id && regras.DATA_SALVA === dataHoje)) {
                    console.log(`\n⏰ Acordando o Garimpeiro para o turno ${turnoAtual.id}...`);
                    rodarRoboDeOfertas(client, idGrupo); 
                }
            }
        }
    }, 30 * 1000); 
}

module.exports = { rodarRoboDeOfertas, iniciarDespachante, obterStatusRobo };