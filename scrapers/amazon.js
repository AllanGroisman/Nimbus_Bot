// --- CONFIGURAÇÕES ---

// Sua tag de associado Amazon

const TAG_AFILIADO = "pedroguterres-20";



async function extrairPaginaDeOfertas() {

    console.log("Iniciando acesso à página principal de Ofertas...\n");

   

    // headless: false para ver o navegador abrindo.

    // Mude para true quando for deixar o bot rodando sozinho no servidor.

    const browser = await chromium.launch({ headless: false });

    const page = await browser.newPage();

    const url = "https://www.amazon.com.br/deals?ref_=nav_cs_gb";

   

    console.log(`Acessando:\n${url}\n`);

    await page.goto(url, { waitUntil: 'domcontentloaded' });

   

    try {

        console.log("Aguardando carregar a interface e procurando o filtro 'Bebês'...");

       

        // Busca a <label> inteira que contém o input com o ID exato da categoria Bebês

        const filtroBebe = page.locator('label').filter({ has: page.locator('input[value="17242604011"]') });

       

        // Espera o elemento estar pronto na tela

        await filtroBebe.waitFor({ state: 'visible', timeout: 30000 });

       

        // Clica nele forçando a ação para evitar bloqueios de sobreposição

        await filtroBebe.click({ force: true });

       

        console.log("Filtro 'Bebês' clicado! Aguardando o grid de produtos atualizar...\n");

       

        // Pausa para dar tempo da Amazon carregar os produtos via AJAX

        await page.waitForTimeout(5000);



        console.log(`Extraindo as ofertas e gerando links para a tag: ${TAG_AFILIADO}...\n`);

        console.log("-".repeat(80));

       

        // Captura todos os links da página

        const linksNaPagina = await page.$$('a');

        let ofertasImpressas = 0;

        const linksJaImpressos = new Set();



        for (const link of linksNaPagina) {

            const href = await link.getAttribute('href');

           

            // Verifica se é link de produto ou combo de ofertas

            if (href && (href.includes('/dp/') || href.includes('/deal/'))) {

                const linkCompleto = href.startsWith('http') ? href : `https://www.amazon.com.br${href}`;

               

                // Pega apenas a URL limpa, sem parâmetros de rastreio antigos

                const linkLimpo = linkCompleto.split('?')[0];

               

                // 🚀 Adiciona a sua tag de afiliado

                const linkComissionado = `${linkLimpo}?tag=${TAG_AFILIADO}`;

               

                const titulo = await link.innerText();

               

                // Filtra links inválidos e evita duplicatas usando o linkLimpo como base

                if (titulo.trim().length > 5 && !linksJaImpressos.has(linkLimpo)) {

                    console.log(`Produto: ${titulo.replace(/\n/g, ' ').trim()}`);

                    console.log(`Link:    ${linkComissionado}`);

                    console.log("-".repeat(80));

                   

                    linksJaImpressos.add(linkLimpo);

                    ofertasImpressas++;

                }

            }

        }

        console.log(`\nTotal de ofertas únicas encontradas: ${ofertasImpressas}`);



    } catch (error) {

        console.log("\n❌ Erro durante a extração.");

        console.log("Detalhe do erro:", error.message);

       

        await page.screenshot({ path: 'debug_erro_timeout.png', fullPage: true });

        console.log("📸 Um print da tela no momento do erro foi salvo como 'debug_erro_timeout.png'");

    }

   

    await browser.close();

    console.log("Extração finalizada com sucesso.");

}

// --- Execução do Script ---

extrairPaginaDeOfertas();