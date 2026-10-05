# New-stack browser/static image (W16 cutover): Vite build of the React UI
# served by nginx with same-origin /api routing. No Prisma/DB/server packages
# ship in this image (guide §14.3).
FROM node:22-slim AS build
WORKDIR /app

# Vite inlines VITE_* variables at build time; runtime nginx env cannot change
# the bundle. Default the deployable image to real mode (IW-01); demo/preview
# builds can opt out with --build-arg VITE_DATA_MODE=mock.
ARG VITE_DATA_MODE=real
ENV VITE_DATA_MODE=${VITE_DATA_MODE}

COPY package.json package-lock.json ./
COPY apps/shared/streaming/package.json apps/shared/streaming/
COPY apps/shared/web-contracts/package.json apps/shared/web-contracts/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund --workspace=@raptix/web-raptix

COPY apps/shared ./apps/shared
COPY apps/web ./apps/web
RUN npm run build --workspace=@raptix/streaming \
 && npm run build --workspace=@raptix/web-contracts \
 && npm run build --workspace=@raptix/web-raptix

FROM nginx:1.27-alpine
COPY infra/containers/web-raptix-proxy.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
ARG VERSION=0.0.0
LABEL org.opencontainers.image.version="${VERSION}"
EXPOSE 8080
