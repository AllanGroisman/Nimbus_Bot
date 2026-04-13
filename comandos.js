// comandos.js
const { CONFIG, setGeral, addGrupo, setGrupo, encontrarIdPorNome } = require('./config');
const fs = require('fs');
const { rodarRoboDeOfertas, obterStatusRobo } = require('./motor');
const { salvarNoHistorico } = require('./memoria');


function carregarComandos(client) {
    client.on('message_create', async msg => {
        if (!msg.body || typeof msg.body !== 'string') return;

        if (msg.body === '!idgrupo') {
            try {
                const chat = await msg.getChat();
                return msg.reply(`🤖 ID deste chat:\n*${chat.id._serialized}*`);
            } catch(e) {}
        }

        // Trava de Segurança: Só você comanda
        if (msg.from !== CONFIG.GERAL.ID_GRUPO_ADMIN && msg.to !== CONFIG.GERAL.ID_GRUPO_ADMIN) return;

        if (msg.body.startsWith('!ofertas')) {
            const partes = msg.body.split(' ');
            if (obterStatusRobo()) return msg.reply('⚠️ O robô já está processando uma busca!');

            if (partes.length > 1) {
                const nomeAlvo = partes[1].toUpperCase();
                const idAlvo = encontrarIdPorNome(nomeAlvo);
                if (!idAlvo) return msg.reply(`❌ Grupo *${nomeAlvo}* não encontrado.`);
                await msg.reply(`🫡 Forçando a busca para *${nomeAlvo}*.`);
                await rodarRoboDeOfertas(client, idAlvo);
            } else {
                await msg.reply('🫡 Forçando busca para TODOS os grupos.');
                await rodarRoboDeOfertas(client);
            }
        }

        if (msg.body.startsWith('!delgrupo ')) {
            const nome = msg.body.replace('!delgrupo ', '').trim().toUpperCase();
            const idGrupo = encontrarIdPorNome(nome);
            if (!idGrupo) return msg.reply(`❌ Grupo *${nome}* não encontrado.`);
            
            delete CONFIG.GRUPOS[idGrupo];
            fs.writeFileSync('./config.json', JSON.stringify(CONFIG, null, 4));
            await msg.reply(`🗑️ Grupo *${nome}* excluído com sucesso!`);
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
                texto += `🏷️ *${regras.NOME}* (Fila: ${regras.FILA_DE_PRODUTOS.length})\n`;
            }
            await msg.reply(texto);
        }

        if (msg.body.startsWith('!addgrupo ')) {
            const partes = msg.body.split(' ');
            if (partes.length < 3) {
                return msg.reply('❌ Formato: `!addgrupo [ID] [NOME] [CATEGORIA (Opcional)]`\nEx: `!addgrupo 123@g.us PROMOS GAMER`');
            }

            const id = partes[1];
            const nome = partes[2].toUpperCase();
            const categoriaEscolhida = partes[3] ? partes[3].toUpperCase() : null;

            if (addGrupo(id, nome)) {
                let textoResposta = `✅ Grupo *${nome}* adicionado com sucesso!`;

                // Se você digitou uma categoria e ela existe no dicionário...
                if (categoriaEscolhida && CATEGORIAS_ML[categoriaEscolhida]) {
                    const idCatML = CATEGORIAS_ML[categoriaEscolhida];
                    
                    // Injeta a categoria direto na rota padrão e relâmpago!
                    setGrupo(id, 'ROTA_PADRAO', `?category=${idCatML}`);
                    setGrupo(id, 'ROTA_RELAMPAGO', `?category=${idCatML}`);
                    
                    textoResposta += `\n🛒 Categoria configurada automaticamente para: *${categoriaEscolhida}* (${idCatML})`;
                } else if (categoriaEscolhida) {
                    textoResposta += `\n⚠️ A categoria '${categoriaEscolhida}' não está no dicionário. A rota ficou em branco.`;
                } else {
                    textoResposta += `\n⚠️ Nenhuma categoria informada. A rota ficou vazia.`;
                }

                textoResposta += `\n\nUse !template ${nome} para ver ou ajustar o resto dos filtros.`;
                await msg.reply(textoResposta);
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

       // ==========================================
        // COMANDO: !TEMPLATE
        // ==========================================
        if (msg.body.startsWith('!template ')) {
            const nomeGrupo = msg.body.replace('!template ', '').trim().toUpperCase();
            const idGrupo = encontrarIdPorNome(nomeGrupo);
            
            if (!idGrupo) return msg.reply(`❌ Grupo não encontrado.`);

            const regras = CONFIG.GRUPOS[idGrupo];
            let texto = `Copie a mensagem abaixo, altere os valores após o sinal de igual (=) e envie de volta para atualizar:\n\n`;
            
            // Monta o gabarito limpo com as novas variáveis do sistema
            texto += `!update ${regras.NOME}\n`;
            texto += `LOJAS = ${regras.LOJAS ? regras.LOJAS.join(', ') : 'MERCADOLIVRE, AMAZON'}\n`;
            texto += `CATEGORIA = ${regras.CATEGORIA || 'BEBE'}\n`;
            texto += `LIMITE_PAGINAS_BUSCA = ${regras.LIMITE_PAGINAS_BUSCA}\n`;
            texto += `DIAS_PARA_REPETIR_PRODUTO = ${regras.DIAS_PARA_REPETIR_PRODUTO || 2}\n`;
            texto += `PALAVRAS_CHAVE = ${regras.PALAVRAS_CHAVE ? regras.PALAVRAS_CHAVE.join(', ') : ''}\n`;
            texto += `DESCONTO_MINIMO_PADRAO = ${regras.DESCONTO_MINIMO_PADRAO}\n`;
            texto += `VENDAS_MINIMAS_PADRAO = ${regras.VENDAS_MINIMAS_PADRAO}\n`;
            texto += `NOTA_MINIMA_PADRAO = ${regras.NOTA_MINIMA_PADRAO}\n`;
            texto += `DESCONTO_MINIMO_RELAMPAGO = ${regras.DESCONTO_MINIMO_RELAMPAGO}\n`;
            texto += `VENDAS_MINIMAS_RELAMPAGO = ${regras.VENDAS_MINIMAS_RELAMPAGO}\n`;
            texto += `NOTA_MINIMA_RELAMPAGO = ${regras.NOTA_MINIMA_RELAMPAGO}`;

            msg.reply(texto);
        }

        // ==========================================
        // COMANDO: !UPDATE
        // ==========================================
        if (msg.body.startsWith('!update ')) {
            const linhas = msg.body.split('\n');
            const cabecalho = linhas.shift(); // Remove a primeira linha (!update NOME_DO_GRUPO)
            const nomeGrupo = cabecalho.replace('!update ', '').trim().toUpperCase();
            const idGrupo = encontrarIdPorNome(nomeGrupo);
            
            if (!idGrupo) return msg.reply(`❌ Grupo não encontrado.`);

            let atualizados = 0;
            linhas.forEach(linha => {
                if (linha.includes('=')) {
                    let [chave, valor] = linha.split('=');
                    chave = chave.trim().toUpperCase();
                    valor = valor.trim(); // Mantém o formato original primeiro

                    // 1. Tratamento para listas (Arrays)
                    if (chave === 'LOJAS' || chave === 'PALAVRAS_CHAVE') {
                        // Transforma a string "AMAZON, MERCADOLIVRE" em um array bonitinho
                        const arrayFormatado = valor.split(',').map(item => item.trim().toUpperCase()).filter(item => item !== '');
                        setGrupo(idGrupo, chave, arrayFormatado);
                        atualizados++;
                    } 
                    // 2. Tratamento para a Categoria (Garante que fique em Maiúsculo para achar no dicionário)
                    else if (chave === 'CATEGORIA') {
                        setGrupo(idGrupo, chave, valor.toUpperCase());
                        atualizados++;
                    } 
                    // 3. Tratamento para Números
                    else if (!isNaN(valor) && valor !== '') {
                        setGrupo(idGrupo, chave, Number(valor));
                        atualizados++;
                    } 
                    // 4. Textos em Geral
                    else if (valor !== '') {
                        setGrupo(idGrupo, chave, valor);
                        atualizados++;
                    }
                }
            });

            if (atualizados > 0) {
                msg.reply(`✅ Grupo *${nomeGrupo}* atualizado com sucesso! (${atualizados} regras alteradas).`);
            } else {
                msg.reply(`⚠️ Nenhuma regra foi atualizada. Verifique se você usou o formato CHAVE = VALOR.`);
            }
        }

        if (msg.body.startsWith('!turnos ')) {
            const nome = msg.body.replace('!turnos ', '').trim();
            const idGrupo = encontrarIdPorNome(nome);
            if (!idGrupo) return;
            let texto = `🕒 *CRONOGRAMA: ${nome.toUpperCase()}*\n\n`;
            CONFIG.GRUPOS[idGrupo].TURNOS.forEach(t => {
                const inicioStr = String(t.inicio).includes(':') ? t.inicio : `${t.inicio}:00`;
                const fimStr = String(t.fim).includes(':') ? t.fim : `${t.fim}:00`;
                texto += `${t.modo === 'RELAMPAGO' ? '⚡' : '📦'} *[${t.id}]* ${inicioStr} às ${fimStr} - A cada ${t.intervaloMin} min\n`;
            });
            await msg.reply(texto);
        }

        if (msg.body === '!help' || msg.body === '!ajuda') {
            const textoHelp = `🤖 *PAINEL DE COMANDOS* ☁️\n\n` +
            `*⏰ CRONOGRAMA E FILA*\n` +
            `🔸 *!turnos [NOME]* - Mostra horários\n` +
            `🔸 *!setturno [NOME] [ID] [HH:MM] [HH:MM] [INT]* - Altera turno\n` +
            `🔸 *!fila [NOME]* - Mostra produtos agendados\n` +
            `🔸 *!ofertas [NOME]* - Força envio imediato\n` +
            `🔸 *!resetar [NOME]* - Zera a memória do dia\n\n` +
            `*🛠️ GRUPOS*\n` +
            `🔸 *!idgrupo* - ID do chat atual\n` +
            `🔸 *!addgrupo / !delgrupo / !renomear*\n` +
            `🔸 *!template / !update / !resumo*\n\n` +
            `*⚙️ SISTEMA*\n` +
            `🔸 *!config* - Status geral\n` +
            `🔸 *!robo [on/off]* - Liga/Desliga o automático\n` + // 👈 Adicionado
            `🔸 *!auto [on/off]* - Liga/Desliga auto-aprovação`;   // 👈 Adicionado
            
            await msg.reply(textoHelp);
        }

        // ==========================================
        // COMANDO: !AUTO [ON/OFF]
        // ==========================================
        if (msg.body.startsWith('!auto ')) {
            const acao = msg.body.replace('!auto ', '').trim().toLowerCase();
            
            if (acao === 'on') {
                setGeral('AUTO_APROVAR_LIGADO', true);
                msg.reply('🚀 **AUTO-APROVAÇÃO LIGADA!**\nOs produtos encontrados serão aprovados e agendados direto na fila automaticamente!');
            } else if (acao === 'off') {
                setGeral('AUTO_APROVAR_LIGADO', false);
                msg.reply('🛡️ **AUTO-APROVAÇÃO DESLIGADA.**\nVoltaremos ao modo manual. O Garimpeiro enviará o menu de aprovação para você.');
            } else {
                msg.reply('⚠️ Use `!auto on` para ligar ou `!auto off` para desligar a aprovação automática.');
            }
        }

        if (msg.body.startsWith('!setturno ')) {
            const partes = msg.body.split(' ');
            if (partes.length < 6) return msg.reply('❌ Formato: `!setturno [GRUPO] [ID] [HH:MM] [HH:MM] [INT]`');
            const idGrupo = encontrarIdPorNome(partes[1].toUpperCase());
            if (!idGrupo) return;
            const turnos = CONFIG.GRUPOS[idGrupo].TURNOS;
            const index = turnos.findIndex(t => t.id === partes[2].toUpperCase());
            if (index === -1) return msg.reply(`❌ Turno não encontrado.`);
            
            turnos[index].inicio = partes[3];
            turnos[index].fim = partes[4];
            turnos[index].intervaloMin = parseInt(partes[5]);
            setGrupo(idGrupo, 'TURNOS', turnos);
            await msg.reply(`✅ Turno atualizado!`);
        }

        if (msg.body.startsWith('!fila ')) {
            const nome = msg.body.replace('!fila ', '').trim().toUpperCase();
            const idGrupo = encontrarIdPorNome(nome);
            if (!idGrupo) return msg.reply(`❌ Grupo *${nome}* não encontrado.`);
            
            const fila = CONFIG.GRUPOS[idGrupo].FILA_DE_PRODUTOS;
            if (!fila || fila.length === 0) return msg.reply(`📭 Fila vazia.`);

            let texto = `📋 *FILA DE ENVIOS - ${nome}*\n📦 Total: ${fila.length} produtos\n\n`;
            const limite = Math.min(fila.length, 10);
            for (let i = 0; i < limite; i++) {
                const horaFormatada = new Date(fila[i].horarioEnvio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                texto += `⏰ *${horaFormatada}* - ${fila[i].produto.titulo.substring(0, 25)}...\n`;
            }
            if (fila.length > limite) texto += `\n_...e mais ${fila.length - limite}._`;
            await msg.reply(texto);
        }
        
        if (msg.body.startsWith('!resetar ')) {
            const nome = msg.body.replace('!resetar ', '').trim().toUpperCase();
            const idGrupo = encontrarIdPorNome(nome);
            if (!idGrupo) return msg.reply(`❌ Grupo não encontrado.`);
            
            setGrupo(idGrupo, 'DATA_SALVA', '01/01/2000');
            setGrupo(idGrupo, 'TURNO_SALVO', 'RESET');
            setGrupo(idGrupo, 'FILA_DE_PRODUTOS', []);
            await msg.reply(`🔄 Memória apagada! Pronto para rodar do zero.`);
        }
        // ==========================================
        // COMANDO: !APROVAR (Com Jitter e Reposição)
        // ==========================================
        if (msg.body.startsWith('!aprovar ')) {
            const partes = msg.body.replace('!aprovar ', '').split(' ');
            const nomeGrupo = partes[0].trim().toUpperCase();
            const idGrupo = encontrarIdPorNome(nomeGrupo);

            if (!idGrupo) return msg.reply(`❌ Grupo ${nomeGrupo} não encontrado.`);

            const filaPendente = CONFIG.GRUPOS[idGrupo].FILA_AGUARDANDO_APROVACAO || [];
            if (filaPendente.length === 0) return msg.reply(`⚠️ Não há lista aguardando aprovação para ${nomeGrupo}.`);

            let produtosAprovados = [];
            let produtosRejeitados = []; // 👇 Agora separamos o joio do trigo

            if (partes.length > 1) {
                const escolhas = partes.slice(1).join('').split(',');
                const indicesEscolhidos = escolhas.map(n => parseInt(n.trim()) - 1);
                
                filaPendente.forEach((prod, idx) => {
                    if (indicesEscolhidos.includes(idx)) {
                        produtosAprovados.push(prod);
                    } else {
                        produtosRejeitados.push(prod);
                    }
                });
            } else {
                produtosAprovados = filaPendente;
            }

            if (produtosAprovados.length === 0) return msg.reply(`❌ Nenhum produto válido selecionado.`);

            // 1. JOGA OS REJEITADOS NA LISTA NEGRA (Para não voltarem na próxima busca)
            produtosRejeitados.forEach(prod => salvarNoHistorico(prod.linkLimpo));

            // 2. AGENDA OS APROVADOS COM VARIAÇÃO HUMANA (JITTER)
            const regrasDoGrupo = CONFIG.GRUPOS[idGrupo];
            const turnoEncontrado = regrasDoGrupo.TURNOS.find(t => t.id === regrasDoGrupo.TURNO_SALVO);
            const intervaloBaseMin = turnoEncontrado ? turnoEncontrado.intervaloMin : 20;

            let filaExistente = CONFIG.GRUPOS[idGrupo].FILA_DE_PRODUTOS || [];
            let tempoAcumuladoMS = Date.now();

            // Se já tem produto na fila, o novo agendamento começa a partir do último
            if (filaExistente.length > 0) {
                tempoAcumuladoMS = filaExistente[filaExistente.length - 1].horarioEnvio + Math.floor(intervaloBaseMin * 60 * 1000);
            }

            const novosAgendados = produtosAprovados.map((prod, index) => {
                if (index === 0 && filaExistente.length === 0) {
                    return { produto: prod, horarioEnvio: tempoAcumuladoMS }; // O 1º sai na hora
                }
                // Cria variação de tempo: Sorteia 30% pra mais ou pra menos
                const variacao = (Math.random() * 0.6) - 0.3; 
                const intervaloComRuidoMin = intervaloBaseMin * (1 + variacao);
                const intervaloEmMS = Math.floor(intervaloComRuidoMin * 60 * 1000);
                
                tempoAcumuladoMS += intervaloEmMS; 
                return { produto: prod, horarioEnvio: tempoAcumuladoMS };
            });

            // Junta a fila antiga com os novos aprovados
            CONFIG.GRUPOS[idGrupo].FILA_DE_PRODUTOS = filaExistente.concat(novosAgendados);
            CONFIG.GRUPOS[idGrupo].FILA_AGUARDANDO_APROVACAO = [];

            // 3. A MÁGICA DA REPOSIÇÃO
            if (produtosRejeitados.length > 0) {
                // Se você rejeitou algo, o turno não acabou! Apagamos o carimbo para forçar nova busca
                CONFIG.GRUPOS[idGrupo].TURNO_SALVO = ""; 
                fs.writeFileSync('./config.json', JSON.stringify(CONFIG, null, 4));
                
                msg.reply(`✅ *${produtosAprovados.length}* agendados na fila!\n🗑️ *${produtosRejeitados.length}* rejeitados e banidos.\n\n🔍 O Garimpeiro já desceu pra mina pra buscar as ${produtosRejeitados.length} vagas que faltam...`);
                
                // Dispara o robô em background pra caçar os que faltam imediatamente
                rodarRoboDeOfertas(client, idGrupo);
            } else {
                fs.writeFileSync('./config.json', JSON.stringify(CONFIG, null, 4));
                msg.reply(`✅ Todos os *${produtosAprovados.length}* produtos foram aprovados e agendados com sucesso!`);
            }
        }

        // ==========================================
        // COMANDO: !ROBO [ON/OFF]
        // ==========================================
        if (msg.body.startsWith('!robo ')) {
            const acao = msg.body.replace('!robo ', '').trim().toLowerCase();
            
            if (acao === 'on') {
                setGeral('PILOTO_AUTOMATICO_LIGADO', true);
                msg.reply('🤖 **PILOTO AUTOMÁTICO LIGADO!**\nAgora vou procurar e enviar ofertas sozinho conforme os turnos.');
            } else if (acao === 'off') {
                setGeral('PILOTO_AUTOMATICO_LIGADO', false);
                msg.reply('😴 **PILOTO AUTOMÁTICO DESLIGADO.**\nNão farei mais envios automáticos até que me ligues novamente.');
            } else {
                msg.reply('⚠️ Usa `!robo on` para ligar ou `!robo off` para desligar.');
            }
        }


        // ==========================================
        // COMANDO: !REJEITAR
        // ==========================================
        if (msg.body.startsWith('!rejeitar ')) {
            const nomeGrupo = msg.body.replace('!rejeitar ', '').trim().toUpperCase();
            const idGrupo = encontrarIdPorNome(nomeGrupo);
            
            if (!idGrupo) return msg.reply(`❌ Grupo não encontrado.`);

            CONFIG.GRUPOS[idGrupo].FILA_AGUARDANDO_APROVACAO = [];
            CONFIG.GRUPOS[idGrupo].TURNO_SALVO = ""; // Apaga o turno salvo para ele tentar de novo
            
            const fs = require('fs');
            fs.writeFileSync('./config.json', JSON.stringify(CONFIG, null, 4));

            msg.reply(`🗑️ Lista rejeitada! O Garimpeiro vai fazer uma nova busca na próxima rodada do automático.`);
        }

        if (msg.body.startsWith('!setgeral ')) {
            const partes = msg.body.split(' ');
            if (partes.length < 3) return;
            const chave = partes[1].toUpperCase();
            let valorFinal = msg.body.substring(msg.body.indexOf(partes[2]));
            if (CONFIG.GERAL[chave] === undefined) return;
            if (typeof CONFIG.GERAL[chave] === 'number') valorFinal = Number(valorFinal);
            if (typeof CONFIG.GERAL[chave] === 'boolean') valorFinal = valorFinal.toLowerCase() === 'true';
            setGeral(chave, valorFinal);
            await msg.reply(`✅ Config Geral *${chave}* atualizada!`);
        }
    });
}

module.exports = { carregarComandos };