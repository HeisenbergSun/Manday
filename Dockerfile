# Manday 单容器镜像：后端 API + 前端静态文件（Render 免费层一键部署用）
# 构建上下文 = manday/ 项目根目录
FROM node:22-alpine AS build

WORKDIR /app
# 先拷 package.json 利用层缓存
COPY backend/package.json backend/package-lock.json* ./backend/
COPY frontend/package.json ./frontend/
RUN cd backend && npm ci || npm install
RUN cd frontend && npm ci || npm install

COPY backend/ ./backend/
COPY db/ ./db-src/
COPY frontend/ ./frontend/

RUN cd backend && npx tsc
RUN cd frontend && npx vite build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/package.json ./
COPY --from=build /app/db-src ./db
COPY --from=build /app/frontend/dist ./public

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "dist/main.js"]
