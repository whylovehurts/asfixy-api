require('dotenv').config(); // Caso esteja usando um arquivo .env localmente
const fastify = require('fastify')({ logger: true });
const mongoose = require('mongoose');

// Conexão com o banco
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("💉 Connection with the Abyss established."))
  .catch(err => console.error("❌ MongoDB Error:", err));

// Plugins base
fastify.register(require('@fastify/cors'), { origin: true, methods: ["GET", "POST"] });
fastify.register(require('@fastify/cookie'), { secret: "asfixy-secret" });

// Middlewares
const authMiddleware = require('./api/middlewares/auth');
fastify.addHook('preHandler', authMiddleware);

// Registrando Rotas
fastify.register(require('./api/routes/auth'));
fastify.register(require('./api/routes/farm'));
fastify.register(require('./api/routes/admin'));
fastify.register(require('./api/routes/scripts'));

// Inicialização
const start = async () => {
    try { 
        await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' }); 
        console.log("⚡ Server running...");
    } catch (err) { 
        fastify.log.error(err); 
        process.exit(1); 
    }
};

start();