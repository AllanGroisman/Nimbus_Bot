// memoria.js
const fs = require('fs');
const ARQUIVO_HISTORICO = './historico_produtos.json';

function carregarHistorico() {
    if (fs.existsSync(ARQUIVO_HISTORICO)) {
        const dados = fs.readFileSync(ARQUIVO_HISTORICO, 'utf8');
        return JSON.parse(dados);
    }
    return [];
}

function salvarNoHistorico(linkLimpo) {
    const historico = carregarHistorico();
    if (!historico.includes(linkLimpo)) {
        historico.push(linkLimpo);
        fs.writeFileSync(ARQUIVO_HISTORICO, JSON.stringify(historico, null, 2));
    }
}

module.exports = { carregarHistorico, salvarNoHistorico };