# Usa uma imagem oficial do Node.js como base.
FROM node:18-slim

# Adiciona o repositório oficial do Google Chrome e instala as dependências
RUN apt-get update && apt-get install -yq curl gnupg \
    && curl -sS -o - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google-chrome.list

# Instala o Google Chrome oficial e outras dependências de fontes e libs
RUN apt-get update && apt-get install -yq google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 --no-install-recommends

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