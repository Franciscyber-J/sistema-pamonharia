# Usa uma imagem oficial do Node.js como base.
FROM node:18-slim

# Instala as dependências de sistema necessárias para o Puppeteer (usado pelo whatsapp-web.js) rodar corretamente.
# ADICIONADO libdrm2 à lista.
RUN apt-get update && apt-get install -yq \
    gconf-service \
    libasound2 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgcc1 \
    libgconf-2-4 \
    libgdk-pixbuf2.0-0 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    ca-certificates \
    fonts-liberation \
    libappindicator1 \
    libnss3 \
    lsb-release \
    xdg-utils \
    wget \
    libdrm2 \
    --no-install-recommends

# Define o diretório de trabalho dentro do container
WORKDIR /app

# Copia os arquivos de dependência primeiro para aproveitar o cache do Docker
COPY package.json package-lock.json ./

# Instala as dependências do projeto
RUN npm install --production=false --no-optional

# Copia o resto do código do seu projeto para dentro do container
COPY . .

# Comando que será executado quando o container iniciar
CMD ["npm", "run", "start:bot"]