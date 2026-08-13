#Requires -Version 5.1
param(
    [string]$OutputPath = ".\Relatorio-Seguranca-Rede"
)

$ErrorActionPreference = "SilentlyContinue"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  ANALISE COMPLETA DE SEGURANCA" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if (!(Test-Path $OutputPath)) {
    New-Item -ItemType Directory -Path $OutputPath | Out-Null
}

function Get-ServiceName {
    param([int]$Port)
    $services = @{
        21 = "FTP"; 22 = "SSH"; 23 = "Telnet"; 25 = "SMTP"; 53 = "DNS"
        80 = "HTTP"; 110 = "POP3"; 135 = "RPC"; 139 = "NetBIOS"; 143 = "IMAP"
        443 = "HTTPS"; 445 = "SMB"; 993 = "IMAPS"; 995 = "POP3S"
        1723 = "PPTP"; 3389 = "RDP"; 5900 = "VNC"; 8080 = "HTTP-Proxy"
    }
    return $services[$Port]
}

function Get-RiscoPorta {
    param([int]$Port)
    $risco = switch ($Port) {
        21 { "MEDIO - FTP sem criptografia" }
        22 { "BAIXO - SSH (verificar configuracao)" }
        23 { "CRITICO - Telnet inseguro" }
        25 { "MEDIO - SMTP exposto" }
        80 { "MEDIO - HTTP sem criptografia" }
        110 { "MEDIO - POP3 sem criptografia" }
        135 { "ALTO - RPC exposto" }
        139 { "ALTO - NetBIOS exposto" }
        143 { "MEDIO - IMAP sem criptografia" }
        443 { "BAIXO - HTTPS (normal)" }
        445 { "CRITICO - SMB exposto" }
        3389 { "CRITICO - RDP exposto" }
        5900 { "ALTO - VNC exposto" }
        8080 { "MEDIO - HTTP-Proxy" }
        default { "BAIXO" }
    }
    return $risco
}

function Get-StatusRisco {
    param([string]$Risco)
    if ($Risco -like "CRITICO*" -or $Risco -like "ALTO*") { return "CRITICO" }
    elseif ($Risco -like "MEDIO*") { return "MEDIO" }
    else { return "BAIXO" }
}

# Hosts conhecidos da varredura anterior
$activeHosts = @("192.168.1.1", "192.168.1.8")

Write-Host "[1/4] Verificando hosts ativos..." -ForegroundColor Yellow
foreach ($host in $activeHosts) {
    $ping = Test-Connection -ComputerName $host -Count 1 -Quiet -TimeoutSeconds 2
    $status = if ($ping) { "ATIVO" } else { "INATIVO" }
    Write-Host "   $host - $status" -ForegroundColor $(if ($ping) { "Green" } else { "Red" })
}

$activeHosts | Out-File "$OutputPath\hosts_ativos.txt"

Write-Host ""
Write-Host "[2/4] Varredura completa de portas..." -ForegroundColor Yellow

$portasComuns = @(21, 22, 23, 25, 53, 80, 110, 135, 139, 143, 443, 445, 993, 995, 1723, 3389, 5900, 8080)
$allResults = @()

foreach ($hostIP in $activeHosts) {
    Write-Host "   Escaneando $hostIP..." -ForegroundColor Gray
    foreach ($port in $portasComuns) {
        $tcpClient = New-Object System.Net.Sockets.TcpClient
        try {
            $connect = $tcpClient.BeginConnect($hostIP, $port, $null, $null)
            $wait = $connect.AsyncWaitHandle.WaitOne(300, $false)
            if ($wait -and $tcpClient.Connected) {
                $serviceName = Get-ServiceName -Port $port
                $risco = Get-RiscoPorta -Port $port
                $allResults += [PSCustomObject]@{
                    IP = $hostIP
                    Porta = $port
                    Servico = $serviceName
                    Risco = $risco
                    StatusRisco = Get-StatusRisco -Risco $risco
                }
                Write-Host "      Porta $port ($serviceName) - ABERTA" -ForegroundColor Red
            }
        } catch {}
        finally { $tcpClient.Close() }
    }
}

$allResults | Export-Csv "$OutputPath\portas_abertas.csv" -NoTypeInformation

Write-Host ""
Write-Host "[3/4] Verificando configuracoes de seguranca..." -ForegroundColor Yellow

# Firewall
Write-Host "   Firewall:" -ForegroundColor Gray
Get-NetFirewallProfile | ForEach-Object {
    $status = if ($_.Enabled) { "HABILITADO" } else { "DESABILITADO" }
    $color = if ($_.Enabled) { "Green" } else { "Red" }
    Write-Host "      $($_.Name): $status (Padrao: $($_.DefaultInboundAction))" -ForegroundColor $color
}

Get-NetFirewallProfile | Select-Object Name, Enabled, DefaultInboundAction | 
    Export-Csv "$OutputPath\status_firewall.csv" -NoTypeInformation

# Servicos Windows
Write-Host "   Servicos criticos:" -ForegroundColor Gray
$criticalServices = @("TermService", "LanmanServer", "LanmanWorkstation", "WinRM")
foreach ($svc in $criticalServices) {
    $service = Get-Service -Name $svc -ErrorAction SilentlyContinue
    if ($service) {
        Write-Host "      $($service.DisplayName): $($service.Status)" -ForegroundColor $(if ($service.Status -eq "Running") { "Yellow" } else { "Green" })
    }
}

# Hotfixes recentes
Write-Host "   Atualizacoes recentes:" -ForegroundColor Gray
$hotfixes = Get-HotFix -ErrorAction SilentlyContinue | Sort-Object InstalledOn -Descending | Select-Object -First 3
$hotfixes | ForEach-Object {
    Write-Host "      $($_.HotFixID) - $($_.InstalledOn.ToString('dd/MM/yyyy'))" -ForegroundColor Gray
}
$hotfixes | Export-Csv "$OutputPath\hotfixes_recentes.csv" -NoTypeInformation

Write-Host ""
Write-Host "[4/4] Gerando relatorio..." -ForegroundColor Yellow

$criticos = $allResults | Where-Object { $_.StatusRisco -eq "CRITICO" }
$medios = $allResults | Where-Object { $_.StatusRisco -eq "MEDIO" }

$report = @"
============================================
  RELATORIO DE SEGURANCA - REDE DOMESTICA
============================================
Data: $(Get-Date -Format "dd/MM/yyyy HH:mm:ss")
Rede: 192.168.1.0/24
Seu IP: 192.168.1.8

RESUMO GERAL:
- Hosts ativos: $($activeHosts.Count)
- Portas abertas identificadas: $(($allResults | Measure-Object).Count)
- Riscos CRITICOS: $(($criticos | Measure-Object).Count)
- Riscos MEDIOS: $(($medios | Measure-Object).Count)

============================================
DETECTADOS POR DISPOSITIVO:
============================================

--- 192.168.1.1 (ROTEADOR/GATEWAY) ---
$($allResults | Where-Object { $_.IP -eq "192.168.1.1" } | Format-Table Porta, Servico, Risco -AutoSize | Out-String)

--- 192.168.1.8 (SEU COMPUTADOR) ---
$($allResults | Where-Object { $_.IP -eq "192.168.1.8" } | Format-Table Porta, Servico, Risco -AutoSize | Out-String)

============================================
VULNERABILIDADES IDENTIFICADAS:
============================================
$($criticos | ForEach-Object { "[CRITICO] $($_.IP):$($_.Porta) - $($_.Servico) - $($_.Risco)" } | Out-String)
$($medios | ForEach-Object { "[MEDIO] $($_.IP):$($_.Porta) - $($_.Servico) - $($_.Risco)" } | Out-String)

============================================
RECOMENDACOES DE SEGURANCA:
============================================

1. ROTEADOR (192.168.1.1):
   - Acesse a interface web (http://192.168.1.1) e:
     * Altere a senha padrao do admin
     * Desabilite WPS se estiver habilitado
     * Use WPA3 ou WPA2-AES (nao WEP ou WPA-TKIP)
     * Desabilite UPnP se nao precisar
     * Atualize o firmware

2. SEU COMPUTADOR (192.168.1.8):
   - SMB (445) esta exposto - considere desabilitar se nao usar compartilhamento
   - Verifique se todas as atualizacoes do Windows estao instaladas
   - Considere usar um firewall mais restritivo

3. REDE:
   - Habilite o firewall em todos os dispositivos
   - Use senhas fortes para todos os dispositivos
   - Considere segmentar a rede (rede para convidados)
   - Monitore dispositivos conectados regularmente

============================================
"@

$report | Out-File "$OutputPath\relatorio_completo.txt" -Encoding UTF8

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  ANALISE CONCLUIDA!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "ARQUIVOS GERADOS:" -ForegroundColor Cyan
Get-ChildItem $OutputPath | ForEach-Object { 
    Write-Host "   - $($_.Name)" -ForegroundColor White
}
Write-Host ""
Write-Host "PORTAS ABERTAS POR DISPOSITIVO:" -ForegroundColor Yellow
$allResults | Format-Table IP, Porta, Servico, Risco -AutoSize