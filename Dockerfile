FROM node:24-alpine

WORKDIR /app

# Dependencies first: this layer only rebuilds when the manifests change,
# not on every source edit.
COPY package*.json ./
RUN npm ci

# The Prisma client is generated from the schema, so it has to be baked in
# before the source is copied or the first request would fail on a cold image.
COPY prisma ./prisma
COPY prisma.config.js ./
RUN npx prisma generate

COPY . .

EXPOSE 3000

CMD ["node", "--watch", "src/server.js"]
