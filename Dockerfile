# The pilot image: every dependency is installed, because the shell runs through tsx, a devDependency.
# Pinned by digest; Dependabot's docker entry moves it.
FROM node:24-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
# Corepack's cache lives outside root's home, so the node user finds pnpm offline.
ENV COREPACK_HOME=/usr/local/share/corepack
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
RUN corepack install && pnpm install --frozen-lockfile
ENV HOST=0.0.0.0 PORT=8790 XDG_STATE_HOME=/state
# A named volume inherits this ownership, so the unprivileged user can write the store.
RUN mkdir /state && chown node:node /state
VOLUME /state
EXPOSE 8790
USER node
WORKDIR /app/packages/runtime
# node is PID 1, so SIGTERM reaches the shell's own handler (the invocation main.test.ts proves).
CMD ["node", "--import", "tsx", "src/shell/compose/main.ts"]
