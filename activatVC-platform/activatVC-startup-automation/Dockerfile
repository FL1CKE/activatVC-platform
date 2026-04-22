FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY client ./client
COPY config ./config

RUN npm run build
RUN cd client && npm install && npm run build

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && test -f client/dist/index.html && node dist/index.js"]
