$base = "https://seratecnologia-1.onrender.com"
$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession

function GetLogin {
  for ($i = 1; $i -le 5; $i++) {
    try { return Invoke-WebRequest -Uri ($base + "/admin/login") -WebSession $s -UseBasicParsing -TimeoutSec 50 -ErrorAction Stop }
    catch [System.Net.WebException] { if ($_.Exception.Response.StatusCode -eq 'ServiceUnavailable') { Start-Sleep -Seconds 10; continue } throw }
  }
}

$r = GetLogin
if ($r.Content -match 'name="_csrf" value="([^"]+)"') { $csrf = $Matches[1] } else { Write-Host "NAO ACHOU _csrf"; exit }

$body = "username=admin&password=admn123&_csrf=$csrf"
try {
  $r2 = Invoke-WebRequest -Uri ($base + "/admin/login") -WebSession $s -Method Post -ContentType "application/x-www-form-urlencoded" -Body $body -MaximumRedirection 0 -TimeoutSec 50 -ErrorAction SilentlyContinue
  Write-Host ("POST /admin/login -> Status " + $r2.StatusCode)
  if ($r2.StatusCode -eq 302) { Write-Host ("  Location: " + $r2.Headers['Location'] + "  => LOGIN OK") }
  else {
    $err = [regex]::Match($r2.Content, 'class="error[^"]*"[^>]*>([^<]+)<').Groups[1].Value
    Write-Host ("  Sem redirect. Possivel erro: " + $err)
    Write-Host ("  Tem 'Credenciais inv' ? " + ($r2.Content -match 'Credenciais inv'))
    Write-Host ("  Tem 'dashboard' ? " + ($r2.Content -match 'dashboard'))
  }
} catch [System.Net.WebException] {
  Write-Host ("WebException: " + $_.Exception.Message)
}
