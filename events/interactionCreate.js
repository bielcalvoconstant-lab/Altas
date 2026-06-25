const { Events, EmbedBuilder } = require('discord.js');
const GuildConfig = require('../models/GuildConfig');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    // 1. Processamento de Comandos Slash (/)
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);

      if (!command) {
        console.error(`[Comandos] Nenhum comando correspondente a ${interaction.commandName} foi encontrado.`);
        return;
      }

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(`[Comandos] Erro ao executar ${interaction.commandName}:`, error);
        
        const errorEmbed = new EmbedBuilder()
          .setColor('#ff4757')
          .setTitle('Erro de Execução')
          .setDescription('Ocorreu um erro interno ao processar este comando. Tente novamente mais tarde.');

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ embeds: [errorEmbed], ephemeral: true });
        } else {
          await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
      }
    }

    // 2. Processamento do Botão de Autoverificação (Anti-Robô)
    if (interaction.isButton()) {
      if (interaction.customId === 'autoverify_btn') {
        try {
          await interaction.deferReply({ ephemeral: true });

          const guildId = interaction.guildId;
          const config = await GuildConfig.findOne({ guildId });

          if (!config || !config.verifiedRoleId) {
            return interaction.editReply({
              content: '⚠️ O cargo de verificado não está configurado neste servidor. Peça a um administrador para configurar pelo painel web.'
            });
          }

          const member = interaction.member;
          const verifiedRole = interaction.guild.roles.cache.get(config.verifiedRoleId);

          if (!verifiedRole) {
            return interaction.editReply({
              content: '⚠️ O cargo configurado para verificação não foi encontrado no servidor.'
            });
          }

          // Se houver cargo de visitante configurado, removemos
          if (config.visitorRoleId) {
            const visitorRole = interaction.guild.roles.cache.get(config.visitorRoleId);
            if (visitorRole && member.roles.cache.has(visitorRole.id)) {
              await member.roles.remove(visitorRole);
            }
          }

          // Adiciona o cargo de verificado
          if (!member.roles.cache.has(verifiedRole.id)) {
            await member.roles.add(verifiedRole);
            return interaction.editReply({
              content: `✅ Verificação concluída! O cargo **${verifiedRole.name}** foi atribuído a você.`
            });
          } else {
            return interaction.editReply({
              content: 'ℹ️ Você já está verificado neste servidor!'
            });
          }

        } catch (error) {
          console.error('[Autoverify] Erro ao processar clique no botão:', error);
          return interaction.editReply({
            content: '❌ Ocorreu um erro técnico ao tentar atribuir seu cargo de verificação.'
          });
        }
      }
    }
  },
};
