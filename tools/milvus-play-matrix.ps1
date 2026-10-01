<#--
  tools/milvus-play-matrix.ps1
  Matriz de validação do "play" via API Milvus.

  SOMENTE chamado de TESTE em status Novo/"A fazer". Nunca rode em chamado
  de cliente real.

  USO (PowerShell):
    $env:MILVUS_API_TOKEN = 'seu_token_aqui'   # nunca commite / nunca cole no chat
    .\tools\milvus-play-matrix.ps1 -CodigoTeste 26030 -TecnicoNome 'Nome Exato' -TecnicoEmail 'tec@empresa.com'

  O que faz, nesta ordem (para no primeiro sucesso que mover o status):
    A) atualizar { ids = id interno, tecnico = nome } -> reconsulta
    B) atualizar { ids = codigo,     tecnico = nome } -> reconsulta (só se A falhar)
    C) atualizar { ids = id interno, tecnico = e-mail } -> reconsulta (só se B falhar)
    D) acompanhamento com total_horas + externo -> reconsulta (só se alguma
       chamada teve sucesso mas o status continuou "A fazer")
  Respeita o rate limit (>1min entre chamadas) e grava log em $env:TEMP.
#>
param(
  [Parameter(Mandatory = $true)][string]$CodigoTeste,
  [Parameter(Mandatory = $true)][string]$TecnicoNome,
  [Parameter(Mandatory = $true)][string]$TecnicoEmail,
  [string]$ApiUrl = 'https://apiintegracao.milvus.com.br'
)

$ErrorActionPreference = 'Stop'
$token = $env:MILVUS_API_TOKEN
if (-not $token) {
  Write-Error 'MILVUS_API_TOKEN não definido. Rode: $env:MILVUS_API_TOKEN = ''seu_token'' (sem exibir/colar o valor).'
  exit 1
}
$logFile = Join-Path $env:TEMP ("milvus-play-matrix-{0}-{1:yyyyMMdd-HHmmss}.log" -f $CodigoTeste, (Get-Date))

function Write-Log($Msg) {
  Write-Host $Msg
  Add-Content -Path $logFile -Value $Msg
}

function Invoke-Milvus($Method, $Path, $Body) {
  $json = $Body | ConvertTo-Json -Depth 6 -Compress
  Write-Log ("  payload: " + $json)
  try {
    $res = Invoke-RestMethod -Method $Method -Uri ($ApiUrl.TrimEnd('/') + $Path) `
      -Headers @{ Authorization = $token; 'Content-Type' = 'application/json' } `
      -Body $json -TimeoutSec 30
    $raw = if ($res -is [string]) { $res } else { ($res | ConvertTo-Json -Depth 4 -Compress) }
    if (-not $raw) { $raw = '(vazio — 204 sem corpo)' }
    return @{ ok = $true; status = 200; body = $raw }
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

function Get-Estado($CodigoBusca) {
  $r = Invoke-Milvus 'POST' '/api/chamado/listagem' @{
    is_paginate = $true; pagina = 1; total_registros = 50
    filtro_body = @{ codigo = [string]$CodigoBusca }
  }
  if (-not $r.ok) { return @{ estado = $null; statusTexto = $null; tecnico = $null; id = $null; http = $r.status; raw = $r.body } }
  $lista = @()
  if ($r.body -is [string]) {
    try { $r.body = $r.body | ConvertFrom-Json } catch { return @{ estado = $null; http = 200; raw = 'listagem ilegível' } }
  }
  if ($r.body.lista) { $lista = $r.body.lista } elseif ($r.body.data) { $lista = $r.body.data }
  $row = @($lista) | Where-Object { [string]$_.codigo -eq [string]$CodigoBusca } | Select-Object -First 1
  if (-not $row) { return @{ estado = $null; http = 200; raw = 'codigo não encontrado na listagem' } }
  $s = ([string]$row.status).ToLower().Replace(' ', '')
  if ($s.Contains('finaliz')) { $estado = 'finalizado' }
  elseif ($s -in @('afazer', 'agatendimento', 'novo', 'aberto', 'agendado', 'semtecnico')) { $estado = 'aguardando' }
  else { $estado = 'emandamento' }
  return @{ estado = $estado; statusTexto = [string]$row.status; tecnico = [string]$row.tecnico; id = [string]$row.id; http = 200; raw = $null }
}

function Wait-RateLimit($Motivo) {
  Write-Log '  aguardando 65s (rate limit >1min)...'
  Start-Sleep -Seconds 65
}

function Show-Estado($Tag, $E) {
  Write-Log ("  [{0}] HTTP={1} estado={2} statusTexto={3} tecnico={4} id={5}" -f $Tag, $E.http, $E.estado, $E.statusTexto, $E.tecnico, $E.id)
}

Write-Log '== PASSO 0: estado inicial (listagem) =='
$ini = Get-Estado $CodigoTeste
Show-Estado 'antes' $ini
if ($ini.estado -ne 'aguardando') {
  Write-Log ("ABORTADO: o chamado não está Novo/a fazer (estado={0}). Use um chamado de TESTE Novo." -f $ini.estado)
  Write-Log ("Log salvo em: " + $logFile)
  exit 2
}
$idInterno = $ini.id
$resultado = 'INCONCLUSIVO'
$tentativas = @(
  @{ nome = 'A: ids=id_interno + tecnico=nome'; body = @{ chamado_ids = $idInterno; chamado_tecnico = $TecnicoNome } },
  @{ nome = 'B: ids=codigo + tecnico=nome'; body = @{ chamado_ids = [string]$CodigoTeste; chamado_tecnico = $TecnicoNome } },
  @{ nome = 'C: ids=id_interno + tecnico=e-mail'; body = @{ chamado_ids = $idInterno; chamado_tecnico = $TecnicoEmail } }
)

$sucessoSemEfeito = $false
foreach ($t in $tentativas) {
  Write-Log ("== TENTATIVA " + $t.nome + " (atualizar) ==")
  $r = Invoke-Milvus 'POST' '/api/chamado/atualizar' $t.body
  $b = if ($r.body -is [string]) { $r.body } else { ($r.body | ConvertTo-Json -Compress) }
  Write-Log ("  HTTP={0} ok={1} body={2}" -f $r.status, $r.ok, $b.Substring(0, [Math]::Min(300, $b.Length)))
  if (-not $r.ok) { continue }  # falhou: próxima variante
  Wait-RateLimit 'reconsulta'
  Write-Log '== reconsulta (listagem) =='
  $dep = Get-Estado $CodigoTeste
  Show-Estado 'depois' $dep
  if ($dep.estado -eq $null) { $resultado = 'INCONCLUSIVO (reconsulta falhou)'; break }
  if ($dep.estado -eq 'emandamento') { $resultado = 'PLAY FUNCIONA via atualizar (' + $t.nome + ')'; break }
  $sucessoSemEfeito = $true
  break  # sucesso sem efeito no status: vai ao acompanhamento (passo D)
}

if ($sucessoSemEfeito -and $resultado -eq 'INCONCLUSIVO') {
  Write-Log '== PASSO D: acompanhamento com horas + externo =='
  $r = Invoke-Milvus 'POST' '/api/chamado/acompanhamento/criar' @{
    acompanhamento_ticket    = [string]$CodigoTeste
    acompanhamento_descricao = 'Play via integracao - teste com horas'
    acompanhamento_privado   = $true
    atendimento_total_horas  = '00:05'
    atendimento_externo      = $true
  }
  $b = if ($r.body -is [string]) { $r.body } else { ($r.body | ConvertTo-Json -Compress) }
  Write-Log ("  HTTP={0} ok={1} body={2}" -f $r.status, $r.ok, $b.Substring(0, [Math]::Min(300, $b.Length)))
  if ($r.ok) {
    Wait-RateLimit 'reconsulta'
    Write-Log '== reconsulta (listagem) =='
    $dep = Get-Estado $CodigoTeste
    Show-Estado 'depois' $dep
    if ($dep.estado -eq 'emandamento') { $resultado = 'PLAY FUNCIONA via acompanhamento com horas' }
    elseif ($dep.estado -ne $null) { $resultado = 'NADA MOVEU O STATUS (atualizar+acompanhamento) — play manual' }
  } else {
    $resultado = 'NADA MOVEU O STATUS (atualizar falhou em todas as variantes) — play manual'
  }
}

if ($resultado -eq 'INCONCLUSIVO' -and -not $sucessoSemEfeito) {
  $resultado = 'ATUALIZAR REJEITADO em todas as variantes — play manual'
}

Write-Log ''
Write-Log '== RESULTADO (cole de volta) =='
Write-Log $resultado
Write-Log ("Log salvo em: " + $logFile)
