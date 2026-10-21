FROM node:22-slim
WORKDIR /app
ENV MODEL_CACHE_DIR=/app/.model-cache

ENV ONNXRUNTIME_NODE_INSTALL=skip

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

RUN mkdir .model-cache && chown node .model-cache
USER node

RUN node src/model.js

EXPOSE 3000
CMD ["node", "src/index.js"]
