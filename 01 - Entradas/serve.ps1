# =========================================================
# Servidor HTTP local simple (sin dependencias) para probar
# el flujo de venta de entradas desde el celular por WiFi.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File serve.ps1
#
# Luego abre en la PC:  http://localhost:8080/index.html
# Y en el celular (misma red WiFi): http://TU_IP_LOCAL:8080/index.html
# La IP local se muestra automáticamente al iniciar.
# =========================================================

param([int]$Puerto = 8080)

$raiz = $PSScriptRoot

# Si el puerto está ocupado por otro proyecto, se busca el siguiente libre en vez
# de arrancar sobre él y terminar sirviendo la carpeta equivocada.
function Test-PuertoLibre([int]$p) {
  try {
    $prueba = New-Object System.Net.HttpListener
    $prueba.Prefixes.Add("http://localhost:$p/")
    $prueba.Start()
    $prueba.Stop()
    return $true
  } catch {
    return $false
  }
}

$puerto = $Puerto
while (-not (Test-PuertoLibre $puerto) -and $puerto -lt ($Puerto + 20)) {
  Write-Host "Puerto $puerto ocupado, probando el siguiente..." -ForegroundColor Yellow
  $puerto++
}

$mimeTypes = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".ico"  = "image/x-icon"
}

$ipsLocales = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
  Select-Object -ExpandProperty IPAddress

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://+:$puerto/")

try {
  $listener.Start()
} catch {
  Write-Host "No se pudo escuchar en todas las interfaces (http://+:$puerto/)." -ForegroundColor Yellow
  Write-Host "Reintentando solo en localhost. Para acceder desde el celular ejecuta este script como Administrador." -ForegroundColor Yellow
  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add("http://localhost:$puerto/")
  try {
    $listener.Start()
  } catch {
    Write-Host "No se pudo iniciar el servidor en el puerto $puerto. Error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
  }
}

Write-Host "Servidor iniciado. Accesos disponibles:" -ForegroundColor Green
Write-Host "  http://localhost:$puerto/index.html"
foreach ($ip in $ipsLocales) {
  Write-Host "  http://$ip`:$puerto/index.html  (usa esta URL desde el celular, misma red WiFi)"
}
Write-Host "Presiona Ctrl+C para detener el servidor." -ForegroundColor Yellow

while ($listener.IsListening) {
  $context = $listener.GetContext()
  $request = $context.Request
  $response = $context.Response

  $rutaSolicitada = $request.Url.LocalPath
  if ($rutaSolicitada -eq "/") { $rutaSolicitada = "/index.html" }

  $rutaArchivo = Join-Path $raiz ($rutaSolicitada.TrimStart("/"))

  if (Test-Path $rutaArchivo -PathType Leaf) {
    $extension = [System.IO.Path]::GetExtension($rutaArchivo)
    $tipo = $mimeTypes[$extension]
    if (-not $tipo) { $tipo = "application/octet-stream" }

    $bytes = [System.IO.File]::ReadAllBytes($rutaArchivo)
    $response.ContentType = $tipo
    $response.ContentLength64 = $bytes.Length
    $response.OutputStream.Write($bytes, 0, $bytes.Length)
  } else {
    $response.StatusCode = 404
    $mensaje = [System.Text.Encoding]::UTF8.GetBytes("404 - No encontrado: $rutaSolicitada")
    $response.OutputStream.Write($mensaje, 0, $mensaje.Length)
  }

  $response.OutputStream.Close()
}
