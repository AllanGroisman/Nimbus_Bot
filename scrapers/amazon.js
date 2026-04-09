// scrapers/amazon.js
const { chromium } = require('playwright');
const { foiEnviadoRecentemente } = require('../memoria');
const { CONFIG, MAPEAMENTO_CATEGORIAS } = require('../config');

const ENVIAR_FOTO = true; 

async function buscarOfertas(regrasDoGrupo) {
    const dicionarioDaCategoria = MAPEAMENTO_CATEGORIAS[regrasDoGrupo.CATEGORIA] || MAPEAMENTO_CATEGORIAS['BEBE'];
    const LABEL_AMAZON = dicionarioDaCategoria.AMAZON_LABEL || 'Bebês';

    console.log(`\n==================================================`);
    console.log(`🛒 INICIANDO DEEP SCRAPING NA AMAZON: ${regrasDoGrupo.NOME}`);
    console.log(`==================================================`);
    
    const produtos = [];
    const TAG_AFILIADO = CONFIG.GERAL.TAG_AMAZON || "pedroguterres-20";

    const browser = await chromium.launch({ headless: true }); 
    const page = await browser.newPage();
    const url = "https://www.amazon.com.br/deals?ref_=nav_cs_gb";
    
    try {
        console.log(`   🌐 Acessando a página de ofertas: ${url}`);        
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        try {
            const botaoVerMais = page.locator('text="Ver mais"').first();
            if (await botaoVerMais.isVisible({ timeout: 5000 })) {
                await botaoVerMais.click({ force: true });
                console.log(`   📂 Expandindo departamentos...`);
                await page.waitForTimeout(1500); 
            }
        } catch (e) {}

        const filtroDinamico = page.locator('label').filter({ hasText: new RegExp(LABEL_AMAZON, 'i') }).first();
        try {
            await filtroDinamico.waitFor({ state: 'visible', timeout: 10000 });
            await filtroDinamico.click({ force: true });
            console.log(`   ⏳ Filtro [${LABEL_AMAZON}] ativado!`);
        } catch (e) {
            console.log(`   ⚠️ Filtro "${LABEL_AMAZON}" não encontrado. Pegando lista geral.`);
        }
        
        await page.waitForTimeout(5000);

        console.log("   🔄 Rolando a página para capturar os links...");
        for (let i = 0; i < 6; i++) { 
            await page.evaluate(() => window.scrollBy(0, 1500));
            await page.waitForTimeout(1500); 
        }

        const urlsBrutas = await page.$$eval('a', links => links.map(a => a.href));
        const urlsValidas = urlsBrutas.filter(href => href && (href.includes('/dp/') || href.includes('/deal/') || href.includes('/d/')));
        
        const linksLimposParaVisitar = [...new Set(urlsValidas.map(link => {
            const limpo = link.split('?')[0];
            return limpo.startsWith('http') ? limpo : `https://www.amazon.com.br${limpo}`;
        }))];

        console.log(`   🎯 Foram encontrados ${linksLimposParaVisitar.length} links potenciais. Iniciando inspeção profunda...`);

        for (let i = 0; i < linksLimposParaVisitar.length; i++) {
            if (produtos.length >= regrasDoGrupo.QTD_ATUAL) break; 

            const linkLimpo = linksLimposParaVisitar[i];
            
            if (foiEnviadoRecentemente(linkLimpo, regrasDoGrupo.DIAS_PARA_REPETIR_PRODUTO)) continue;

            console.log(`\n   🕵️‍♂️ Inspecionando produto (${produtos.length + 1}/${regrasDoGrupo.QTD_ATUAL}): ${linkLimpo.split('/')[4] || 'Item'}`);
            
            const tempoDeEspera = Math.floor(Math.random() * 2000) + 3000;
            await page.waitForTimeout(tempoDeEspera);

            try {
                await page.goto(linkLimpo, { waitUntil: 'domcontentloaded', timeout: 15000 });
            } catch (e) {
                console.log(`   ⚠️ Erro ao carregar a página do produto. Pulando para o próximo.`);
                continue;
            }

            const detalhes = await page.evaluate((capturarFoto) => {
                let alt = document.querySelector('#productTitle')?.innerText?.trim() || '';

                let precoSujo = '';
                const precoEl = document.querySelector('.priceToPay .a-offscreen') 
                             || document.querySelector('#corePriceDisplay_desktop_feature_div .a-price .a-offscreen') 
                             || document.querySelector('#corePrice_feature_div .a-price .a-offscreen')
                             || document.querySelector('.apexPriceToPay .a-offscreen');
                             
                if (precoEl) precoSujo = precoEl.textContent.trim();

                if (!precoSujo) {
                    const whole = document.querySelector('.priceToPay .a-price-whole') || document.querySelector('#corePriceDisplay_desktop_feature_div .a-price-whole');
                    const fraction = document.querySelector('.priceToPay .a-price-fraction') || document.querySelector('#corePriceDisplay_desktop_feature_div .a-price-fraction');
                    if (whole) {
                        precoSujo = whole.textContent.replace(/[.,]/g, '').trim() + (fraction ? ',' + fraction.textContent.trim() : '');
                    }
                }

                let precoAntigoSujo = '';
                const precoAntigoEl = document.querySelector('.basisPrice .a-offscreen') 
                                   || document.querySelector('#corePriceDisplay_desktop_feature_div .basisPrice .a-offscreen')
                                   || document.querySelector('.a-text-strike');
                if (precoAntigoEl) precoAntigoSujo = precoAntigoEl.textContent.trim();

                let descontoTexto = '';
                const descontoEl = document.querySelector('.savingsPercentage');
                if (descontoEl) descontoTexto = descontoEl.textContent.replace(/\D/g, '');

                let notaTexto = '';
                const notaEl = document.querySelector('#acrPopover') || document.querySelector('#averageCustomerReviews');
                if (notaEl) notaTexto = notaEl.getAttribute('title') || notaEl.textContent;

                let img = '';
                if (capturarFoto) {
                    const imgEl = document.querySelector('#landingImage') || document.querySelector('#imgBlkFront') || document.querySelector('.a-dynamic-image');
                    if (imgEl) {
                        const dynamic = imgEl.getAttribute('data-a-dynamic-image');
                        if (dynamic) {
                            try { 
                                const imagensObjeto = JSON.parse(dynamic);
                                img = Object.keys(imagensObjeto).pop() || Object.keys(imagensObjeto)[0]; 
                            } catch(e) {}
                        }
                        if (!img) img = imgEl.getAttribute('data-old-hires') || imgEl.getAttribute('src') || '';

                        if (img) img = img.replace(/\/images\/I\/([a-zA-Z0-9+%-]+)\.[a-zA-Z0-9._-]+(\.[a-zA-Z]+)$/, '/images/I/$1$2');
                    }
                }

                return { alt, img, precoSujo, precoAntigoSujo, descontoTexto, notaTexto };
            }, ENVIAR_FOTO); 

            let titulo = detalhes.alt;
            
            if (titulo && titulo.length > 5) {
                // 👇 Tratamento matemático para preços 👇
                let precoFormatado = "Ver no site";
                let precoFloat = 0;
                
                if (detalhes.precoSujo) {
                    precoFormatado = detalhes.precoSujo.replace(/[^\d,.]/g, '').split(',')[0].trim();
                    // Limpa tudo (R$, espaços, pontos de milhar) para fazer conta: "1.299,99" -> 1299.99
                    let valorLimpo = detalhes.precoSujo.replace(/[^\d,]/g, '');
                    precoFloat = parseFloat(valorLimpo.replace(',', '.'));
                }

                let precoAntigoFormatado = "";
                let precoAntigoFloat = 0;
                
                if (detalhes.precoAntigoSujo) {
                    precoAntigoFormatado = detalhes.precoAntigoSujo.replace(/[^\d,.]/g, '').split(',')[0].trim();
                    let valorLimpoAntigo = detalhes.precoAntigoSujo.replace(/[^\d,]/g, '');
                    precoAntigoFloat = parseFloat(valorLimpoAntigo.replace(',', '.'));
                }

                let notaNumero = 4.5; 
                if (detalhes.notaTexto) {
                    let matchNota = detalhes.notaTexto.match(/(\d+)[.,](\d+)/);
                    if (matchNota) notaNumero = parseFloat(`${matchNota[1]}.${matchNota[2]}`);
                }

                let descontoNumero = parseInt(detalhes.descontoTexto) || 0;

                // 👇 A CALCULADORA DE DESCONTO INTELIGENTE 👇
                if (descontoNumero === 0 && precoFloat > 0 && precoAntigoFloat > precoFloat) {
                    // (Antigo - Novo) / Antigo * 100
                    descontoNumero = Math.round(((precoAntigoFloat - precoFloat) / precoAntigoFloat) * 100);
                    // Se quiser ver quando ele teve que calcular sozinho, tire as barras do console abaixo:
                    // console.log(`   🧮 Desconto calculado matematicamente: ${descontoNumero}%`);
                }

                const tituloMinusculo = titulo.toLowerCase();
                const passaPalavraChave = !regrasDoGrupo.PALAVRAS_CHAVE || regrasDoGrupo.PALAVRAS_CHAVE.length === 0 || regrasDoGrupo.PALAVRAS_CHAVE.some(palavra => tituloMinusculo.includes(palavra.toLowerCase()));

                if (passaPalavraChave) {
                    // Agora ele usa a variável descontoNumero (que pode ter sido calculada acima) para aprovar
                    if (notaNumero >= regrasDoGrupo.NOTA_ATUAL && descontoNumero >= regrasDoGrupo.DESCONTO_ATUAL) {
                        const linkComissionado = `${linkLimpo}?tag=${TAG_AFILIADO}`;

                        produtos.push({ 
                            titulo: titulo, 
                            preco: precoFormatado, 
                            precoAntigo: precoAntigoFormatado, 
                            linkOriginal: linkLimpo, 
                            linkLimpo: linkLimpo, 
                            linkComissionado: linkComissionado, 
                            desconto: descontoNumero, 
                            nota: notaNumero, 
                            vendas: 0, 
                            imagem: ENVIAR_FOTO ? detalhes.img : "" 
                        });
                        
                        console.log(`   ✅ APROVADO: ${titulo.substring(0,30)}... | R$ ${precoFormatado} | ⭐ ${notaNumero} | 📉 ${descontoNumero}%`);
                    } else {
                        console.log(`   ❌ REPROVADO: Nota (${notaNumero}) ou Desconto (${descontoNumero}%) baixos.`);
                    }
                } else {
                    console.log(`   ❌ REPROVADO: Falhou no filtro de palavras-chave.`);
                }
            } else {
                console.log(`   ⚠️ Produto sem título válido ou esgotado. Ignorado.`);
            }
        }
    } catch (error) {
        console.log("\n❌ Erro crítico no Scraper da Amazon:", error.message);
    } finally {
        await browser.close(); 
    }
    
    return produtos; 
}

module.exports = { buscarOfertas };