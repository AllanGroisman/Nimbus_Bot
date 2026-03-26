// utils.js
const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function converterParaMinutos(tempo) {
    if (typeof tempo === 'number') return tempo * 60; 
    const tempoStr = String(tempo);
    if (!tempoStr.includes(':')) return parseInt(tempoStr) * 60;
    const [h, m] = tempoStr.split(':');
    return (parseInt(h) * 60) + parseInt(m);
}

module.exports = { esperar, converterParaMinutos };