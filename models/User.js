const mongoose = require('mongoose');
const crypto = require('node:crypto');

const UserSchema = new mongoose.Schema({
  discordId: { type: String, required: true, unique: true },
  username: { type: String, required: true },
  email: { type: String, unique: true, sparse: true },
  
  // Segurança e Autenticação Tradicional
  passwordHash: { type: String },
  passwordSalt: { type: String },
  
  // Sistema de Verificação OTP de 2 fatores (E-mail)
  otpCode: { type: String },
  otpExpiresAt: { type: Date },
  emailVerified: { type: Boolean, default: false },

  // Controle de Limites da Inteligência Artificial
  aiQueriesCount: { type: Number, default: 0 },
  lastAiQueryDate: { type: Date, default: Date.now },

  // Sistema de Assinatura VIP (Stripe)
  isVip: { type: Boolean, default: false },
  stripeCustomerId: { type: String },
  stripeSubscriptionId: { type: String },
  vipExpiresAt: { type: Date }
}, { timestamps: true });

// Método estático para gerar hash de senha robusto usando PBKDF2 nativo do Node.js
UserSchema.statics.hashPassword = function (password, salt = null) {
  if (!salt) {
    salt = crypto.randomBytes(16).toString('hex');
  }
  return new Promise((resolve, reject) => {
    // 100000 iterações, chave de 64 bytes com algoritmo sha512
    crypto.pbkdf2(password, salt, 100000, 64, 'sha512', (err, derivedKey) => {
      if (err) return reject(err);
      resolve({
        salt,
        hash: derivedKey.toString('hex')
      });
    });
  });
};

// Método para verificar se uma senha digitada é compatível
UserSchema.methods.verifyPassword = async function (password) {
  if (!this.passwordHash || !this.passwordSalt) return false;
  const result = await this.constructor.hashPassword(password, this.passwordSalt);
  return this.passwordHash === result.hash;
};

// Método para resetar o limite diário de IA se um novo dia tiver começado
UserSchema.methods.checkAndResetAiLimit = function () {
  const today = new Date().setHours(0, 0, 0, 0);
  const lastQueryDate = new Date(this.lastAiQueryDate).setHours(0, 0, 0, 0);

  if (today > lastQueryDate) {
    this.aiQueriesCount = 0;
    this.lastAiQueryDate = new Date();
  }
};

module.exports = mongoose.model('User', UserSchema);
