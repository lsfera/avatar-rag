FROM node:24-slim
RUN npm i -g pnpm@12.23.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
