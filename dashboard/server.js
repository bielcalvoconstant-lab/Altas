const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const mongoose = require('mongoose');

const User = require('../models/User');
const GuildConfig = require('../models/GuildConfig');
const client = require('../index'); // Instância do cliente do Discord

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração importante para proxy reverso (ex: Heroku, Cloudflare, Nginx)
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Webhook do Stripe precisa de tratamento de payload bruto antes do bodyParser padrão
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(`[Stripe Webhook] Erro de assinatura: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Processa o pagamento concluído
  if (event.type === 'checkout.session.completed') {
    const sessionData = event.data.object;
    const discordId = sessionData.client_reference_id;

    if (discordId) {
      try {
        const vipDurationDays = 30;
        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + vipDurationDays);

        await User.findOneAndUpdate(
          { discordId },
          {
            isVip: true,
            vipExpiresAt: expirationDate,
            stripeCustomerId: sessionData.customer,
            stripeSubscriptionId: sessionData.subscription || null
          }
        );
        console.log(`[Stripe] Usuário ${discordId} promovido a VIP até ${expirationDate}`);
      } catch (error) {
        console.error('[Stripe Webhook] Erro ao atualizar status VIP no banco:', error);
      }
    }
  }

  res.json({ received: true });
});

// Middleware padrão para rotas normais
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Persistência de sessões no MongoDB via connect-mongo
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    ttl: 14 * 24 * 60 * 60 // 14 dias
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production', // true se usar HTTPS
    maxAge: 14 * 24 * 60 * 60 * 1000
  }
}));

// Middleware de Autenticação Básica
function isAuthenticated(req, res, next) {
  if (req.session.userId) return next();
  res.redirect('/login');
}

// Auxiliar para envio de OTP via API do Brevo
async function sendOtpEmail(email, otpCode) {
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: { email: process.env.SENDER_EMAIL, name: 'Painel Atlas' },
        to: [{ email: email }],
        subject: 'Seu Código de Verificação Atlas',
        htmlContent: `<p>Seu código de acesso temporário de 6 dígitos para o Painel Atlas é: <strong>${otpCode}</strong></p><p>Este código expira em 10 minutos.</p>`
      })
    });
    return response.ok;
  } catch (error) {
    console.error('[Brevo] Erro de envio de e-mail:', error);
    return false;
  }
}

// --- ROTAS DO SISTEMA ---

// Rota Principal
app.get('/', async (req, res) => {
  res.render('login', { error: null, step: 'login' });
});

// Rota de Cadastro de E-mail + Envio de OTP
app.post('/register', async (req, res) => {
  const { email, password, username, discordId } = req.body;
  if (!email || !password || !discordId || !username) {
    return res.render('login', { error: 'Preencha todos os campos.', step: 'register' });
  }

  try {
    const existingUser = await User.findOne({ $or: [{ email }, { discordId }] });
    if (existingUser && existingUser.emailVerified) {
      return res.render('login', { error: 'Este e-mail ou conta do Discord já está registrado.', step: 'register' });
    }

    // Gera um OTP de 6 dígitos aleatórios
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 Minutos

    const hashed = await User.hashPassword(password);

    // Cria ou atualiza usuário temporário
    await User.findOneAndUpdate(
      { discordId },
      {
        discordId,
        username,
        email,
        passwordHash: hashed.hash,
        passwordSalt: hashed.salt,
        otpCode: otp,
        otpExpiresAt: otpExpires,
        emailVerified: false
      },
      { upsert: true }
    );

    const sent = await sendOtpEmail(email, otp);
    if (!sent) {
      return res.render('login', { error: 'Falha ao enviar e-mail com código OTP.', step: 'register' });
    }

    req.session.tempDiscordId = discordId;
    res.render('login', { error: null, step: 'verify-otp' });
