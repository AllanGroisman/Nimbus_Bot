// config.js
const fs = require('fs');
const ARQUIVO_CONFIG = './config.json';

const ROTAS_ML = {
    'GERAL': '', 
    'PETS': '?category=MLB1071&domain_id=PET',
    'COMPUTADORES': '?category=MLB1648&domain_id=MLB-COMPUTERS',
    'BEBES': '?category=MLB1384&domain_id=MLB-BABY',
    'CELULARES': '?category=MLB1051&domain_id=MLB-CELLPHONES',
    'GAMES': '?category=MLB1144&domain_id=MLB-VIDEO_GAMES',
    'CASA': '?category=MLB1574&domain_id=MLB-HOME_AND_LIVING'
};

const CONFIG_PADRAO_GRUPO = {
    NOME: 'SEM_NOME', // 🏷️ O apelido do grupo!
    CATEGORIA_ESCOLHIDA: 'GERAL', 
    PALAVRAS_CHAVE: [], 
    DESCONTO_MINIMO: 10, 
    VENDAS_MINIMAS: 100, 
    NOTA_MINIMA: 4.5,    
    QUANTIDADE_PRODUTOS: 5,           
    PAGINA_OFERTAS_INICIAL: 1, 
    LIMITE_PAGINAS_BUSCA: 10,
    INTERVALO_MENSAGENS_SEGUNDOS: 15
};

const CONFIG_PADRAO = {
    GERAL: {
        ID_GRUPO_ADMIN: 'COLOQUE_O_ID_AQUI@g.us',    
        TAG_AFILIADO: 'pb20260221170529',
        COOKIE_ML: '', 
        PILOTO_AUTOMATICO_LIGADO: false,  
        INTERVALO_ROBO_HORAS: 2           
    },
    GRUPOS: {} 
};

let CONFIG = {};

function carregarConfiguracoes() {
    if (fs.existsSync(ARQUIVO_CONFIG)) {
        const dados = fs.readFileSync(ARQUIVO_CONFIG, 'utf8');
        CONFIG = JSON.parse(dados);
        if (!CONFIG.GERAL) CONFIG.GERAL = { ...CONFIG_PADRAO.GERAL };
        if (!CONFIG.GRUPOS) CONFIG.GRUPOS = {};
    } else {
        CONFIG = { ...CONFIG_PADRAO };
        salvarConfig();
    }
}

function salvarConfig() {
    fs.writeFileSync(ARQUIVO_CONFIG, JSON.stringify(CONFIG, null, 2));
}

function setGeral(chave, valor) {
    CONFIG.GERAL[chave] = valor;
    salvarConfig();
}

// 🎯 Nova versão: Agora exige um nome curto na hora de cadastrar
function addGrupo(idGrupo, nomeGrupo) {
    if (!CONFIG.GRUPOS[idGrupo]) {
        CONFIG.GRUPOS[idGrupo] = { ...CONFIG_PADRAO_GRUPO, NOME: nomeGrupo.toUpperCase() };
        salvarConfig();
        return true;
    }
    return false; 
}

function setGrupo(idGrupo, chave, valor) {
    if (CONFIG.GRUPOS[idGrupo] && CONFIG.GRUPOS[idGrupo][chave] !== undefined) {
        CONFIG.GRUPOS[idGrupo][chave] = valor;
        salvarConfig();
        return true;
    }
    return false;
}

// 🎯 GPS DE GRUPOS: Acha o ID do WhatsApp pelo nome que você deu!
function encontrarIdPorNome(nome) {
    const nomeUpper = nome.toUpperCase();
    for (const [id, regras] of Object.entries(CONFIG.GRUPOS)) {
        if (regras.NOME && regras.NOME.toUpperCase() === nomeUpper) {
            return id;
        }
    }
    return null; // Não achou
}

carregarConfiguracoes();

module.exports = { CONFIG, ROTAS_ML, setGeral, addGrupo, setGrupo, encontrarIdPorNome };