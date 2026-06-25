const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const User = require('../../models/User');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('perguntar')
    .setDescription('Faça uma pergunta inteligente, tire dúvidas ou resolva questões matemáticas com a IA.')
    .addStringOption(option =>
      option.setName('pergunta')
        .setDescription('Sua dúvida ou questão detalhada.')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const prompt = interaction.options.getString('pergunta');
    const discordId = interaction.user.id;
    const username = interaction.user.username;

    try {
      // 1. Busca ou registra o usuário no MongoDB
      let user = await User.findOne({ discordId });
      if (!user) {
        user = await User.create({ discordId, username });
      }

      // Reseta o limite se houver mudado de dia
      user.checkAndResetAiLimit();

      // 2. Valida o limite de uso gratuito (limite diário de 5 perguntas)
      const maxFreeQueries = 5;
      const isUserVip = user.isVip && (!user.vipExpiresAt || user.vipExpiresAt > new Date());

      if (!isUserVip && user.aiQueriesCount >= maxFreeQueries) {
        const limitEmbed = new EmbedBuilder()
          .setColor('#eccc68')
          .setTitle('🚀 Limite Diário Atingido!')
          .setDescription(`Você atingiu o seu limite diário de **${maxFreeQueries} perguntas gratuitas**.\n\nQuer continuar fazendo perguntas ilimitadas, resolvendo cálculos e textos complexos? Torne-se um membro **VIP** agora mesmo em nosso painel!`)
          .addFields({ name: 'Assinar VIP', value: 'Adquira sua assinatura no site: `http://localhost:3000`' })
          .setThumbnail(interaction.client.user.displayAvatarURL());

        return interaction.editReply({ embeds: [limitEmbed] });
      }

      // 3. Inicializa e faz a requisição à API do Gemini
      if (!process.env.GEMINI_API_KEY) {
        return interaction.editReply({ content: '❌ Erro de configuração: GEMINI_API_KEY não foi configurada.' });
      }

      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      // Utilização do modelo padrão de alto desempenho e velocidade
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

      // Sistema de instrução integrada para formatação acadêmica e organizada
      const systemInstruction = "Você é o Atlas, uma inteligência artificial integrada ao Discord. Responda de forma clara, prestativa, organizada em Markdown de fácil leitura no chat. Se houver equações matemáticas ou códigos de programação, formate-os corretamente.";
      
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: `${systemInstruction}\n\nPergunta do Usuário: ${prompt}` }] }]
      });

      let aiResponseText = result.response.text();

      // Limita o tamanho do texto para caber no limite máximo da descrição de uma embed do Discord (4096 caracteres)
      if (aiResponseText.length > 3900) {
        aiResponseText = aiResponseText.substring(0, 3900) + '\n\n*(Resposta encurtada devido ao limite de caracteres do Discord...)*';
      }

      // 4. Incrementa o contador de perguntas diárias do usuário (se não for VIP)
      if (!isUserVip) {
        user.aiQueriesCount += 1;
      }
      user.lastAiQueryDate = new Date();
      await user.save();

      // 5. Envia a resposta final estruturada
      const responseEmbed = new EmbedBuilder()
        .setColor('#2e86de')
        .setTitle('🧠 Resposta do Atlas')
        .setAuthor({ name: username, iconURL: interaction.user.displayAvatarURL() })
        .setDescription(aiResponseText)
        .setFooter({ 
          text: isUserVip 
            ? 'Acesso Ilimitado • VIP Ativo' 
            : `Limite Diário: ${user.aiQueriesCount}/${maxFreeQueries} perguntas utilizadas.` 
        });

      return interaction.editReply({ embeds: [responseEmbed] });

    } catch (error) {
      console.error('[Gemini API] Erro ao processar requisição de IA:', error);
      return interaction.editReply({
        content: '❌ Houve um problema ao processar a resposta do assistente inteligente. Certifique-se de que a pergunta é válida.'
      });
    }
  }
};
