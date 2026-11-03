FROM node:24-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/ui-app/package.json apps/ui-app/
COPY apps/shared/streaming/package.json apps/shared/streaming/
COPY apps/shared/web-contracts/package.json apps/shared/web-contracts/
RUN npm ci --workspace=@raptix/ui-app --workspace=@raptix/streaming --workspace=@raptix/web-contracts

COPY apps/ui-app/ apps/ui-app/
COPY apps/shared/ apps/shared/
RUN npm run build --workspace=@raptix/streaming && npm run build --workspace=@raptix/web-contracts
RUN npm run build --workspace=@raptix/ui-app

FROM nginx:1.28-alpine
COPY infra/containers/ui-app.nginx.conf /etc/nginx/nginx.conf
COPY --from=builder /app/apps/ui-app/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["nginx", "-g", "daemon off;"]
