FROM node:24-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/ui-app/package.json apps/ui-app/
RUN npm ci --workspace=@raptix/ui-app

COPY apps/ui-app/ apps/ui-app/
RUN npm run build --workspace=@raptix/ui-app

FROM nginx:1.28-alpine
COPY infra/containers/ui-app.nginx.conf /etc/nginx/nginx.conf
COPY --from=builder /app/apps/ui-app/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["nginx", "-g", "daemon off;"]
