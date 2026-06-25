// Carrega as variáveis de ambiente
require('dotenv').config();

const { Client, GatewayIntentBits, Collection } = require('discord.js');
const mongoose = require('mongoose');
const ffmpeg = require('ffmpeg-static');

// Configura o PATH do FFmpeg estático para manipulação de áudio se necessário
process.env.FFMPEG_PATH = ffmpeg;

// Inicializa o cliente do Discord com as permissões (Intents) essenciais
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Coleção para armazenar comandos slash dinamicamente
client.commands = new Collection();

// Desativa o buffer do Mongoose para garantir que erros de conexão sejam percebidos imediatamente
mongoose.set('bufferCommands', false);

// Conectando ao MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('[Banco de Dados] Conectado ao MongoDB com sucesso.');
    
    // Inicia o bot do Discord após a conexão bem-sucedida do banco
    client.login(process.env.DISCORD_TOKEN);
  })
  .catch((err) => {
    console.error('[Banco de Dados] Erro grave ao conectar ao MongoDB:', err.message);
    process.exit(1);
  });

// Exporta o cliente para uso em outras partes do sistema
module.exports = client;
