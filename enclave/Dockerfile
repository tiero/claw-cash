FROM node:22-alpine

WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src

RUN corepack enable && pnpm install && pnpm exec tsc && pnpm prune --prod && rm -rf src tsconfig.json

EXPOSE 7000
CMD ["node", "dist/index.js"]
