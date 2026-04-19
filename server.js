require('dotenv').config();
const fastify = require('fastify')({ logger: true });
const mongoose = require('mongoose');

// Conexão condicional com o banco (evita erro se MONGO_URI não estiver definido)
if (process.env.MONGO_URI) {
  mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('Connection to MongoDB established.'))
    .catch(err => console.error('MongoDB Error:', err));
} else {
  console.warn('MONGO_URI not set; skipping MongoDB connection.');
}

// Plugins base
fastify.register(require('@fastify/cors'), { origin: true, methods: ['GET', 'POST'] });
fastify.register(require('@fastify/cookie'), { secret: 'asfixy-secret' });

// Middlewares
const authMiddleware = require('./middlewares/auth');
fastify.addHook('preHandler', authMiddleware);

// Registrando Rotas
fastify.register(require('./routes/auth'));
fastify.register(require('./routes/farm'));
fastify.register(require('./routes/admin'));
fastify.register(require('./routes/scripts'));

// Inicialização
const start = async () => {
  try {
    await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
    console.log('Server running');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
