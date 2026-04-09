// scrapers/mercadolivre.js
const axios = require('axios');
const cheerio = require('cheerio');
const { CONFIG } = require('../config');
const { foiEnviadoRecentemente } = require('../memoria');

const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function buscarOfertasML(regrasDoGrupo) {
    console.log(`\n==================================================`);
    console.log(`🔍 INICIANDO BUSCA NA ROTA: ${regrasDoGrupo.ROTA_ATUAL}`);
    console.log(`==================================================`);
    
    const produtos = [];
    let paginaAtual = 1;
    let paginasVasculhadas = 0;

    while (produtos.length < regrasDoGrupo.QTD_ATUAL && paginasVasculhadas < regrasDoGrupo.LIMITE_PAGINAS_BUSCA) {
        console.log(`\n📄 Lendo a página ${paginaAtual}... (Meta: ${produtos.length}/${regrasDoGrupo.QTD_ATUAL} produtos)`);
        
        try {
            let urlDaBusca = `https://www.mercadolivre.com.br/ofertas${regrasDoGrupo.ROTA_ATUAL}`;
            const separador = urlDaBusca.includes('?') ? '&' : '?';
            urlDaBusca += `${separador}page=${paginaAtual}&_t=${new Date().getTime()}`;

            console.log(`   🌐 Acessando a URL: ${urlDaBusca}`);

            const { data } = await axios.get(urlDaBusca, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': 'https://www.mercadolivre.com.br/ofertas'
                }
            });
            
            const $ = cheerio.load(data);
            let cartoes = $('.poly-card, .ui-search-layout__item').toArray(); 
            
            if (cartoes.length === 0) {
                console.log('   ⚠️ Nenhum cartão de produto encontrado nesta página. Fim das ofertas.');
                break; 
            }

            let cartoesAnalisadosNaPagina = 0;

            for (const elemento of cartoes) {
                if (produtos.length >= regrasDoGrupo.QTD_ATUAL) break; 
                cartoesAnalisadosNaPagina++;

                // 👇 NOVO COLETE À PROVA DE BALAS INDIVIDUAL 👇
                try {
                    const linkOriginal = $(elemento).find('a').attr('href');
                    let titulo = $(elemento).find('[class*="poly-component__title"], .ui-search-item__title, h2').first().text().trim();

                    let imagem = $(elemento).find('img').first().attr('data-src') || $(elemento).find('img').first().attr('src') || '';
                    
                    if (titulo && linkOriginal) {
                        const linkLimpo = linkOriginal.split('?')[0];
                        
                        // 🐛 CORRIGIDO: Era 'return true', agora é 'continue'
                        if (foiEnviadoRecentemente(linkLimpo, regrasDoGrupo.DIAS_PARA_REPETIR_PRODUTO)) {
                            console.log(`   ♻️ IGNORADO: '${titulo.substring(0, 20)}...' (Já enviado hoje)`);
                            continue; 
                        }

                        let precoAntigo = $(elemento).find('.andes-money-amount--previous .andes-money-amount__fraction, .poly-price__old .andes-money-amount__fraction, s .andes-money-amount__fraction').first().text().trim();
                        let preco = $(elemento).find('.poly-price__current .andes-money-amount__fraction, .ui-search-price__second-line .andes-money-amount__fraction').first().text().trim(); 
                        
                        const descontoTexto = $(elemento).find('.andes-money-amount__discount, .ui-search-price__discount').first().text().trim();
                        const notaTexto = $(elemento).find('.poly-reviews__rating, .ui-search-reviews__rating-number').first().text().trim();
                        const vendasTexto = $(elemento).find('.poly-reviews__total, [class*="sales"], .ui-search-item__group__element--vendas').first().text().toLowerCase().trim();
                        
                        const descontoNumero = parseInt(descontoTexto.replace(/\D/g, '')) || 0;
                        const notaNumero = parseFloat(notaTexto.replace(',', '.')) || 0;
                        
                        let vendasNumero = parseInt(vendasTexto.replace(/\D/g, '')) || 0;
                        if (vendasTexto.includes('mil')) vendasNumero *= 1000;

                        const tituloMinusculo = titulo.toLowerCase();
                        const passaPalavraChave = regrasDoGrupo.PALAVRAS_CHAVE.length === 0 || regrasDoGrupo.PALAVRAS_CHAVE.some(palavra => tituloMinusculo.includes(palavra.toLowerCase()));

                        if (passaPalavraChave) {
                            const passaNoDesconto = descontoNumero >= regrasDoGrupo.DESCONTO_ATUAL;
                            const passaNaNota = notaNumero >= regrasDoGrupo.NOTA_ATUAL;
                            const passaNasVendas = vendasNumero >= regrasDoGrupo.VENDAS_ATUAIS;

                            if (passaNoDesconto && passaNaNota && passaNasVendas) {
                                
                                console.log(`   ⏳ Validando Link de Afiliado para: ${titulo.substring(0,35)}...`);
                                const linkComissionado = await gerarLinkAfiliadoML(linkOriginal);

                                if (linkComissionado) {
                                    produtos.push({ titulo, preco, precoAntigo, linkOriginal, linkLimpo, linkComissionado, desconto: descontoNumero, nota: notaNumero, vendas: vendasNumero, imagem: imagem });
                                    console.log(`   ⭐ APROVADO: ${titulo.substring(0,35)}...`);
                                } else {
                                    console.log(`   ❌ REPROVADO: Falha ao converter link.`);
                                }
                                
                            } else {
                                console.log(`   ❌ REPROVADO FILTROS: ${titulo.substring(0,25)}... (Desc: ${descontoNumero}% | Vendas: ${vendasNumero})`);
                            }
                        }
                    }
                } catch (erroNoCartao) {
                    console.log(`   ⚠️ PULANDO PRODUTO BIZARRO: Erro ao ler a estrutura do HTML.`);
                    continue; // Se der erro em um, pula pro próximo!
                }
                // 👆 FIM DO COLETE 👆
            }

            console.log(`   👁️ Cartões com a palavra-chave analisados nesta página: ${cartoesAnalisadosNaPagina}`);

            if (produtos.length < regrasDoGrupo.QTD_ATUAL) {
                paginaAtual++;
                paginasVasculhadas++;
                console.log(`   ⏳ Pausando 2 segundos antes de virar a página...`);
                await esperar(2000); 
            } else {
                paginasVasculhadas++; 
            }
        } catch (erro) {
            console.error(`\n❌ ERRO FATAL AO LER A PÁGINA ${paginaAtual}:`, erro.message);
            break; 
        }
    }
    
    console.log(`\n📊 Resumo da busca: ${produtos.length} produtos perfeitos encontrados em ${paginasVasculhadas} página(s).\n`);
    return produtos;
}

async function gerarLinkAfiliadoML(linkOriginal) {
    try {
        const urlApiInterna = 'https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink'; 
        const resposta = await axios.post(urlApiInterna, { urls: [linkOriginal], tag: CONFIG.GERAL.TAG_ML }, {
            headers: {
                'Content-Type': 'application/json',
                'Cookie': CONFIG.GERAL.COOKIE_ML, 
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Origin': 'https://www.mercadolivre.com.br'
            }
        });
        
        if (resposta.data?.urls?.[0]?.short_url) {
            return resposta.data.urls[0].short_url; 
        }
        return null; 
    } catch (erro) {
        return null; 
    }
}

module.exports = { buscarOfertas: buscarOfertasML, gerarLinkAfiliadoML};