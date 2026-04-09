// motor.js

// Importação das dependências e configurações necessárias
const { CONFIG, setGrupo } = require('./config'); // Variáveis de configuração e função para atualizar o estado dos grupos
const { salvarNoHistorico } = require('./memoria'); // Função para salvar produtos já enviados e evitar repetição
const { esperar, converterParaMinutos } = require('./utils'); // Funções utilitárias (ex: pausa no código, conversão de tempo)
const { MessageMedia } = require('whatsapp-web.js'); // Biblioteca do WhatsApp para envio de mídias (fotos)

// Variável de controle (Semaforo) para garantir que o robô não tente fazer duas buscas ao mesmo tempo
let roboOcupado = false;

// Exporta o status para o painel de comandos saber se ele tá ocupado e evitar sobrecarga
function obterStatusRobo() {
    return roboOcupado;
}

// ==========================================
// 1. O GARIMPEIRO (Busca de Produtos)
// ==========================================
// Função responsável por vasculhar o Mercado Livre atrás de ofertas de acordo com as regras do grupo
async function rodarRoboDeOfertas(client, idGrupoEspecifico = null) {
    // Se o robô já estiver rodando, aborta a execução para não duplicar processos
    if (roboOcupado) {
        console.log('⚠️ O Garimpeiro já está ocupado. Aguarde.');
        return;
    }
    roboOcupado = true; // Trava o robô

    // Define se vai rodar para um grupo específico (comando manual) ou para todos os grupos cadastrados
    let idsDosGrupos = idGrupoEspecifico ? [idGrupoEspecifico] : Object.keys(CONFIG.GRUPOS);

    for (const idGrupo of idsDosGrupos) {
        const regrasDoGrupo = CONFIG.GRUPOS[idGrupo];
        const agora = new Date();
        
        // Converte a hora atual para minutos totais desde a meia-noite (facilita cálculos matemáticos de intervalo)
        const minutosAtuais = (agora.getHours() * 60) + agora.getMinutes();
        const dataHoje = agora.toLocaleDateString();

        // Procura se o grupo possui algum "Turno" configurado que esteja rodando AGORA
        const turnoEncontrado = regrasDoGrupo.TURNOS.find(t => {
            const inicioMin = converterParaMinutos(t.inicio);
            const fimMin = converterParaMinutos(t.fim);
            return minutosAtuais >= inicioMin && minutosAtuais <= fimMin;
        });

        // Se não encontrou turno, pula para o próximo grupo do loop
        if (!turnoEncontrado) {
            console.log(`🌙 Grupo ${regrasDoGrupo.NOME} fora de horário comercial.`);
            continue;
        }

        // Verifica se este turno específico já foi rodado/processado hoje
        const ehMesmoTurno = regrasDoGrupo.TURNO_SALVO === turnoEncontrado.id && regrasDoGrupo.DATA_SALVA === dataHoje;

        // 👇 NOVA LÓGICA DE ESPERA 👇
        // Se o robô já operou neste turno hoje, ele verifica o status das filas
        if (ehMesmoTurno) {
            // Se já tem produto esperando aprovação do admin, ele não busca mais nada
            if (regrasDoGrupo.FILA_AGUARDANDO_APROVACAO && regrasDoGrupo.FILA_AGUARDANDO_APROVACAO.length > 0) {
                console.log(`⏳ Aguardando aprovação do admin para o grupo ${regrasDoGrupo.NOME}.`);
                continue;
            }
            // Se a fila de envios acabou, significa que o turno já foi concluído com sucesso
            if (regrasDoGrupo.FILA_DE_PRODUTOS.length === 0) {
                console.log(`✅ O turno ${turnoEncontrado.id} já foi finalizado hoje.`);
                continue;
            } else {
                // Se a fila tem produtos, ele simplesmente deixa o Despachante trabalhar
                console.log(`♻️ A fila já está cheia. O Despachante cuidará do envio.`);
                continue;
            }
        }

        // Define os parâmetros de busca baseados no tipo do turno (Relâmpago ou Padrão)
        const isRelampago = turnoEncontrado.modo === 'RELAMPAGO';
        regrasDoGrupo.ROTA_ATUAL = isRelampago ? regrasDoGrupo.ROTA_RELAMPAGO : regrasDoGrupo.ROTA_PADRAO;
        regrasDoGrupo.DESCONTO_ATUAL = isRelampago ? regrasDoGrupo.DESCONTO_MINIMO_RELAMPAGO : regrasDoGrupo.DESCONTO_MINIMO_PADRAO;
        regrasDoGrupo.VENDAS_ATUAIS = isRelampago ? regrasDoGrupo.VENDAS_MINIMAS_RELAMPAGO : regrasDoGrupo.VENDAS_MINIMAS_PADRAO;
        regrasDoGrupo.NOTA_ATUAL = isRelampago ? regrasDoGrupo.NOTA_MINIMA_RELAMPAGO : regrasDoGrupo.NOTA_MINIMA_PADRAO;

        // Calcula a duração total do turno em minutos
        const inicioMin = converterParaMinutos(turnoEncontrado.inicio);
        const fimMin = converterParaMinutos(turnoEncontrado.fim);
        const minutosTotaisDoTurno = fimMin - inicioMin;
        
        // Calcula QUANTOS produtos ele precisa buscar no total para preencher o turno
        // Ex: Turno de 60 mins, intervalo de 10 mins = 6 produtos
        const qtdTotalDoTurno = Math.max(1, Math.floor(minutosTotaisDoTurno / turnoEncontrado.intervaloMin));
        
        // 👇 A MATEMÁTICA NOVA: Verifica quantos já estão na fila oficial para buscar só a diferença 👇
        const qtdFaltante = qtdTotalDoTurno - regrasDoGrupo.FILA_DE_PRODUTOS.length;

        // Se já tem produto suficiente para o turno, ele salva que o turno foi concluído e pula
        if (qtdFaltante <= 0) {
            console.log(`✅ A fila do grupo ${regrasDoGrupo.NOME} já está cheia (${regrasDoGrupo.FILA_DE_PRODUTOS.length}/${qtdTotalDoTurno}).`);
            CONFIG.GRUPOS[idGrupo].TURNO_SALVO = turnoEncontrado.id;
            CONFIG.GRUPOS[idGrupo].DATA_SALVA = dataHoje;
            continue; 
        }

        console.log(`\n🔍 Iniciando garimpo para ${regrasDoGrupo.NOME} | Turno: ${turnoEncontrado.id} (Buscando ${qtdFaltante} faltantes)`);
        
        console.log(`\n🔍 Iniciando garimpo para ${regrasDoGrupo.NOME} | Turno: ${turnoEncontrado.id} (Buscando ${qtdFaltante} faltantes)`);
        
        try {
            let novosProdutos = [];
            let qtdRestante = qtdFaltante;
            let lojasRestantes = regrasDoGrupo.LOJAS.length;

            // 👇 DIVISÃO JUSTA E DINÂMICA DAS LOJAS 👇
            for (const loja of regrasDoGrupo.LOJAS) {
                if (qtdRestante <= 0) break; // Se já encheu as vagas, encerra as buscas

                // Divide a meta restante pelo número de lojas que ainda faltam rodar.
                // Usamos Math.ceil para arredondar pra cima (ex: 5 vagas / 2 lojas = 3 de meta)
                let metaPorLoja = Math.ceil(qtdRestante / lojasRestantes);

                console.log(`   🛒 Buscando na loja: ${loja}... (Cota: ${metaPorLoja} produtos)`);
                try {
                    const scraper = require(`./scrapers/${loja.toLowerCase()}`);
                    
                    regrasDoGrupo.QTD_ATUAL = metaPorLoja; 
                    
                    const produtosDaLoja = await scraper.buscarOfertas(regrasDoGrupo);

                    if (produtosDaLoja && Array.isArray(produtosDaLoja)) {
                        novosProdutos = novosProdutos.concat(produtosDaLoja);
                        qtdRestante -= produtosDaLoja.length; // Desconta o que achou da meta final
                    }
                } catch (erroDeLoja) {
                    if (erroDeLoja.code === 'MODULE_NOT_FOUND') {
                        console.log(`   ⚠️ Scraper 'scrapers/${loja.toLowerCase()}.js' ainda não existe. Pulando...`);
                    } else {
                        console.log(`   ❌ Erro ao rodar a loja ${loja}: ${erroDeLoja.message}`);
                    }
                }
                lojasRestantes--; // Avisa que uma loja já foi
            }

            // 👇 A MÁGICA DO EMBARALHAMENTO (Algoritmo Fisher-Yates) 👇
            for (let i = novosProdutos.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                // Troca a posição dos produtos aleatoriamente no array
                [novosProdutos[i], novosProdutos[j]] = [novosProdutos[j], novosProdutos[i]]; 
            }

            // 👇 TRAVA DE SEGURANÇA 👇
            if (novosProdutos.length === 0) {
                console.log(`⚠️ Nenhuma loja retornou produtos válidos para ${regrasDoGrupo.NOME}.`);
                continue; 
            }

            // 👇 COLOCANDO NA FILA DE ESPERA (Aprovação) 👇
            CONFIG.GRUPOS[idGrupo].FILA_AGUARDANDO_APROVACAO = novosProdutos;
            setGrupo(idGrupo, 'TURNO_SALVO', turnoEncontrado.id);
            setGrupo(idGrupo, 'DATA_SALVA', dataHoje);

            // Monta a mensagem que será enviada para o administrador aprovar os produtos
            let textoAprovacao = `🚨 *APROVAÇÃO PENDENTE - ${regrasDoGrupo.NOME}* 🚨\nTurno: ${turnoEncontrado.id}\n\n`;
            novosProdutos.forEach((prod, idx) => {
                // Adicionamos a tag de onde o produto veio para você saber no menu de aprovação
                const origem = prod.linkOriginal.includes('amazon') ? '🛒 AMZ' : '🛒 ML';
                textoAprovacao += `*${idx + 1}.* [${origem}] ${prod.titulo.substring(0, 30)}... (R$ ${prod.preco})\n`;
            });
            textoAprovacao += `\n✅ Aprovar TODOS:\n*!aprovar ${regrasDoGrupo.NOME}*\n\n✅ Aprovar alguns:\n*!aprovar ${regrasDoGrupo.NOME} 1,3,4*\n\n❌ Rejeitar e buscar novos:\n*!rejeitar ${regrasDoGrupo.NOME}*`;

            const idGrupoAdmin = CONFIG.GERAL.ID_GRUPO_ADMIN; 
            
            await client.sendMessage(idGrupoAdmin, textoAprovacao);
            console.log(`\n⏸️ Menu de aprovação enviado para o Grupo Admin. Aguardando comandos...`);
            console.log(`✅ ${novosProdutos.length} produtos embaralhados enviados para a fila de espera.\n`);

        } catch (erro) {
            console.log("❌ Erro fatal no Garimpeiro:", erro);
        }
    }
    
    roboOcupado = false; // Libera o robô para a próxima execução
}

// ==========================================
// 2. O DESPACHANTE (Envio Programado)
// ==========================================
// Função que fica rodando em background (loop contínuo) para enviar os produtos na hora certa
function iniciarDespachante(client) {
    // Roda a cada 30 segundos (30 * 1000 milissegundos)
    setInterval(async () => {
        // Trava geral: se o piloto automático estiver desligado, ele não faz nada
        if (!CONFIG.GERAL.PILOTO_AUTOMATICO_LIGADO) return;

        const agora = new Date();
        const minutosAtuais = (agora.getHours() * 60) + agora.getMinutes();
        const agoraMS = agora.getTime(); // Pega a hora exata em milissegundos (timestamp)
        const dataHoje = agora.toLocaleDateString();

        // Passa por todos os grupos configurados
        for (const idGrupo in CONFIG.GRUPOS) {
            const regras = CONFIG.GRUPOS[idGrupo];
            let fila = regras.FILA_DE_PRODUTOS; // Fila oficial (já aprovada)
            
            // Identifica se estamos dentro de algum turno agora
            const turnoAtual = regras.TURNOS.find(t => {
                const inicioMin = converterParaMinutos(t.inicio);
                const fimMin = converterParaMinutos(t.fim);
                return minutosAtuais >= inicioMin && minutosAtuais <= fimMin;
            });

            // Se os produtos na fila não tem um 'horarioEnvio' definido, a fila é resetada por segurança
            if (fila.length > 0 && !fila[0].horarioEnvio) {
                setGrupo(idGrupo, 'FILA_DE_PRODUTOS', []);
                continue;
            }

            // Se estivermos num turno e houver itens na fila
            if (turnoAtual && fila.length > 0) {
                const fimMin = converterParaMinutos(turnoAtual.fim);
                // Se faltar 5 minutos ou menos para o turno acabar, descarta a fila para não invadir horário de descanso
                if (fimMin - minutosAtuais <= 5) {
                    console.log(`⏰ Fim do turno se aproximando. Descartando a fila...`);
                    setGrupo(idGrupo, 'FILA_DE_PRODUTOS', []);
                    continue;
                }
            }

            // Lógica principal de envio
            if (fila.length > 0) {
                // Se o momento atual passou ou for igual ao horário agendado para envio do primeiro produto da fila
                if (agoraMS >= fila[0].horarioEnvio) {
                    const itemDaVez = fila.shift(); // Remove e pega o 1º item da fila
                    const prod = itemDaVez.produto;

                    console.log(`\n🚀 Disparando: ${prod.titulo}`);

                    // Prepara o design da mensagem dependendo do turno (Relâmpago ou Normal)
                    const isRelampago = turnoAtual ? turnoAtual.modo === 'RELAMPAGO' : false;
                    
                    // Formata a exibição do preço (mostra o preço antigo riscado, se existir)
                    let linhaPreco = `💰 *Preço:* R$ ${prod.preco}`;
                    if (prod.precoAntigo) linhaPreco = `💰 *Preço:* De ~R$ ${prod.precoAntigo}~ por *R$ ${prod.preco}*`;
                    
                    const emoji = isRelampago ? '⚡ *OFERTA RELÂMPAGO* ⚡' : '🔥 *OFERTA ENCONTRADA* 🔥';
                    
                    // Cria a tag de vendas apenas se o número for maior que zero
                    const textoVendas = prod.vendas > 0 ? ` (${prod.vendas}+ vendidos)` : '';

                    // Monta o texto final da mensagem para o WhatsApp
                    const textoMensagem = `${emoji}\n\n📦 *Produto:* ${prod.titulo}\n⭐ *Nota:* ${prod.nota}${textoVendas}\n📉 *Desconto:* ${prod.desconto}% OFF\n${linhaPreco}\n\n🛒 *Compre aqui:* ${prod.linkComissionado}`;
                    try {
                        const chat = await client.getChatById(idGrupo);
                        // Simula o bot "digitando..." por 2 segundos para parecer mais humano
                        await chat.sendStateTyping(); 
                        await esperar(2000); 

                        // Tenta baixar a imagem do produto do Mercado Livre para mandar com a mensagem
                        try {
                            if (prod.imagem && prod.imagem.startsWith('http')) {
                                console.log(`   📸 Baixando foto do produto...`);
                                const media = await MessageMedia.fromUrl(prod.imagem, { unsafeMime: true });
                                await client.sendMessage(idGrupo, media, { caption: textoMensagem }); // Envia imagem + legenda
                            } else {
                                await client.sendMessage(idGrupo, textoMensagem); // Se não tiver imagem, manda só o texto
                            }
                        } catch (erroDeMidia) {
                            // Tratamento de erro: Se falhar ao baixar a imagem, envia apenas o texto para não perder a oferta
                            console.log(`   ⚠️ Erro ao enviar foto, enviando apenas texto. Erro: ${erroDeMidia.message}`);
                            await client.sendMessage(idGrupo, textoMensagem);
                        } 
                        
                        // Salva no banco/memória para não enviar esse link repetido futuramente
                        salvarNoHistorico(prod.linkLimpo);
                        
                    } catch (e) {
                        console.log(`⚠️ Falha ao enviar o produto ao grupo. Erro: ${e.message}`);
                    }

                    // 👇 RECALCULANDO HORÁRIOS DA FILA RESTANTE 👇
                    // Garante que, após um envio, os próximos itens respeitem um "tempo de respiro" mínimo
                    if (fila.length > 0) {
                        const tempoRespiroMS = 3 * 60 * 1000; // 3 minutos de pausa entre mensagens (evita spam/ban)
                        let tempoMinimoSeguro = Date.now() + tempoRespiroMS;
                        let houveRecalculo = false;

                        for (let i = 0; i < fila.length; i++) {
                            // Se o agendamento do próximo item for menor que o tempo seguro, empurra ele pra frente
                            if (fila[i].horarioEnvio < tempoMinimoSeguro) {
                                fila[i].horarioEnvio = tempoMinimoSeguro;
                                houveRecalculo = true;
                            }
                            tempoMinimoSeguro = fila[i].horarioEnvio + tempoRespiroMS; 
                        }
                    }

                    // Atualiza a fila oficial no sistema após remover o item enviado e recalcular horários
                    setGrupo(idGrupo, 'FILA_DE_PRODUTOS', fila); 
                }
            } 
            // Se a fila oficial estiver vazia, o bot não estiver ocupado garimpando e ainda estivermos no turno
            else if (!roboOcupado && turnoAtual) {
                // Se a variável que anota se o turno já rodou não for a de hoje/agora...
                if (!(regras.TURNO_SALVO === turnoAtual.id && regras.DATA_SALVA === dataHoje)) {
                    // ...Ele acorda o "Garimpeiro" para buscar os produtos daquele turno
                    console.log(`\n⏰ Acordando o Garimpeiro para o turno ${turnoAtual.id}...`);
                    rodarRoboDeOfertas(client, idGrupo); 
                }
            }
        }
    }, 30 * 1000); // Fim do setInterval de 30 segundos
}

module.exports = { rodarRoboDeOfertas, iniciarDespachante, obterStatusRobo };