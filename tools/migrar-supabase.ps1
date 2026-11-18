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
    comparar           Roda tools/check-schema.sql (só SELECT) nos DOIS bancos e
                       mostra as diferenças de RLS, policies, grants, buckets e
                       funções. Os dois bancos são abertos em modo somente leitura.

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
  .\tools\migrar-supabase.ps1 -Etapa comparar
#>
[CmdletBinding()]
param(
  [ValidateSet('exportar', 'importar', 'conferir', 'comparar')]
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
  # Colar traz espaço e aspas de brinde: tira antes de validar.
  $valor = $valor.Trim().Trim('"', "'").Trim()
  if ($valor -notmatch '^postgres(ql)?://') {
    $inicio = if ($valor.Length -gt 0) { $valor.Substring(0, [Math]::Min(12, $valor.Length)) } else { '(vazio)' }
    Falhar ("A string de conexao ($rotulo) deve comecar com postgresql:// e o que chegou comeca com '$inicio'. " +
      'Copie a string da aba Session pooler (botao Connect), nao a URL https:// nem o comando psql.')
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
      # Cada passo é uma transação própria: se o esquema falhar, usuários e
      # buckets já ficaram. Repetir sem esta checagem bateria em chave duplicada.
      $usuarios = [int](Docker-Pg 'psql "$NEW_DB_URL" -At -c "select count(*) from auth.users"' @('NEW_DB_URL') | Select-Object -Last 1)
      if ($usuarios -gt 0) {
        Write-Host "Usuarios: o projeto novo ja tem $usuarios, pulando (importados numa tentativa anterior)." -ForegroundColor Yellow
      } else {
        Write-Host 'Importando usuarios...' -ForegroundColor Cyan
        Docker-Pg "$comuns --data-only /out/auth.dump" @('NEW_DB_URL', 'PGOPTIONS') | Out-Null
      }
      $buckets = [int](Docker-Pg 'psql "$NEW_DB_URL" -At -c "select count(*) from storage.buckets"' @('NEW_DB_URL') | Select-Object -Last 1)
      if ($buckets -gt 0) {
        Write-Host "Buckets: o projeto novo ja tem $buckets, pulando (importados numa tentativa anterior)." -ForegroundColor Yellow
      } else {
        Write-Host 'Importando buckets...' -ForegroundColor Cyan
        Docker-Pg "$comuns --data-only /out/storage-buckets.dump" @('NEW_DB_URL', 'PGOPTIONS') | Out-Null
      }
      Write-Host 'Importando o esquema public e os dados...' -ForegroundColor Cyan
      # Do que vai ser restaurado, saem duas coisas:
      #  - a linha que cria o schema public (ele já existe no projeto novo);
      #  - os DEFAULT ACL: são ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin,
      #    que o papel postgres não pode executar (permission denied) e que todo
      #    projeto Supabase novo já traz de fábrica.
      Docker-Pg "pg_restore -l /out/public.dump | grep -v -E ' SCHEMA - public( |`$)| DEFAULT ACL ' > /tmp/toc && $comuns -L /tmp/toc /out/public.dump" @('NEW_DB_URL', 'PGOPTIONS') | Out-Null
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

    'comparar' {
      Ler-Url 'projeto ANTIGO' 'OLD_DB_URL'
      Ler-Url 'projeto NOVO' 'NEW_DB_URL'
      Copy-Item -Path (Join-Path $PSScriptRoot 'check-schema.sql') -Destination (Join-Path $Pasta 'check-schema.sql') -Force
      # Belt and braces: o arquivo só tem SELECT (tests/check-schema.test.js), e
      # a sessão ainda abre em somente leitura.
      $env:PGOPTIONS = '-c default_transaction_read_only=on'
      Write-Host 'Rodando check-schema.sql nos dois projetos (somente leitura)...' -ForegroundColor Cyan
      Docker-Pg 'psql "$OLD_DB_URL" --csv -f /out/check-schema.sql > /out/schema-antigo.csv' @('OLD_DB_URL', 'PGOPTIONS') | Out-Null
      Docker-Pg 'psql "$NEW_DB_URL" --csv -f /out/check-schema.sql > /out/schema-novo.csv' @('NEW_DB_URL', 'PGOPTIONS') | Out-Null
      Remove-Item Env:PGOPTIONS -ErrorAction SilentlyContinue

      $antigo = @(Get-Content (Join-Path $Pasta 'schema-antigo.csv'))
      $novo = @(Get-Content (Join-Path $Pasta 'schema-novo.csv'))
      $diferencas = @(Compare-Object -ReferenceObject $antigo -DifferenceObject $novo)
      if ($diferencas.Count -eq 0) {
        Write-Host "Os dois projetos batem em tudo ($($antigo.Count) linhas)." -ForegroundColor Green
      } else {
        Write-Host "$($diferencas.Count) linha(s) diferente(s). '<=' so no ANTIGO, '=>' so no NOVO:" -ForegroundColor Yellow
        $diferencas | Select-Object -First 60 | ForEach-Object {
          Write-Host ('{0} {1}' -f $_.SideIndicator, $_.InputObject)
        }
        if ($diferencas.Count -gt 60) { Write-Host "... e mais $($diferencas.Count - 60). Veja os dois arquivos em $Pasta." }
        Write-Host ''
        Write-Host 'Esperado: diferem as policies do storage.objects (bloco 6), que nao vao no dump.' -ForegroundColor Yellow
        exit 2
      }
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
