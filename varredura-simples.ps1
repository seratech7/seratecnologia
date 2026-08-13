# Varredura simplificada usando TCP
$Subnet = "192.168.1"
$activeHosts = @()

Write-Host "Varredura TCP na rede $Subnet.0/24..." -ForegroundColor Yellow
Write-Host "Testando portas 80, 443, 22, 3389..." -ForegroundColor Gray

for ($i = 1; $i -le 254; $i++) {
    $ip = "$Subnet.$i"
    $found = $false
    
    foreach ($port in @(80, 443, 22, 3389, 445, 8080)) {
        $tcpClient = New-Object System.Net.Sockets.TcpClient
        try {
            $result = $tcpClient.BeginConnect($ip, $port, $null, $null)
            $success = $result.AsyncWaitHandle.WaitOne(100, $false)
            if ($success -and $tcpClient.Connected) {
                $activeHosts += $ip
                Write-Host "   $ip - Porta $port aberta" -ForegroundColor Green
                $found = $true
                break
            }
        } catch {}
        finally { $tcpClient.Close() }
    }
}

Write-Host ""
Write-Host "Total de hosts encontrados: $($activeHosts.Count)" -ForegroundColor Cyan
$activeHosts