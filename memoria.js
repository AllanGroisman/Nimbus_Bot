// memoria.js
const fs = require('fs');
const path = require('path');
const ARQUIVO_HISTORICO = path.join(__dirname, 'historico.json');

// Carrega o histórico garantindo que ele seja um objeto de Datas
function carregarHistoricoObj() {
    if (fs.existsSync(ARQUIVO_HISTORICO)) {
        try {
            const dados = JSON.parse(fs.readFileSync(ARQUIVO_HISTORICO, 'utf8'));
            
            // 🪄 MÁGICA DE COMPATIBILIDADE: Se o seu histórico antigo for uma lista simples, 
            // ele converte todos os links antigos colocando a data de hoje neles.
            if (Array.isArray(dados)) {
                const novoFormato = {};
                dados.forEach(link => { novoFormato[link] = Date.now(); });
                fs.writeFileSync(ARQUIVO_HISTORICO, JSON.stringify(novoFormato, null, 2));
                return novoFormato;
            }
            return dados;
        } catch (e) { return {}; }
    }
    return {};
}

function salvarNoHistorico(linkLimpo) {
    const hist = carregarHistoricoObj();
    hist[linkLimpo] = Date.now(); // Salva o link carimbando a data e hora em milissegundos
    fs.writeFileSync(ARQUIVO_HISTORICO, JSON.stringify(hist, null, 2));
}

// 🧮 A NOVA FUNÇÃO QUE VERIFICA OS DIAS
function foiEnviadoRecentemente(linkLimpo, diasLimite) {
    const hist = carregarHistoricoObj();
    
    // Se o link nunca foi enviado, libera!
    if (!hist[linkLimpo]) return false; 

    // Se já foi enviado, calcula quanto tempo passou
    const tempoPassadoMs = Date.now() - hist[linkLimpo];
    const diasPassados = tempoPassadoMs / (1000 * 60 * 60 * 24);

    // Se a quantidade de dias passados for MENOR que o limite, significa que é muito recente (bloqueia)
    return diasPassados < diasLimite; 
}

module.exports = { salvarNoHistorico, foiEnviadoRecentemente };