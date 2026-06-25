const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const GuildConfig = require('../../models/GuildConfig');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('autoverify-setup')
    .setDescription('Envia a embed de verificação interativa com botão anti-robô no canal.')
    .addRoleOption(option =>
      option.setName('cargo')
        .setDescription('Cargo de verificado a ser entregue ao usuário.')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const targetRole = interaction.options.getRole('cargo');
    const guildId = interaction.guildId;

    try {
      // Salva ou atualiza a configuração do cargo verificado no banco de dados
      await GuildConfig.findOneAndUpdate(
        { guildId },
        { 
          guildId, 
          guildName: interaction.guild.name, 
          verifiedRoleId: targetRole.id 
        },
        { upsert: true, new: true }
      );

      const embed = new EmbedBuilder()
        .setColor('#10ac84')
        .setTitle('🛡️ Portal de Autoverificação')
        .setDescription('Para obter acesso completo aos canais do nosso servidor, clique no botão abaixo para provar que você não é um robô.')
        .setThumbnail(interaction.guild.iconURL())
        .setFooter({ text: 'Proteção Anti-Robô de Alta Segurança' });

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('autoverify_btn')
            .setLabel('Não sou um robô')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🤖')
        );

      // Responde com confirmação efêmera e envia a mensagem de fato no canal atual
      await interaction.reply({ content: '✅ Painel de verificação configurado e enviado!', ephemeral: true });
      await interaction.channel.send({ embeds: [embed], components: [row] });

    } catch (error) {
      console.error('[Setup] Erro no comando autoverify-setup:', error);
      return interaction.reply({ content: '❌ Ocorreu um erro interno ao salvar as configurações.', ephemeral: true });
    }
  }
};
