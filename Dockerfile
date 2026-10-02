# The pilot image: every dependency is installed, because the shell runs through tsx, a devDependency.
FROM node:24-slim
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile
ENV HOST=0.0.0.0 PORT=8790 XDG_STATE_HOME=/state
VOLUME /state
EXPOSE 8790
WORKDIR /app/packages/runtime
# node is PID 1, so SIGTERM reaches the shell's own handler (the invocation main.test.ts proves).
CMD ["node", "--import", "tsx", "src/shell/compose/main.ts"]
