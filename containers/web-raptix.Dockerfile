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
COPY clients/shared/streaming/package.json clients/shared/streaming/
COPY clients/shared/web-contracts/package.json clients/shared/web-contracts/
COPY clients/web-raptix/package.json clients/web-raptix/
RUN npm ci --no-audit --no-fund --workspace=@raptix/web-raptix

COPY clients/shared ./clients/shared
COPY clients/web-raptix ./clients/web-raptix
RUN npm run build --workspace=@raptix/streaming \
 && npm run build --workspace=@raptix/web-contracts \
 && npm run build --workspace=@raptix/web-raptix

FROM nginx:1.27-alpine
COPY containers/web-raptix-proxy.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/clients/web-raptix/dist /usr/share/nginx/html
EXPOSE 8080
