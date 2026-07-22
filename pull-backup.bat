@echo off
title SeraTecnologia - Pull Backup
echo ========================================
echo  Pull do GitHub - SeraTecnologia
echo ========================================
echo.
git pull origin master
echo.
if %errorlevel% equ 0 (
    echo OK - repositorio atualizado!
) else (
    echo ERRO - verifique sua conexao ou token
)
echo.
pause
