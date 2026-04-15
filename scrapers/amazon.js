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
    const pageLista = await browser.newPage(); 
    const pageProduto = await browser.newPage(); 
    
    const url = "https://www.amazon.com.br/deals?ref_=nav_cs_gb";
    
    try {
        console.log(`   🌐 Acessando a página de ofertas: ${url}`);        
        await pageLista.goto(url, { waitUntil: 'domcontentloaded' });
        
        await pageLista.screenshot({ path: 'amazon_01_home.png', fullPage: true });

        try {
            const botaoVerMais = pageLista.locator('text="Ver mais"').first();
            if (await botaoVerMais.isVisible({ timeout: 5000 })) {
                await botaoVerMais.click({ force: true });
                console.log(`   📂 Expandindo departamentos...`);
                await pageLista.waitForTimeout(1500); 
                await pageLista.screenshot({ path: 'amazon_02_departamentos_expandidos.png', fullPage: true });
            }
        } catch (e) {}

        const filtroDinamico = pageLista.locator('label').filter({ hasText: new RegExp(LABEL_AMAZON, 'i') }).first();
        try {
            await filtroDinamico.waitFor({ state: 'visible', timeout: 10000 });
            await filtroDinamico.click({ force: true });
            console.log(`   ⏳ Filtro [${LABEL_AMAZON}] ativado!`);
            await pageLista.waitForTimeout(3000); 
            
            await pageLista.screenshot({ path: 'amazon_03_filtro_aplicado.png', fullPage: true });

        } catch (e) {
            console.log(`   ⚠️ Filtro "${LABEL_AMAZON}" não encontrado. Pegando lista geral.`);
            await pageLista.screenshot({ path: 'amazon_ERRO_filtro_nao_encontrado.png', fullPage: true });
        }
        
        await pageLista.waitForTimeout(3000);

        // 👇 NOVO: Limite amarrado à configuração do WhatsApp!
        let rolagens = 0;
        let linksInspecionadosNestaSessao = new Set(); 
        const MAX_ROLAGENS = regrasDoGrupo.LIMITE_PAGINAS_BUSCA || 5; 
        
        console.log(`   🔄 Limite máximo de rolagens configurado para: ${MAX_ROLAGENS}`);

        while (produtos.length < regrasDoGrupo.QTD_ATUAL && rolagens < MAX_ROLAGENS) {
            
            // 1. Extrai links APENAS do grid atual visível
            const urlsBrutas = await pageLista.$$eval('a', links => {
                const containerPrincipal = document.querySelector('[data-testid="grid-deals-container"]') || document;
                const ancoras = Array.from(containerPrincipal.querySelectorAll('a'));
                return ancoras.map(a => a.href);
            });

            const urlsValidas = urlsBrutas.filter(href => href && (href.includes('/dp/') || href.includes('/deal/') || href.includes('/d/')));
            
            let linksLimpos = [...new Set(urlsValidas.map(link => {
                const limpo = link.split('?')[0];
                return limpo.startsWith('http') ? limpo : `https://www.amazon.com.br${limpo}`;
            }))];

            // 2. Filtra os links que ele já viu nas rolagens anteriores
            let linksNovos = linksLimpos.filter(link => !linksInspecionadosNestaSessao.has(link));

            if (linksNovos.length > 0) {
                // Embaralha para pegar ofertas aleatórias da tela atual
                for (let i = linksNovos.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [linksNovos[i], linksNovos[j]] = [linksNovos[j], linksNovos[i]];
                }

                console.log(`\n   🎯 Encontrados ${linksNovos.length} links não inspecionados. Verificando...`);

                for (let i = 0; i < linksNovos.length; i++) {
                    if (produtos.length >= regrasDoGrupo.QTD_ATUAL) break; 

                    const linkLimpo = linksNovos[i];
                    linksInspecionadosNestaSessao.add(linkLimpo); // Marca como visto
                    
                    if (foiEnviadoRecentemente(linkLimpo, regrasDoGrupo.DIAS_PARA_REPETIR_PRODUTO)) continue;

                    const nomeNaUrl = linkLimpo.split('/')[3] ? decodeURIComponent(linkLimpo.split('/')[3]) : 'Item';
                    console.log(`\n   🕵️‍♂️ Inspecionando: ${nomeNaUrl.substring(0, 40)}...`); 
                    
                    const tempoDeEspera = Math.floor(Math.random() * 2000) + 2000; // Reduzi levemente a espera
                    await pageProduto.waitForTimeout(tempoDeEspera);

                    try {
                        await pageProduto.goto(linkLimpo, { waitUntil: 'domcontentloaded', timeout: 15000 });
                    } catch (e) {
                        console.log(`   ⚠️ Erro ao carregar a página do produto. Pulando.`);
                        continue;
                    }

                    const detalhes = await pageProduto.evaluate((capturarFoto) => {
                        let isCaptcha = document.querySelector('#captchacharacters') !== null || document.title.includes('Robot Check');

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

                        let vendasTexto = '';
                        const spanVendas = Array.from(document.querySelectorAll('span.a-size-small, span.a-size-base')).find(el => 
                            el.textContent.includes('comprados') || el.textContent.includes('compraram')
                        );
                        if (spanVendas) vendasTexto = spanVendas.textContent.trim();

                        let img = '';
                        if (capturarFoto && !isCaptcha) {
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

                        return { alt, img, precoSujo, precoAntigoSujo, descontoTexto, notaTexto, vendasTexto, isCaptcha };
                    }, ENVIAR_FOTO); 

                    if (detalhes.isCaptcha) {
                        console.log(`   🤖 ALERTA: A Amazon bloqueou a visualização com um Captcha. Pula para o próximo.`);
                        continue;
                    }

                    let titulo = detalhes.alt;
                    
                    if (titulo && titulo.length > 5) {
                        let precoFormatado = "Ver no site";
                        let precoFloat = 0;
                        if (detalhes.precoSujo) {
                            precoFormatado = detalhes.precoSujo.replace(/[^\d,.]/g, '').split(',')[0].trim();
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
                        if (descontoNumero === 0 && precoFloat > 0 && precoAntigoFloat > precoFloat) {
                            descontoNumero = Math.round(((precoAntigoFloat - precoFloat) / precoAntigoFloat) * 100);
                        }

                        let vendasNumero = 0;
                        if (detalhes.vendasTexto) {
                            const textoAjustado = detalhes.vendasTexto.toLowerCase();
                            let numeroExtraido = parseInt(textoAjustado.replace(/\D/g, '')) || 0;
                            vendasNumero = textoAjustado.includes('mil') ? numeroExtraido * 1000 : numeroExtraido;
                        }

                        const DESCONTO_ATUAL = regrasDoGrupo.AMZ_DESCONTO_MINIMO_PADRAO ?? regrasDoGrupo.DESCONTO_MINIMO_PADRAO ?? 0;
                        const NOTA_ATUAL = regrasDoGrupo.AMZ_NOTA_MINIMA_PADRAO ?? regrasDoGrupo.NOTA_MINIMA_PADRAO ?? 4.5;
                        const VENDAS_ATUAIS = regrasDoGrupo.AMZ_VENDAS_MINIMAS_PADRAO ?? regrasDoGrupo.VENDAS_MINIMAS_PADRAO ?? 0;

                        const tituloMinusculo = titulo.toLowerCase();
                        const passaPalavraChave = !regrasDoGrupo.PALAVRAS_CHAVE || regrasDoGrupo.PALAVRAS_CHAVE.length === 0 || regrasDoGrupo.PALAVRAS_CHAVE.some(palavra => tituloMinusculo.includes(palavra.toLowerCase()));
                        
                        const passaNoDesconto = descontoNumero >= DESCONTO_ATUAL;
                        const passaNaNota = notaNumero >= NOTA_ATUAL;
                        const passaNasVendas = vendasNumero >= VENDAS_ATUAIS;

                        if (passaPalavraChave && passaNoDesconto && passaNaNota && passaNasVendas) {
                            const linkComissionado = `${linkLimpo}?tag=${TAG_AFILIADO}`;
                            produtos.push({ 
                                titulo, preco: precoFormatado, precoAntigo: precoAntigoFormatado, 
                                linkOriginal: linkLimpo, linkLimpo, linkComissionado, 
                                desconto: descontoNumero, nota: notaNumero, vendas: vendasNumero, 
                                imagem: ENVIAR_FOTO ? detalhes.img : "" 
                            });
                            
                            console.log(`   ✅ APROVADO: ${titulo.substring(0,25)}... | R$ ${precoFormatado} | ⭐ ${notaNumero} | 📉 ${descontoNumero}% | 📦 ${vendasNumero}+`);
                            console.log(`      🔗 Link: ${linkLimpo}`); 
                        } else {
                            const motivos = [];
                            if (!passaPalavraChave) motivos.push("Palavra-Chave");
                            if (!passaNoDesconto) motivos.push(`Desconto (${descontoNumero}% < ${DESCONTO_ATUAL}%)`);
                            if (!passaNaNota) motivos.push(`Nota (${notaNumero} < ${NOTA_ATUAL})`);
                            if (!passaNasVendas) motivos.push(`Vendas (${vendasNumero} < ${VENDAS_ATUAIS})`);

                            console.log(`   ❌ REPROVADO: ${titulo.substring(0,30)}...`);
                            console.log(`      📊 Dados: R$ ${precoFormatado} | ⭐ ${notaNumero} | 📉 ${descontoNumero}% | 📦 ${vendasNumero}+`);
                            console.log(`      🚩 Motivo: ${motivos.join(', ')}`);
                        }
                    } else {
                        console.log(`   ⚠️ Produto sem título válido ou esgotado.`);
                    }
                }
            }

            // 👇 SÓ ROLA SE AINDA FALTAR PRODUTO E SE NÃO EXCEDER O LIMITE!
            if (produtos.length < regrasDoGrupo.QTD_ATUAL) {
                rolagens++;
                if (rolagens < MAX_ROLAGENS) {
                    console.log(`\n   🔄 Faltam produtos (${produtos.length}/${regrasDoGrupo.QTD_ATUAL}). Rolando a página para baixo (Rolagem ${rolagens}/${MAX_ROLAGENS})...`);
                    await pageLista.evaluate(() => window.scrollBy(0, 1500));
                    await pageLista.waitForTimeout(2000); // Espera a Amazon carregar os novos itens
                    
                    const printPath = `amazon_rolagem_${rolagens}.png`;
                    await pageLista.screenshot({ path: printPath, fullPage: true });
                } else {
                    console.log(`\n   🛑 Fim da linha! O robô atingiu o limite de ${MAX_ROLAGENS} rolagens na Amazon sem fechar a cota.`);
                }
            }
        }

    } catch (error) {
        console.log("\n❌ Erro crítico na Amazon:", error.message);
    } finally {
        await browser.close(); 
    }
    
    console.log(`\n📊 Resumo da busca na Amazon: ${produtos.length} produtos aprovados em ${rolagens} rolagens.\n`);
    return produtos; 
}

module.exports = { buscarOfertas };