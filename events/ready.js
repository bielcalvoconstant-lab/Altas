const { Events, ActivityType } = require('discord.js');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`[Bot] Conectado com sucesso como: ${client.user.tag}`);

    // Configura uma presença padrão inicial do bot
    client.user.setPresence({
      activities: [{ name: 'Inteligência Artificial (/perguntar)', type: ActivityType.Playing }],
      status: 'online',
    });

    try {
      console.log('[Comandos] Iniciando registro dos comandos slash (/) globalmente...');
      
      const commandsArray = [];
      client.commands.forEach(command => {
        commandsArray.push(command.data.toJSON());
      });

      // Registra os comandos na API do Discord de forma global
      await client.application.commands.set(commandsArray);
      
      console.log(`[Comandos] Sucesso: ${commandsArray.length} comandos slash registrados.`);
    } catch (error) {
      console.error('[Comandos] Erro ao registrar comandos slash:', error);
    }
  },
};
