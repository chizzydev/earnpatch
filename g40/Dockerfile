FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY g40/package*.json ./g40/
RUN npm ci --prefix g40 --omit=dev --ignore-scripts --no-audit --no-fund
COPY apps/ ./apps/
COPY g36/ ./g36/
COPY g37/ ./g37/
COPY g38/ ./g38/
COPY g39/ ./g39/
COPY g40/ ./g40/
COPY BUILD_MANIFEST.json ./
RUN chown -R node:node /app
USER node
EXPOSE 8080
CMD ["node", "g40/server.mjs"]
