@echo off
title SeraTecnologia - Servidor
cd /d "C:\Users\ggdra\Documents\Default Project"
set PATH=C:\Program Files\nodejs;%PATH%
echo ========================================
echo  Iniciando servidor SeraTecnologia
echo ========================================
echo.
echo  Acesse: http://localhost:3000
echo  Admin:  http://localhost:3000/admin/login
echo.
echo  Pressione CTRL+C para parar
echo ========================================
echo.
node server.js
pause
