$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3000'
$results = @()
function AddResult($name, $expected, $actual, $url) {
  $pass = ($expected -contains $actual)
  $script:results += [PSCustomObject]@{ Nome = $name; Esperado = ($expected -join '/'); Obtido = $actual; OK = $pass; Url = $url }
}
function GetPage($url, $session) {
  try { return Invoke-WebRequest -Uri $url -Method Get -WebSession $session -MaximumRedirection 0 -UseBasicParsing -TimeoutSec 30 -ErrorAction SilentlyContinue } catch { $r = $_.Exception.Response; if ($r) { return $r } else { throw } }
}
function PostPage($url, $body, $session) {
  try { return Invoke-WebRequest -Uri $url -Method Post -Body $body -ContentType 'application/x-www-form-urlencoded' -WebSession $session -MaximumRedirection 0 -UseBasicParsing -TimeoutSec 30 -ErrorAction SilentlyContinue } catch { $r = $_.Exception.Response; if ($r) { return $r } else { throw } }
}
function GetCsrf($resp) {
  $csrf = ''
  if ($resp.Forms.Count -gt 0) { $csrf = $resp.Forms[0].Fields['_csrf'] }
  if (-not $csrf) { $m = [regex]::Match($resp.Content, 'name="_csrf" value="([^"]+)"'); if ($m.Success) { $csrf = $m.Groups[1].Value } }
  return $csrf
}
function Loc($resp) { return $resp.Headers['Location'] }

$ts = [DateTime]::Now.ToString('yyyyMMddHHmmss')
$custEmail = "completo_cust_$ts@teste.com"
$custPw = 'SenhaForte123'
$sellerEmail = 'vend_teste_completo@teste.com'
$sellerPw = 'venda123'

# ---------- PAGINAS PUBLICAS ----------
Write-Host "== PAGINAS PUBLICAS =="
$r = GetPage "$base/" $null; AddResult 'Home /' @(200) $r.StatusCode '/'
$r = GetPage "$base/marketplace" $null; AddResult 'Marketplace' @(200) $r.StatusCode '/marketplace'
$r = GetPage "$base/noticias" $null; AddResult 'Noticias' @(200) $r.StatusCode '/noticias'
$r = GetPage "$base/noticias?sort=popular" $null; AddResult 'Noticias (popular)' @(200) $r.StatusCode '/noticias?sort=popular'
$r = GetPage "$base/login" $null; AddResult 'Login cliente' @(200) $r.StatusCode '/login'
$r = GetPage "$base/registro" $null; AddResult 'Registro cliente' @(200) $r.StatusCode '/registro'
$r = GetPage "$base/seller/login" $null; AddResult 'Login vendedor' @(200) $r.StatusCode '/seller/login'
$r = GetPage "$base/admin/login" $null; AddResult 'Login admin' @(200) $r.StatusCode '/admin/login'
$r = GetPage "$base/produto/1" $null; AddResult 'Produto #1' @(200,404) $r.StatusCode '/produto/1'
$r = GetPage "$base/zzz-inexistente-xyz" $null; AddResult '404 rota invalida' @(404) $r.StatusCode '/zzz-inexistente-xyz'

# ---------- ADMIN ----------
Write-Host "== ADMIN =="
$sAdmin = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$r = GetPage "$base/admin/login" $sAdmin; AddResult 'Admin: GET login' @(200) $r.StatusCode '/admin/login'
$csrf = GetCsrf $r
$r = PostPage "$base/admin/login" "username=admin&password=admn123&_csrf=$csrf" $sAdmin
AddResult 'Admin: POST login' @(302) $r.StatusCode '/admin/login'; AddResult 'Admin: redireciona p/ dashboard' @('/admin/dashboard') (Loc $r) '/admin/login'
$r = GetPage "$base/admin/dashboard" $sAdmin; AddResult 'Admin: dashboard' @(200) $r.StatusCode '/admin/dashboard'
$r = GetPage "$base/admin/products" $sAdmin; AddResult 'Admin: produtos' @(200) $r.StatusCode '/admin/products'
$r = GetPage "$base/admin/noticias" $sAdmin; AddResult 'Admin: noticias' @(200) $r.StatusCode '/admin/noticias'
$r = GetPage "$base/admin/sellers" $sAdmin; AddResult 'Admin: vendedores' @(200) $r.StatusCode '/admin/sellers'
$r = GetPage "$base/admin/config" $sAdmin; AddResult 'Admin: config' @(200) $r.StatusCode '/admin/config'
$r = GetPage "$base/admin/logout" $sAdmin; AddResult 'Admin: logout' @(302) $r.StatusCode '/admin/logout'
$r = GetPage "$base/admin/dashboard" $sAdmin; AddResult 'Admin: dashboardapos logout (deve bloquear)' @(302) $r.StatusCode '/admin/dashboard'

# ---------- VENDEDOR ----------
Write-Host "== VENDEDOR =="
$sSeller = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$r = GetPage "$base/seller/login" $sSeller; AddResult 'Vend: GET login' @(200) $r.StatusCode '/seller/login'
$csrf = GetCsrf $r
$r = PostPage "$base/seller/login" "email=$sellerEmail&password=$sellerPw&_csrf=$csrf" $sSeller
AddResult 'Vend: POST login' @(302) $r.StatusCode '/seller/login'; AddResult 'Vend: redireciona p/ dashboard' @('/seller/dashboard') (Loc $r) '/seller/login'
$r = GetPage "$base/seller/dashboard" $sSeller; AddResult 'Vend: dashboard' @(200) $r.StatusCode '/seller/dashboard'
$r = GetPage "$base/seller/products" $sSeller; AddResult 'Vend: produtos' @(200) $r.StatusCode '/seller/products'
$r = GetPage "$base/seller/profile" $sSeller; AddResult 'Vend: perfil' @(200) $r.StatusCode '/seller/profile'
$r = GetPage "$base/seller/logout" $sSeller; AddResult 'Vend: logout' @(302) $r.StatusCode '/seller/logout'
$r = GetPage "$base/seller/dashboard" $sSeller; AddResult 'Vend: dashboard apos logout (deve bloquear)' @(302) $r.StatusCode '/seller/dashboard'

# ---------- CLIENTE (registro + login + navegacao) ----------
Write-Host "== CLIENTE =="
$sCust = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$r = GetPage "$base/registro" $sCust; AddResult 'Cliente: GET registro' @(200) $r.StatusCode '/registro'
$csrf = GetCsrf $r
$r = PostPage "$base/registro" "name=TesteCompleto&email=$custEmail&phone=11999999999&password=$custPw&confirm_password=$custPw&_csrf=$csrf" $sCust
AddResult 'Cliente: POST registro' @(200,302) $r.StatusCode '/registro'
$r = GetPage "$base/login" $sCust; AddResult 'Cliente: GET login' @(200) $r.StatusCode '/login'
$csrf = GetCsrf $r
$r = PostPage "$base/login" "email=$custEmail&password=$custPw&_csrf=$csrf" $sCust
AddResult 'Cliente: POST login' @(302) $r.StatusCode '/login'; AddResult 'Cliente: redireciona p/ conta' @('/conta') (Loc $r) '/login'
$r = GetPage "$base/conta" $sCust; AddResult 'Cliente: conta' @(200) $r.StatusCode '/conta'
$r = GetPage "$base/marketplace" $sCust; AddResult 'Cliente: marketplace (logado)' @(200) $r.StatusCode '/marketplace'
$r = GetPage "$base/conta/sair" $sCust; AddResult 'Cliente: logout (sair)' @(302) $r.StatusCode '/conta/sair'
$r = GetPage "$base/conta" $sCust; AddResult 'Cliente: conta apos logout (deve bloquear)' @(302) $r.StatusCode '/conta'

# ---------- RESUMO ----------
Write-Host ""
Write-Host ("TOTAL: {0}  PASS: {1}  FAIL: {2}" -f $results.Count, ($results | Where-Object { $_.OK }).Count, ($results | Where-Object { -not $_.OK }).Count)
$results | Format-Table -AutoSize Nome, Esperado, Obtido, OK, Url | Out-String | Write-Host
$fails = $results | Where-Object { -not $_.OK }
if ($fails.Count -gt 0) { Write-Host "FALHAS:"; $fails | ForEach-Object { Write-Host ("  - {0} (esperado {1}, obtido {2}) em {3}" -f $_.Nome, $_.Esperado, $_.Obtido, $_.Url) } }
else { Write-Host "TODOS OS TESTES PASSARAM" }
