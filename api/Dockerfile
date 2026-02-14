FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY src ./src

RUN corepack enable && pnpm install --prod

EXPOSE 4000
CMD ["pnpm", "start"]
