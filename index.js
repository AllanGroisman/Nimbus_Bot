// index.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// Importando os nossos módulos novinhos
const { iniciarDespachante } = require('./motor');
const { carregarComandos } = require('./comandos');

const puppeteerConfig = {
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
};

if (process.platform === 'linux') {
    puppeteerConfig.executablePath = '/usr/bin/chromium-browser';
}

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: puppeteerConfig
});

client.on('qr', (qr) => qrcode.generate(qr, { small: true }));

client.on('ready', () => {
    console.log('✅ Conectado ao WhatsApp!');
    console.log('🚀 Sistema Modular Carregado com Sucesso.');
    
    // Liga o Despachante (A fila de eventos em background)
    iniciarDespachante(client);
});

client.on('disconnected', (reason) => {
    console.log('❌ WhatsApp Desconectado! Motivo:', reason);
    process.exit(1); 
});

// Carrega o Painel de Controle (Escutador de Mensagens)
carregarComandos(client);

// Dá a partida
client.initialize();