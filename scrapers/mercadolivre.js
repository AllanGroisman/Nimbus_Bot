// scrapers/mercadolivre.js
const axios = require('axios');
const cheerio = require('cheerio');
const { CONFIG, ROTAS_ML } = require('../config');
const { carregarHistorico } = require('../memoria');

const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function buscarOfertasML(regrasDoGrupo) {
    console.log(`\n==================================================`);
    console.log(`🔍 INICIANDO BUSCA PARA A CATEGORIA: ${regrasDoGrupo.CATEGORIA_ESCOLHIDA}`);
    console.log(`==================================================`);
    
    const produtos = [];
    let paginaAtual = regrasDoGrupo.PAGINA_OFERTAS_INICIAL;
    let paginasVasculhadas = 0;
    const historico = carregarHistorico();

    while (produtos.length < regrasDoGrupo.QUANTIDADE_PRODUTOS && paginasVasculhadas < regrasDoGrupo.LIMITE_PAGINAS_BUSCA) {
        console.log(`\n📄 Lendo a página ${paginaAtual}... (Meta: ${produtos.length}/${regrasDoGrupo.QUANTIDADE_PRODUTOS} produtos)`);
        
        try {
            const rotaExata = ROTAS_ML[regrasDoGrupo.CATEGORIA_ESCOLHIDA] || '';
            let urlDaBusca = `https://www.mercadolivre.com.br/ofertas${rotaExata}`;
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
            let cartoes = $('.poly-card, .ui-search-layout__item'); 
            
            if (cartoes.length === 0) {
                console.log('   ⚠️ Nenhum cartão de produto encontrado nesta página. Fim das ofertas.');
                break; 
            }

            let cartoesAnalisadosNaPagina = 0;

            cartoes.each((i, elemento) => {
                if (produtos.length >= regrasDoGrupo.QUANTIDADE_PRODUTOS) return false; 
                cartoesAnalisadosNaPagina++;

                const linkOriginal = $(elemento).find('a').attr('href');
                let titulo = $(elemento).find('[class*="poly-component__title"], .ui-search-item__title, h2').first().text().trim();

                if (titulo && linkOriginal) {
                    const linkLimpo = linkOriginal.split('?')[0];
                    if (historico.includes(linkLimpo)) return true; // Ignora silenciosamente se já está na memória

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
                        const passaNoDesconto = descontoNumero >= regrasDoGrupo.DESCONTO_MINIMO;
                        const passaNaNota = notaNumero >= regrasDoGrupo.NOTA_MINIMA;
                        const passaNasVendas = vendasNumero >= regrasDoGrupo.VENDAS_MINIMAS;

                        if (passaNoDesconto && passaNaNota && passaNasVendas) {
                            produtos.push({ titulo, preco, precoAntigo, linkOriginal, linkLimpo, desconto: descontoNumero, nota: notaNumero, vendas: vendasNumero });
                            console.log(`   ⭐ APROVADO: ${titulo}`);
                            console.log(`      ↳ 📉 ${descontoNumero}% OFF | ⭐️ Nota ${notaNumero} | 📦 ${vendasNumero} vendas`);
                        } else {
                            console.log(`   ❌ REPROVADO: ${titulo}`);
                            console.log(`      ↳ Achou  : Desconto ${descontoNumero}% | Nota ${notaNumero} | Vendas ${vendasNumero}`);
                            console.log(`      ↳ Exigido: Desconto >= ${regrasDoGrupo.DESCONTO_MINIMO}% | Nota >= ${regrasDoGrupo.NOTA_MINIMA} | Vendas >= ${regrasDoGrupo.VENDAS_MINIMAS}`);
                        }
                    }
                }
            });

            console.log(`   👁️ Cartões com a palavra-chave analisados nesta página: ${cartoesAnalisadosNaPagina}`);

            if (produtos.length < regrasDoGrupo.QUANTIDADE_PRODUTOS) {
                paginaAtual++;
                paginasVasculhadas++;
                console.log(`   ⏳ Pausando 2 segundos antes de virar a página para evitar bloqueios...`);
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

// O gerador de link agora pega o cookie direto das configurações GERAIS
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
        if (resposta.data?.urls?.[0]?.short_url) return resposta.data.urls[0].short_url;
        return linkOriginal; 
    } catch (erro) {
        return linkOriginal; 
    }
}

module.exports = { buscarOfertasML, gerarLinkAfiliadoML };