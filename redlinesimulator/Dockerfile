FROM node:20-alpine
WORKDIR /app
COPY build.js ./
COPY src ./src
COPY server ./server
COPY assets ./assets
RUN node build.js
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server/server.js"]
