// Carrega as variáveis de ambiente
require('dotenv').config();

const { Client, GatewayIntentBits, Collection } = require('discord.js');
const mongoose = require('mongoose');
const ffmpeg = require('ffmpeg-static');
const fs = require('fs');
const path = require('path');

process.env.FFMPEG_PATH = ffmpeg;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.commands = new Collection();

// Carregador Dinâmico de Comandos
const commandsPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(commandsPath);

for (const folder of commandFolders) {
  const folderPath = path.join(commandsPath, folder);
  const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));
  
  for (const file of commandFiles) {
    const filePath = path.join(folderPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
      client.commands.set(command.data.name, command);
    } else {
      console.warn(`[Aviso] O comando em ${filePath} está sem as propriedades "data" ou "execute" obrigatórias.`);
    }
  }
}

// Carregador Dinâmico de Eventos
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file);
  const event = require(filePath);
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
}

mongoose.set('bufferCommands', false);

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('[Banco de Dados] Conectado ao MongoDB com sucesso.');
    client.login(process.env.DISCORD_TOKEN);
  })
  .catch((err) => {
    console.error('[Banco de Dados] Erro grave ao conectar ao MongoDB:', err.message);
    process.exit(1);
  });

module.exports = client;
