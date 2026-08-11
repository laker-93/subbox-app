# --- Builder stage
FROM node:23-alpine AS builder
WORKDIR /app

# Copy package.json first to cache node_modules
COPY package.json pnpm-lock.yaml .

RUN npm install -g pnpm@10.32.1

RUN pnpm install --ignore-scripts

# Copy code and build with cached modules
COPY . .
ARG BUILD_MODE=production

# Password for the public `demo` trial account, baked into the bundle at build time
# so the landing page can offer a one-click demo. Kept out of the repo's env files
# because this repo is public; supplied from a repository secret instead. Left empty,
# the demo button simply doesn't render. Only the built assets are copied into the
# final stage, so this never reaches the runtime image's environment.
ARG VITE_DEMO_PASSWORD=""
ENV VITE_DEMO_PASSWORD=$VITE_DEMO_PASSWORD

RUN if [ "$BUILD_MODE" = "production" ]; then \
      pnpm run build:web; \
    else \
      pnpm run build:web:${BUILD_MODE}; \
    fi

# --- Production stage
FROM nginxinc/nginx-unprivileged:alpine-slim

COPY --chown=nginx:nginx --from=builder /app/out/web /usr/share/nginx/html

# Serving the bundle to a browser conveys the program under the GPL-3.0, so the
# licence text and the §5(a) modification record have to be served with it. The
# web build emits both into out/web already (scripts/vite-plugin-licence-files.ts);
# copying them again here keeps the published image correct even if that build
# step is ever changed or dropped.
COPY --chown=nginx:nginx LICENSE NOTICE /usr/share/nginx/html/

COPY --chown=nginx:nginx ./settings.js.template /etc/nginx/templates/settings.js.template
COPY --chown=nginx:nginx ng.conf.template /etc/nginx/templates/default.conf.template

ENV SERVER_LOCK=false SERVER_NAME="" SERVER_TYPE="" SERVER_URL="" REMOTE_URL=""
ENV LEGACY_AUTHENTICATION="" ANALYTICS_DISABLED="" PUBLIC_PATH="/"

EXPOSE 9180
CMD ["nginx", "-g", "daemon off;"]
