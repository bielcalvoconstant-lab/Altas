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

  } catch (err) {
    console.error(err);
    res.render('login', { error: 'Ocorreu um erro no processamento.', step: 'register' });
  }
});

// Verificação do OTP digitado
app.post('/verify-otp', async (req, res) => {
  const { otp } = req.body;
  const discordId = req.session.tempDiscordId;

  if (!discordId) return res.redirect('/login');

  try {
    const user = await User.findOne({ discordId });
    if (!user || user.otpCode !== otp || user.otpExpiresAt < new Date()) {
      return res.render('login', { error: 'Código inválido ou expirado.', step: 'verify-otp' });
    }

    user.emailVerified = true;
    user.otpCode = undefined;
    user.otpExpiresAt = undefined;
    await user.save();

    req.session.userId = user._id;
    req.session.discordId = user.discordId;
    delete req.session.tempDiscordId;

    res.redirect('/dashboard');
  } catch (err) {
    res.render('login', { error: 'Erro ao validar código.', step: 'verify-otp' });
  }
});

// Rota de Login Tradicional
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email, emailVerified: true });
    if (!user) {
      return res.render('login', { error: 'Credenciais inválidas ou e-mail não verificado.', step: 'login' });
    }

    const correct = await user.verifyPassword(password);
    if (!correct) {
      return res.render('login', { error: 'Credenciais inválidas.', step: 'login' });
    }

    req.session.userId = user._id;
    req.session.discordId = user.discordId;
    res.redirect('/dashboard');
  } catch (err) {
    res.render('login', { error: 'Erro no servidor.', step: 'login' });
  }
});

// Login de 1 clique - Discord OAuth2 Redirect
app.get('/auth/discord', (req, res) => {
  const url = `https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;
  res.redirect(url);
});

// Callback do OAuth2
app.get('/auth/discord/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/login');

  try {
    // Troca o código pelo Token de Acesso
    const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.REDIRECT_URI,
      }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const tokens = await tokenResponse.json();
    if (tokens.error) return res.redirect('/login');

    // Busca dados do usuário do Discord
    const userResponse = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const discordUser = await userResponse.json();

    let user = await User.findOne({ discordId: discordUser.id });
    if (!user) {
      user = await User.create({
        discordId: discordUser.id,
        username: discordUser.username,
        emailVerified: false // Usuários via OAuth precisam se cadastrar com e-mail depois se quiserem acesso tradicional
      });
    }

    req.session.userId = user._id;
    req.session.discordId = user.discordId;
    req.session.accessToken = tokens.access_token; // Guardado para buscar servidores

    res.redirect('/dashboard');
  } catch (error) {
    console.error(error);
    res.redirect('/login');
  }
});

// Visualização do Painel de Servidores
app.get('/dashboard', isAuthenticated, async (req, res) => {
  try {
    if (!req.session.accessToken) {
      return res.redirect('/auth/discord');
    }

    // Busca guias em que o usuário está inserido
    const guildsResponse = await fetch('https://discord.com/api/v10/users/@me/guilds', {
      headers: { Authorization: `Bearer ${req.session.accessToken}` }
    });
    const guilds = await guildsResponse.json();

    // Filtra apenas servidores onde ele é administrador (permissão ADMIN = 0x8)
    const adminGuilds = guilds.filter(g => (g.permissions & 0x8) === 0x8);

    // Mapeia servidores para verificar se o bot está neles
    const formattedGuilds = adminGuilds.map(g => {
      const botInGuild = client.guilds.cache.has(g.id);
      return {
        ...g,
        botInGuild,
        iconUrl: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null
      };
    });

    const dbUser = await User.findById(req.session.userId);

    res.render('guild', { 
      guilds: formattedGuilds, 
      activeGuild: null, 
      user: dbUser,
      roles: [],
      channels: [],
      config: null,
      success: null
    });

  } catch (error) {
    console.error(error);
    res.send('Erro ao buscar seus servidores.');
  }
});

// Configuração Individual do Servidor
app.get('/dashboard/:guildId', isAuthenticated, async (req, res) => {
  const { guildId } = req.params;

  try {
    const dGuild = client.guilds.cache.get(guildId);
    if (!dGuild) return res.send('O bot precisa estar adicionado a este servidor antes.');

    let config = await GuildConfig.findOne({ guildId });
    if (!config) {
      config = await GuildConfig.create({ guildId, guildName: dGuild.name });
    }

    const dbUser = await User.findById(req.session.userId);

    // Coleta cargos e canais de texto do servidor para popular o formulário
    const roles = dGuild.roles.cache.map(r => ({ id: r.id, name: r.name }));
    const channels = dGuild.channels.cache
      .filter(c => c.type === 0) // Apenas canais de texto (GUILD_TEXT = 0)
      .map(c => ({ id: c.id, name: c.name }));

    res.render('guild', {
      guilds: [],
      activeGuild: dGuild,
      user: dbUser,
      roles,
      channels,
      config,
      success: null
    });

  } catch (error) {
    console.error(error);
    res.send('Erro ao acessar o painel da guilda.');
  }
});

// Salvar Configurações do Servidor
app.post('/dashboard/:guildId', isAuthenticated, async (req, res) => {
  const { guildId } = req.params;
  const { logChannelId, staffRoleId, verifiedRoleId, visitorRoleId, warnsLimit } = req.body;

  try {
    const config = await GuildConfig.findOneAndUpdate(
      { guildId },
      {
        logChannelId,
        staffRoleId,
        verifiedRoleId,
        visitorRoleId,
        warnsLimit: parseInt(warnsLimit) || 3
      },
      { new: true, upsert: true }
    );

    const dGuild = client.guilds.cache.get(guildId);
    const roles = dGuild.roles.cache.map(r => ({ id: r.id, name: r.name }));
    const channels = dGuild.channels.cache.filter(c => c.type === 0).map(c => ({ id: c.id, name: c.name }));
    const dbUser = await User.findById(req.session.userId);

    res.render('guild', {
      guilds: [],
      activeGuild: dGuild,
      user: dbUser,
      roles,
      channels,
      config,
      success: 'Configurações salvas com sucesso!'
    });

  } catch (error) {
    console.error(error);
    res.send('Erro ao salvar configurações.');
  }
});

// Rota de Checkout do Stripe
app.get('/checkout', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);

    const sessionStripe = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'brl',
          product_data: {
            name: 'Assinatura Atlas VIP',
            description: 'Acesso sem limites diários à Inteligência Artificial e recursos premium.',
          },
          unit_amount: 1990, // R$ 19,90 recorrente mensal
          recurring: { interval: 'month' }
        },
        quantity: 1,
      }],
      mode: 'subscription',
      client_reference_id: user.discordId,
      success_url: `http://localhost:${PORT}/dashboard`,
      cancel_url: `http://localhost:${PORT}/dashboard`,
    });

    res.redirect(303, sessionStripe.url);
  } catch (error) {
    console.error(error);
    res.status(500).send('Erro ao iniciar o checkout do Stripe.');
  }
});

// Painel Master Developer (E-mail restrito)
app.get('/master', isAuthenticated, async (req, res) => {
  const user = await User.findById(req.session.userId);
  if (!user || user.email !== 'mafiosodashopping@gmail.com') {
    return res.status(403).send('Acesso não autorizado.');
  }

  res.send(`
    <html>
      <head>
        <title>Master Dev Panel</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-gray-900 text-white p-8">
        <h1 class="text-3xl font-bold mb-6">Painel Master de Desenvolvedor</h1>
        <form action="/master/status" method="POST" class="bg-gray-800 p-6 rounded">
          <label class="block mb-2">Mudar Status Global do Bot:</label>
          <select name="status" class="bg-gray-700 text-white p-2 rounded mb-4 w-full">
            <option value="online">Online</option>
            <option value="idle">Ausente (Idle)</option>
            <option value="dnd">Não Perturbar (DND)</option>
          </select>
          <label class="block mb-2">Mensagem de Atividade Personalizada:</label>
          <input type="text" name="activity" placeholder="Jogando com IA..." class="bg-gray-700 text-white p-2 rounded mb-4 w-full" required />
          <button class="bg-blue-600 px-4 py-2 rounded">Atualizar Presença</button>
        </form>
      </body>
    </html>
  `);
});

app.post('/master/status', isAuthenticated, async (req, res) => {
  const user = await User.findById(req.session.userId);
  if (!user || user.email !== 'mafiosodashopping@gmail.com') return res.status(403).send('Negado');

  const { status, activity } = req.body;
  
  try {
    client.user.setPresence({
      activities: [{ name: activity, type: 0 }],
      status: status
    });
    res.send('<p>Status alterado de forma persistente! <a href="/master">Voltar</a></p>');
  } catch (error) {
    res.send('Erro ao atualizar presença: ' + error.message);
  }
});

// Inicialização do Servidor Web
app.listen(PORT, () => {
  console.log(`[Dashboard] Servidor Express rodando na porta ${PORT}`);
});