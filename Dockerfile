FROM node:22-alpine
RUN apk add --no-cache font-dejavu
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
RUN mkdir -p /app/private-media && chown -R node:node /app
USER node
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm","run","start"]
