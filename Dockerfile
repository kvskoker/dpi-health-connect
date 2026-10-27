FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
USER node
ENV HOST=0.0.0.0 PORT=4300
CMD ["node", "--import", "tsx", "src/server.ts"]
