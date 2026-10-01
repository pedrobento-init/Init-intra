<#--
  tools/milvus-play-check.ps1
  Validação manual do "play" (etapa 2 da tarefa): verifica se atribuir um
  técnico via POST /api/chamado/atualizar move um chamado de Novo para
  Em atendimento.

  USO (PowerShell, Windows):
    $env:MILVUS_API_TOKEN = 'seu_token_aqui'   # nunca commite / nunca cole no chat
    .\tools\milvus-play-check.ps1 -Codigo 123456 -Tecnico 'tecnico@empresa.com.br'

  Pré-requisitos:
  - Um CHAMADO DE TESTE (nunca de cliente real), atualmente Novo/"a fazer".
  - O token é lido SÓ de variável de ambiente e nunca é exibido.

  Respeita o rate limit documentado (>1 min entre requisições): aguarda 65s
  entre cada chamada. Duração total ~2,5 min.
#>
param(
  [Parameter(Mandatory = $true)][string]$Codigo,
  [Parameter(Mandatory = $true)][string]$Tecnico,
  [string]$ApiUrl = 'https://apiintegracao.milvus.com.br'
)

$ErrorActionPreference = 'Stop'
$token = $env:MILVUS_API_TOKEN
if (-not $token) {
  Write-Error 'MILVUS_API_TOKEN não definido. Rode: $env:MILVUS_API_TOKEN = ''seu_token'' (sem exibir/colar o valor).'
  exit 1
}

function Invoke-Milvus($Method, $Path, $Body) {
  $json = $Body | ConvertTo-Json -Depth 6 -Compress
  try {
    $res = Invoke-RestMethod -Method $Method -Uri ($ApiUrl.TrimEnd('/') + $Path) `
      -Headers @{ Authorization = $token; 'Content-Type' = 'application/json' } `
      -Body $json -TimeoutSec 30
    return @{ ok = $true; status = 200; body = $res }
  } catch {
    $code = $null
    try { $code = [int]$_.Exception.Response.StatusCode } catch { }
    $raw = ''
    try {
      $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      $raw = $sr.ReadToEnd()
    } catch { }
    return @{ ok = $false; status = $code; body = $raw }
  }
}

function Get-ChamadoStatus($CodigoBusca) {
  $r = Invoke-Milvus 'POST' '/api/chamado/listagem' @{
    is_paginate = $true; pagina = 1; total_registros = 50
    filtro_body = @{ codigo = $CodigoBusca }
  }
  if (-not $r.ok) { return @{ estado = $null; http = $r.status; raw = $r.body } }
  $lista = @()
  if ($r.body.lista) { $lista = $r.body.lista } elseif ($r.body.data) { $lista = $r.body.data }
  $row = @($lista) | Where-Object { [string]$_.codigo -eq [string]$CodigoBusca } | Select-Object -First 1
  if (-not $row) { return @{ estado = $null; http = 200; raw = 'codigo não encontrado na listagem' } }
  $s = ([string]$row.status).ToLower().Replace(' ', '')
  if ($s.Contains('finaliz')) { $estado = 'finalizado' }
  elseif ($s -in @('afazer', 'agatendimento', 'novo', 'aberto', 'agendado', 'semtecnico')) { $estado = 'aguardando' }
  else { $estado = 'emandamento' }
  return @{ estado = $estado; statusTexto = [string]$row.status; http = 200; raw = ($row | ConvertTo-Json -Depth 4 -Compress) }
}

function Wait-RateLimit($Segundos, $Motivo) {
  Write-Host "Aguardando ${Segundos}s ($Motivo, rate limit >1min)..."
  Start-Sleep -Seconds $Segundos
}

Write-Host '== 1/3 estado ANTES (listagem) =='
$antes = Get-ChamadoStatus $Codigo
Write-Host ("HTTP={0} estado={1} statusTexto={2}" -f $antes.http, $antes.estado, $antes.statusTexto)
if ($antes.estado -ne 'aguardando') {
  Write-Warning ("O chamado não está Novo/a fazer (estado={0}). Para validar o play, use um chamado de teste Novo." -f $antes.estado)
}
Wait-RateLimit 65 'antes do play'

Write-Host '== 2/3 play (atualizar com técnico) =='
$play = Invoke-Milvus 'POST' '/api/chamado/atualizar' @{ chamado_ids = [string]$Codigo; chamado_tecnico = $Tecnico }
$playRaw = if ($play.body -is [string]) { $play.body } else { ($play.body | ConvertTo-Json -Depth 4 -Compress) }
Write-Host ("HTTP={0} ok={1} body={2}" -f $play.status, $play.ok, $playRaw.Substring(0, [Math]::Min(300, $playRaw.Length)))
Wait-RateLimit 65 'antes da reconsulta'

Write-Host '== 3/3 estado DEPOIS (listagem) =='
$depois = Get-ChamadoStatus $Codigo
Write-Host ("HTTP={0} estado={1} statusTexto={2}" -f $depois.http, $depois.estado, $depois.statusTexto)

Write-Host ''
Write-Host '== RESULTADO =='
if ($antes.estado -eq 'aguardando' -and $play.ok -and $depois.estado -eq 'emandamento') {
  Write-Host 'PLAY FUNCIONA: Novo -> Em atendimento após atribuir técnico.'
} elseif ($antes.estado -eq 'aguardando' -and (-not $play.ok)) {
  Write-Host ("PLAY FALHOU NA API (HTTP={0}). Causa provável na resposta acima." -f $play.status)
} elseif ($antes.estado -eq 'aguardando') {
  Write-Host ("PLAY SEM EFEITO NO STATUS (antes={0}, depois={1}). Alternativa: play manual no portal." -f $antes.estado, $depois.estado)
} else {
  Write-Host 'INCONCLUSIVO: o chamado não estava Novo no início. Repita com um chamado de teste Novo.'
}
