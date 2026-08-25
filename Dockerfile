FROM node:22-alpine

WORKDIR /app

COPY . .

ENV PORT=3000
EXPOSE 3000

# Não há dependências externas — não precisa de "npm install".
CMD ["node", "server.js"]
