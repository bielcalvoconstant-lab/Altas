const mongoose = require('mongoose');

const GuildConfigSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  guildName: { type: String },
  
  // Configuração de Canais e Cargos
  logChannelId: { type: String, default: null },
  staffRoleId: { type: String, default: null },
  verifiedRoleId: { type: String, default: null },
  visitorRoleId: { type: String, default: null },
  
  // Configurações do Sistema de Moderação
  warnsLimit: { type: Number, default: 3 },

  // Histórico Simples de Advertências Internas
  warns: [{
    userId: { type: String, required: true },
    reason: { type: String, default: 'Não especificado' },
    moderatorId: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

module.exports = mongoose.model('GuildConfig', GuildConfigSchema);
