// scrapers/amazon.js
const { chromium } = require('playwright');
const { CONFIG } = require('../config');
const { foiEnviadoRecentemente } = require('../memoria');

async function buscarOfertas(regrasDoGrupo) {
    console.log(`\n==================================================`);
    console.log(`🛒 INICIANDO BUSCA NA AMAZON: ${regrasDoGrupo.NOME}`);
    console.log(`==================================================`);
    
    const produtos = [];
    const TAG_AFILIADO = CONFIG.GERAL.TAG_AMAZON || "pedroguterres-20";

    const browser = await chromium.launch({ headless: true }); 
    const page = await browser.newPage();
    const url = "https://www.amazon.com.br/deals?ref_=nav_cs_gb";
    
    try {
        console.log(`   🌐 Acessando a página de Ofertas da Amazon...`);
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        
        const filtroBebe = page.locator('label').filter({ has: page.locator('input[value="17242604011"]') });
        try {
            await filtroBebe.waitFor({ state: 'visible', timeout: 15000 });
            await filtroBebe.click({ force: true });
            console.log("   ⏳ Filtro clicado. Aguardando carregar os produtos...");
        } catch (e) {
            console.log("   ⚠️ Aviso: Filtro não encontrado, prosseguindo com as ofertas gerais.");
        }
        
        await page.waitForTimeout(5000);

        console.log("   🔄 Rolando a página para forçar a Amazon a carregar mais ofertas...");
        for (let i = 0; i < 6; i++) { // Rola a página 6 vezes para baixo
            await page.evaluate(() => window.scrollBy(0, 1500));
            await page.waitForTimeout(1500); // Dá 1.5 segundos pra Amazon processar cada rolagem
        }

        const linksNaPagina = await page.$$('a');
        const linksJaAnalisados = new Set();

        for (const link of linksNaPagina) {
            if (produtos.length >= regrasDoGrupo.QTD_ATUAL) break; 

            const href = await link.getAttribute('href');
            
            if (href && (href.includes('/dp/') || href.includes('/deal/'))) {
                const linkCompleto = href.startsWith('http') ? href : `https://www.amazon.com.br${href}`;
                const linkLimpo = linkCompleto.split('?')[0];
                
                if (linksJaAnalisados.has(linkLimpo)) continue;

                // 👇 INJEÇÃO NO NAVEGADOR: PESCANDO OS DADOS ENXUTOS 👇
                const detalhes = await link.evaluate(el => {
                    let alt = '';
                    let precos = [];
                    let descontoTexto = '';
                    let notaTexto = '';

                    let parent = el.parentElement;
                    for(let i=0; i<5; i++) {
                        if(!parent) break;
                        
                        // Busca apenas o título (alt da imagem)
                        if (!alt) {
                            const imgEl = parent.querySelector('img');
                            if(imgEl) alt = imgEl.getAttribute('alt') || '';
                        }

                        // Busca o preço escondido
                        if (precos.length === 0) {
                            const priceEls = parent.querySelectorAll('.a-price .a-offscreen');
                            if (priceEls.length > 0) {
                                precos = Array.from(priceEls).map(p => p.innerText.trim());
                            }
                        }
                        
                        // Busca o desconto
                        if (!descontoTexto) {
                            const match = parent.innerText.match(/(\d{1,2})%\s?(off|de desconto)/i);
                            if (match) descontoTexto = match[1];
                        }

                        // Busca as estrelas
                        if (!notaTexto) {
                            const ratingEl = parent.querySelector('.a-icon-alt');
                            if (ratingEl) notaTexto = ratingEl.innerText;
                        }

                        if (alt && precos.length > 0) break;
                        parent = parent.parentElement;
                    }
                    
                    return { alt, precos, descontoTexto, notaTexto };
                });

                let titulo = detalhes.alt;
                
                if (titulo && titulo.length > 5) {
                    linksJaAnalisados.add(linkLimpo);

                    if (foiEnviadoRecentemente(linkLimpo, regrasDoGrupo.DIAS_PARA_REPETIR_PRODUTO)) continue;

                    // 👇 PREÇO FORMATADO SEM CENTAVOS 👇
                    let precoFormatado = "Ver no site";
                    let precoAntigoFormatado = "";
                    
                    if (detalhes.precos.length > 0) {
                        const precosUnicos = [...new Set(detalhes.precos)]; 
                        
                        // Extrai tudo, exceto letras
                        let precoSujo = precosUnicos[0].replace(/[^\d,.]/g, '').trim(); 
                        if(precoSujo) precoFormatado = precoSujo.split(',')[0]; 

                        if (precosUnicos.length > 1) {
                            let precoAntigoSujo = precosUnicos[precosUnicos.length - 1].replace(/[^\d,.]/g, '').trim();
                            if(precoAntigoSujo) precoAntigoFormatado = precoAntigoSujo.split(',')[0];
                        }
                    }

                    let notaNumero = 4.5;
                    const matchNota = detalhes.notaTexto.match(/(\d+,\d+)/);
                    if (matchNota) notaNumero = parseFloat(matchNota[1].replace(',', '.'));

                    const tituloMinusculo = titulo.toLowerCase();
                    const passaPalavraChave = !regrasDoGrupo.PALAVRAS_CHAVE || regrasDoGrupo.PALAVRAS_CHAVE.length === 0 || regrasDoGrupo.PALAVRAS_CHAVE.some(palavra => tituloMinusculo.includes(palavra.toLowerCase()));

                    if (passaPalavraChave) {
                        const linkComissionado = `${linkLimpo}?tag=${TAG_AFILIADO}`;

                        produtos.push({ 
                            titulo: titulo, 
                            preco: precoFormatado, 
                            precoAntigo: precoAntigoFormatado, 
                            linkOriginal: linkCompleto, 
                            linkLimpo: linkLimpo, 
                            linkComissionado: linkComissionado, 
                            desconto: parseInt(detalhes.descontoTexto) || 0, 
                            nota: notaNumero, 
                            vendas: 0, // 👈 Removido
                            imagem: "" // 👈 Removido
                        });
                        
                        console.log(`   ⭐ APROVADO: ${titulo.substring(0,30)}... | R$ ${precoFormatado}`);
                    }
                }
            }
        }
    } catch (error) {
        console.log("\n❌ Erro durante a extração da Amazon:", error.message);
    } finally {
        await browser.close(); 
    }
    
    return produtos; 
}

module.exports = { buscarOfertas };