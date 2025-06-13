# Usa uma imagem oficial do Node.js como base.
FROM node:18-slim

# Adiciona o repositório oficial do Google Chrome e instala as dependências.
# Este passo é crucial para garantir que todas as libs necessárias para o Puppeteer estejam presentes.
RUN apt-get update && apt-get install -yq curl gnupg \
    && curl -sS -o - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google-chrome.list

# Instala o Google Chrome oficial e uma lista completa de dependências de fontes e libs gráficas.
RUN apt-get update && apt-get install -yq google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
    gconf-service libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 \
    libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
    libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxtst6 ca-certificates fonts-liberation libappindicator1 libnss3 \
    lsb-release xdg-utils wget libdrm2 libgbm1 libxshmfence1 \
    --no-install-recommends

# Define o diretório de trabalho dentro do container.
WORKDIR /app

# Copia os arquivos de dependência primeiro para aproveitar o cache do Docker.
COPY package.json package-lock.json ./

# Instala as dependências do projeto.
RUN npm install --production=false --no-optional

# Copia o resto do código do seu projeto para dentro do container.
COPY . .

# Comando que será executado quando o container iniciar.
CMD ["npm", "run", "start:bot"]
