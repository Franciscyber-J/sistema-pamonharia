@ECHO OFF
TITLE Instalador de Dependencias - Projeto Pamonharia

:: Limpa a tela
CLS

ECHO.
ECHO     #######################################################
ECHO     #                                                     #
ECHO     #   INSTALADOR DE DEPENDENCIAS DO SISTEMA PAMONHARIA  #
ECHO     #                                                     #
ECHO     #######################################################
ECHO.
ECHO   Este script ira instalar todas as bibliotecas necessarias para o projeto.
ECHO.
ECHO   Verificando se o Node.js e o NPM estao instalados...
ECHO.

:: Verifica se o comando 'npm' existe e está no PATH do sistema.
npm --version >nul 2>nul
IF NOT %ERRORLEVEL% EQU 0 (
    ECHO [ERRO] Node.js e NPM nao foram encontrados no seu sistema.
    ECHO.
    ECHO Por favor, instale a versao LTS do Node.js a partir do site oficial:
    ECHO https://nodejs.org/
    ECHO.
    ECHO Apos a instalacao, execute este script novamente.
    GOTO:END
)

ECHO [OK] Node.js e NPM encontrados.
ECHO.
ECHO Iniciando a instalacao das dependencias. Isso pode levar alguns minutos...
ECHO.

:: Executa o comando principal para instalar as dependencias do package.json
npm install

:: Verifica se a instalação foi bem-sucedida
IF NOT %ERRORLEVEL% EQU 0 (
    ECHO [ERRO] Ocorreu um problema durante a instalacao com 'npm install'.
    ECHO.
    ECHO Verifique a sua conexao com a internet ou as mensagens de erro acima.
    GOTO:END
)

ECHO.
ECHO     #######################################################
ECHO     #                                                     #
ECHO     #               INSTALACAO CONCLUIDA!                 #
ECHO     #                                                     #
ECHO     #######################################################
ECHO.
ECHO   Todas as dependencias foram instaladas com sucesso.
ECHO.
ECHO   Para iniciar o servidor da API, use o comando: npm start
ECHO   Para iniciar o bot, use o comando em outro terminal: npm run start:bot
ECHO.

:END
ECHO Pressione qualquer tecla para fechar esta janela...
PAUSE >nul
