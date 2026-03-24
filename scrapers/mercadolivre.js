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
            
            // 🪄 MUDANÇA: Transformamos em Array para poder usar o 'await' dentro do loop
            let cartoes = $('.poly-card, .ui-search-layout__item').toArray(); 
            
            if (cartoes.length === 0) {
                console.log('   ⚠️ Nenhum cartão de produto encontrado nesta página. Fim das ofertas.');
                break; 
            }

            let cartoesAnalisadosNaPagina = 0;

            for (const elemento of cartoes) {
                if (produtos.length >= regrasDoGrupo.QTD_ATUAL) break; 
                cartoesAnalisadosNaPagina++;

                const linkOriginal = $(elemento).find('a').attr('href');
                let titulo = $(elemento).find('[class*="poly-component__title"], .ui-search-item__title, h2').first().text().trim();

                if (titulo && linkOriginal) {
                    const linkLimpo = linkOriginal.split('?')[0];
                    
                    // Checagem de Memória de Dias (Ignora se for recente)
                    if (foiEnviadoRecentemente(linkLimpo, regrasDoGrupo.DIAS_PARA_REPETIR_PRODUTO)) return true;

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
                            
                            // 🛡️ A BARREIRA FINAL: Tenta gerar o link antes de aprovar!
                            console.log(`   ⏳ Validando Link de Afiliado para: ${titulo}...`);
                            const linkComissionado = await gerarLinkAfiliadoML(linkOriginal);

                            if (linkComissionado) {
                                // Salva na fila já com o link pronto e comissionado!
                                produtos.push({ titulo, preco, precoAntigo, linkOriginal, linkLimpo, linkComissionado, desconto: descontoNumero, nota: notaNumero, vendas: vendasNumero });
                                console.log(`   ⭐ APROVADO: ${titulo}`);
                                console.log(`      ↳ Link Afiliado OK: ${linkComissionado}`);
                            } else {
                                console.log(`   ❌ REPROVADO: Falha ao converter link de afiliado.`);
                            }
                            
                        } else {
                            console.log(`   ❌ REPROVADO: ${titulo}`);
                            console.log(`      ↳ Exigido: Desc >= ${regrasDoGrupo.DESCONTO_ATUAL}% | Nota >= ${regrasDoGrupo.NOTA_ATUAL} | Vendas >= ${regrasDoGrupo.VENDAS_ATUAIS}`);
                        }
                    }
                }
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
    
    console.log(`\n📊 Resumo da busca: ${produtos.length} produtos perfeitos encontrados em ${paginasVasculhadas} página(s) lida(s).\n`);
    return produtos;
}

async function gerarLinkAfiliadoML(linkOriginal) {
    try {
        const urlApiInterna = 'https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink'; 
        const resposta = await axios.post(urlApiInterna, { urls: [linkOriginal], tag: CONFIG.GERAL.TAG_AFILIADO }, {
            headers: {
                'Content-Type': 'application/json',
                'Cookie': CONFIG.GERAL.COOKIE_ML, 
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Origin': 'https://www.mercadolivre.com.br'
            }
        });
        
        if (resposta.data?.urls?.[0]?.short_url) {
            return resposta.data.urls[0].short_url; // Sucesso!
        }
        return null; // 🪄 Falhou na conversão (devolve nulo em vez de devolver o link original)
    } catch (erro) {
        return null; // 🪄 Falhou por erro de rede/cookie
    }
}

module.exports = { buscarOfertasML, gerarLinkAfiliadoML };