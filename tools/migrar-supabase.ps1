<#
.SYNOPSIS
  Copia o banco de um projeto Supabase para outro (ex.: Canadá -> São Paulo).

.DESCRIPTION
  Roda na sua máquina, com o Docker (imagem postgres:17), em três etapas:

    exportar  (padrão) LÊ o projeto antigo e grava os arquivos em .\migracao.
                       Não escreve em banco nenhum.
    importar           Escreve no projeto NOVO, depois de você digitar MIGRAR.
                       Recusa um projeto novo que já tenha tabelas (use -Forcar
                       só se tiver certeza). Nunca escreve no projeto antigo.
    conferir           Compara a contagem de linhas dos dois lados.

  O que vai: esquema public (tabelas, funções, triggers, RLS, grants), usuários
  (auth.users e auth.identities), a lista de buckets e as tabelas da publicação
  Realtime. O que NÃO vai, e está no MIGRACAO-SUPABASE.md: arquivos do Storage,
  Edge Functions, secrets e configuração de Auth.

  As strings de conexão (use a do POOLER, aba Connect do painel) ficam só em
  variáveis de ambiente deste processo: não vão para a linha de comando, para o
  histórico nem para o disco. Se não estiverem definidas, o script pergunta.

    $env:OLD_DB_URL = '...'   # projeto antigo
    $env:NEW_DB_URL = '...'   # projeto novo

.EXAMPLE
  .\tools\migrar-supabase.ps1                      # só exporta
  .\tools\migrar-supabase.ps1 -Etapa importar
  .\tools\migrar-supabase.ps1 -Etapa conferir
#>
[CmdletBinding()]
param(
  [ValidateSet('exportar', 'importar', 'conferir')]
  [string]$Etapa = 'exportar',
  [string]$Pasta = (Join-Path (Split-Path $PSScriptRoot -Parent) 'migracao'),
  [switch]$Forcar
)

$ErrorActionPreference = 'Stop'
$Imagem = 'postgres:17'

function Falhar([string]$mensagem) {
  Write-Host "ERRO: $mensagem" -ForegroundColor Red
  exit 1
}

function Ler-Url([string]$rotulo, [string]$variavel) {
  $valor = [Environment]::GetEnvironmentVariable($variavel)
  if (-not $valor) {
    $segura = Read-Host -AsSecureString "Cole a string de conexao ($rotulo)"
    $valor = [Net.NetworkCredential]::new('', $segura).Password
  }
  if ($valor -notmatch '^postgres(ql)?://') {
    Falhar "A string de conexao ($rotulo) deve comecar com postgresql://"
  }
  Set-Item -Path "Env:$variavel" -Value $valor
}

function Host-De([string]$variavel) {
  $url = [Environment]::GetEnvironmentVariable($variavel)
  if ($url -match '@([^:/?]+)') { return $Matches[1] }
  return '(?)'
}

# Roda um comando dentro do contêiner postgres. As variáveis OLD_DB_URL e
# NEW_DB_URL entram pelo NOME (-e NOME), nunca pelo valor.
function Docker-Pg([string]$comando, [string[]]$variaveis = @()) {
  $argumentos = @('run', '--rm', '-v', "${Pasta}:/out")
  foreach ($v in $variaveis) { $argumentos += @('-e', $v) }
  $argumentos += @($Imagem, 'sh', '-c', $comando)
  $saida = & docker @argumentos
  if ($LASTEXITCODE -ne 0) { Falhar "Falhou: $comando" }
  return $saida
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Falhar 'Docker nao encontrado. Abra o Docker Desktop e tente de novo.'
}
New-Item -ItemType Directory -Force -Path $Pasta | Out-Null
$Pasta = (Resolve-Path $Pasta).Path

# SQL em arquivos: aspas simples dentro de 'sh -c' quebrariam o comando.
$sqlContagem = @'
select 'public.' || table_name as tabela,
       (xpath('/row/c/text()', query_to_xml(
          format('select count(*) as c from %I.%I', table_schema, table_name),
          false, true, '')))[1]::text::bigint as linhas
  from information_schema.tables
 where table_schema = 'public' and table_type = 'BASE TABLE'
union all select 'auth.users', count(*) from auth.users
union all select 'auth.identities', count(*) from auth.identities
union all select 'storage.buckets', count(*) from storage.buckets
order by 1;
'@
$sqlExtensoes = 'select extname from pg_extension order by 1;'
$sqlPublicacao = "select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' order by 1;"
$sqlTabelasNovo = "select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE';"
Set-Content -Path (Join-Path $Pasta 'contagem.sql') -Value $sqlContagem -Encoding ascii
Set-Content -Path (Join-Path $Pasta 'extensoes.sql') -Value $sqlExtensoes -Encoding ascii
Set-Content -Path (Join-Path $Pasta 'publicacao.sql') -Value $sqlPublicacao -Encoding ascii
Set-Content -Path (Join-Path $Pasta 'tabelas-novo.sql') -Value $sqlTabelasNovo -Encoding ascii

try {
  switch ($Etapa) {

    'exportar' {
      Ler-Url 'projeto ANTIGO' 'OLD_DB_URL'
      Write-Host "Exportando de $(Host-De 'OLD_DB_URL') (somente leitura)..." -ForegroundColor Cyan

      $versao = Docker-Pg 'psql "$OLD_DB_URL" -Atc "select version()"' @('OLD_DB_URL')
      Write-Host "Conectou: $versao"

      Docker-Pg 'pg_dump "$OLD_DB_URL" --schema=public --no-owner --format=custom --file=/out/public.dump' @('OLD_DB_URL') | Out-Null
      Docker-Pg 'pg_dump "$OLD_DB_URL" --data-only --format=custom --table=auth.users --table=auth.identities --file=/out/auth.dump' @('OLD_DB_URL') | Out-Null
      Docker-Pg 'pg_dump "$OLD_DB_URL" --data-only --format=custom --table=storage.buckets --file=/out/storage-buckets.dump' @('OLD_DB_URL') | Out-Null
      Docker-Pg 'psql "$OLD_DB_URL" -At -f /out/extensoes.sql > /out/extensoes.txt' @('OLD_DB_URL') | Out-Null
      Docker-Pg 'psql "$OLD_DB_URL" -At -f /out/publicacao.sql > /out/publicacao.txt' @('OLD_DB_URL') | Out-Null
      Docker-Pg 'psql "$OLD_DB_URL" --csv -f /out/contagem.sql > /out/contagem-antigo.csv' @('OLD_DB_URL') | Out-Null

      Write-Host ''
      Write-Host "Pronto. Arquivos em: $Pasta" -ForegroundColor Green
      Write-Host '  Confira ANTES de importar:'
      Write-Host '  - extensoes.txt: habilite as mesmas no projeto novo (Database > Extensions)'
      Write-Host '  - contagem-antigo.csv: linhas por tabela e usuarios'
      Write-Host '  - publicacao.txt: tabelas com Realtime (recriadas na importacao)'
      Write-Host '  Esta pasta tem DADOS REAIS (usuarios e clientes): nao envie nem commite.'
    }

    'importar' {
      foreach ($arq in 'public.dump', 'auth.dump', 'storage-buckets.dump') {
        if (-not (Test-Path (Join-Path $Pasta $arq))) {
          Falhar "Falta $arq. Rode primeiro: .\tools\migrar-supabase.ps1 -Etapa exportar"
        }
      }
      Ler-Url 'projeto NOVO' 'NEW_DB_URL'
      $hostNovo = Host-De 'NEW_DB_URL'
      Write-Host "Destino: $hostNovo" -ForegroundColor Yellow

      $tabelas = [int](Docker-Pg 'psql "$NEW_DB_URL" -At -f /out/tabelas-novo.sql' @('NEW_DB_URL') | Select-Object -Last 1)
      if ($tabelas -gt 0 -and -not $Forcar) {
        Falhar "O projeto novo ja tem $tabelas tabela(s) em public. Importar por cima mistura dados. Use um projeto vazio (ou -Forcar, sabendo o que faz)."
      }

      $resposta = Read-Host "Isto ESCREVE em $hostNovo. Digite MIGRAR para continuar"
      if ($resposta -ne 'MIGRAR') { Falhar 'Cancelado.' }

      # Usuarios primeiro (as tabelas de public referenciam auth.users) e depois
      # buckets e esquema. replica = não dispara triggers nem checa FK na carga.
      $env:PGOPTIONS = '-c session_replication_role=replica'
      $comuns = 'pg_restore --dbname="$NEW_DB_URL" --single-transaction --exit-on-error --no-owner'
      Write-Host 'Importando usuarios...' -ForegroundColor Cyan
      Docker-Pg "$comuns --data-only /out/auth.dump" @('NEW_DB_URL', 'PGOPTIONS') | Out-Null
      Write-Host 'Importando buckets...' -ForegroundColor Cyan
      Docker-Pg "$comuns --data-only /out/storage-buckets.dump" @('NEW_DB_URL', 'PGOPTIONS') | Out-Null
      Write-Host 'Importando o esquema public e os dados...' -ForegroundColor Cyan
      # O schema public ja existe no projeto novo: tira só a linha que o cria.
      Docker-Pg "pg_restore -l /out/public.dump | grep -v -E ' SCHEMA - public( |`$)' > /tmp/toc && $comuns -L /tmp/toc /out/public.dump" @('NEW_DB_URL', 'PGOPTIONS') | Out-Null
      Remove-Item Env:PGOPTIONS -ErrorAction SilentlyContinue

      $publicacao = Join-Path $Pasta 'publicacao.txt'
      if (Test-Path $publicacao) {
        Write-Host 'Recriando o Realtime...' -ForegroundColor Cyan
        # "ja e membro" não é erro aqui; no Windows PowerShell 5.1, o stderr do
        # comando nativo viraria erro fatal com o 'Stop' do topo do script.
        $ErrorActionPreference = 'Continue'
        foreach ($tabela in Get-Content $publicacao) {
          $nome = $tabela.Trim()
          # Valida: o nome vira parte de um comando SQL.
          if ($nome -notmatch '^[a-z_][a-z0-9_]*$') { continue }
          $sql = "alter publication supabase_realtime add table public.$nome;"
          Set-Content -Path (Join-Path $Pasta 'realtime.sql') -Value $sql -Encoding ascii
          & docker run --rm -v "${Pasta}:/out" -e NEW_DB_URL $Imagem sh -c 'psql "$NEW_DB_URL" -q -f /out/realtime.sql' 2>&1 | Out-Null
        }
        $ErrorActionPreference = 'Stop'
      }

      Write-Host ''
      Write-Host 'Importacao concluida. Rode agora: .\tools\migrar-supabase.ps1 -Etapa conferir' -ForegroundColor Green
    }

    'conferir' {
      $antigo = Join-Path $Pasta 'contagem-antigo.csv'
      if (-not (Test-Path $antigo)) { Falhar 'Falta contagem-antigo.csv (etapa exportar).' }
      Ler-Url 'projeto NOVO' 'NEW_DB_URL'
      Docker-Pg 'psql "$NEW_DB_URL" --csv -f /out/contagem.sql > /out/contagem-novo.csv' @('NEW_DB_URL') | Out-Null

      $velho = @{}
      Import-Csv $antigo | ForEach-Object { $velho[$_.tabela] = [long]$_.linhas }
      $novo = @{}
      Import-Csv (Join-Path $Pasta 'contagem-novo.csv') | ForEach-Object { $novo[$_.tabela] = [long]$_.linhas }

      $diferencas = 0
      foreach ($nome in (@($velho.Keys) + @($novo.Keys) | Sort-Object -Unique)) {
        $a = if ($velho.ContainsKey($nome)) { $velho[$nome] } else { 'falta' }
        $b = if ($novo.ContainsKey($nome)) { $novo[$nome] } else { 'falta' }
        $ok = ($a -eq $b)
        if (-not $ok) { $diferencas++ }
        $cor = if ($ok) { 'Green' } else { 'Red' }
        $marca = if ($ok) { 'OK       ' } else { 'DIFERENTE' }
        Write-Host ('{0} {1,-40} antigo={2,-8} novo={3}' -f $marca, $nome, $a, $b) -ForegroundColor $cor
      }
      Write-Host ''
      if ($diferencas -eq 0) {
        Write-Host 'Tudo bate. Falta: Storage, funcoes, secrets e enderecos (MIGRACAO-SUPABASE.md).' -ForegroundColor Green
      } else {
        Write-Host "$diferencas diferenca(s). NAO troque os enderecos do app antes de entender cada uma." -ForegroundColor Red
        exit 2
      }
    }
  }
}
finally {
  # Nada de string de conexão sobrando no ambiente depois do script.
  Remove-Item Env:OLD_DB_URL, Env:NEW_DB_URL, Env:PGOPTIONS -ErrorAction SilentlyContinue
}
