module.exports = async function (fastify, opts) {
    fastify.get('/download', async (request, reply) => {
        return reply.redirect('https://gofile.io/d/9c8Wlb');
    });

    fastify.get('/script/:file', async (request, reply) => {
        const { file } = request.params;
        const scripts = { 'main': 'main.js', 'dataloss': 'dataloss.js', 'crash': 'crash.js' };
        const fileName = scripts[file.toLowerCase()];
        
        if (!fileName) return reply.code(404).send({ error: "Script not found." });
        
        const GITHUB_BASE_URL = "https://raw.githubusercontent.com/whylovehurts/asfixy-exec/refs/heads/main/src/";
        try {
            const response = await fetch(GITHUB_BASE_URL + fileName);
            if (!response.ok) throw new Error("GitHub error");
            const code = await response.text();
            reply.type('application/javascript').send(code);
        } catch (err) { 
            reply.code(500).send({ error: "Failed to fetch script." }); 
        }
    });
};