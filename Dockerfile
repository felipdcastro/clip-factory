FROM node:20-slim

# Instala Python3, ffmpeg e dependências do sistema
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    && ln -s /usr/bin/python3 /usr/bin/python \
    && pip3 install yt-dlp --break-system-packages \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia package.json primeiro (cache de layers)
COPY package*.json ./

# Instala dependências Node.js (ignorando scripts do yt-dlp-exec)
RUN npm ci --omit=dev --ignore-scripts

# Copia o resto do código
COPY . .

# Cria diretório tmp
RUN mkdir -p tmp

EXPOSE 3000

CMD ["node", "src/server.js"]
