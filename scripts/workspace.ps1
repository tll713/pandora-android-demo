param(
    [switch]$Stop,
    [switch]$Check,
    [ValidateSet('Backend', 'Frontend')][string]$Service
)

$ErrorActionPreference = 'Stop'
$launcherPath = $PSCommandPath
$projectRoot = Split-Path -Parent $PSScriptRoot
$runDirectory = Join-Path $projectRoot 'tmp\run'
$stateFile = Join-Path $runDirectory 'processes.json'

# Read local configuration as data; environment variables take precedence.
$localConfig = Join-Path $projectRoot '.env'
if (Test-Path -LiteralPath $localConfig) {
    foreach ($line in (Get-Content -LiteralPath $localConfig -Encoding UTF8)) {
        if ($line -match '^\s*(SPRING_PROFILES_ACTIVE|PANDORA_DB_URL|PANDORA_DB_USERNAME|PANDORA_DB_PASSWORD|PANDORA_JWT_SECRET|PANDORA_DEMO_DATA_ENABLED|PANDORA_REQUIRE_HTTPS|PANDORA_BIND_ADDRESS|PANDORA_BOOTSTRAP_ENABLED|PANDORA_BOOTSTRAP_ADMIN_PHONE|PANDORA_BOOTSTRAP_ADMIN_PASSWORD)=(.*)$') {
            if (-not [Environment]::GetEnvironmentVariable($Matches[1], 'Process')) {
                [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim(), 'Process')
            }
        }
    }
}
if (-not $env:SPRING_PROFILES_ACTIVE) { $env:SPRING_PROFILES_ACTIVE = 'demo' }

function Test-TcpPort([string]$Computer, [int]$Port) {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $pending = $client.BeginConnect($Computer, $Port, $null, $null)
        if (-not $pending.AsyncWaitHandle.WaitOne(1000)) { return $false }
        $client.EndConnect($pending)
        return $true
    } catch { return $false } finally { $client.Dispose() }
}

function Find-Java {
    $candidates = @()
    if ($env:JAVA_HOME) { $candidates += Join-Path $env:JAVA_HOME 'bin\java.exe' }
    $command = Get-Command java.exe -ErrorAction SilentlyContinue
    if ($command) { $candidates += $command.Source }
    foreach ($base in @("$env:ProgramFiles\Java", "$env:ProgramFiles\Eclipse Adoptium", "$env:ProgramFiles\Microsoft")) {
        if (Test-Path -LiteralPath $base) {
            $candidates += @(Get-ChildItem -LiteralPath $base -Directory | ForEach-Object { Join-Path $_.FullName 'bin\java.exe' })
        }
    }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $candidate)) { continue }
        if (-not (Test-Path -LiteralPath (Join-Path (Split-Path $candidate) 'javac.exe'))) { continue }
        $versionInfo = (& $candidate --version | Out-String)
        if ($versionInfo -match '(?:version "|^(?:openjdk|java) )(\d+)' -and [int]$Matches[1] -ge 21) {
            $env:JAVA_HOME = Split-Path -Parent (Split-Path -Parent $candidate)
            return $candidate
        }
    }
    throw '需要安装 JDK 21 或以上版本，并配置 JAVA_HOME 或将 java 加入 PATH。'
}

function Find-Maven {
    $command = Get-Command mvn.cmd -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $mavenUserDirectory = Join-Path $env:USERPROFILE '.m2'
    if ($env:MAVEN_USER_HOME) { $mavenUserDirectory = $env:MAVEN_USER_HOME }
    $properties = Get-Content -LiteralPath (Join-Path $projectRoot 'server\.mvn\wrapper\maven-wrapper.properties') -Raw
    if ($properties -match 'apache-maven/([\d.]+)/') {
        $cacheDirectory = Join-Path $mavenUserDirectory "wrapper\dists\apache-maven-$($Matches[1])"
        if (Test-Path -LiteralPath $cacheDirectory) {
            $cached = Get-ChildItem -LiteralPath $cacheDirectory -Filter mvn.cmd -File -Recurse | Select-Object -First 1
            if ($cached) { return $cached.FullName }
        }
    }
    return Join-Path $projectRoot 'server\mvnw.cmd'
}

function Find-Node {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $command) { throw '需要安装 Node.js 20 或以上版本，并将 node 加入 PATH。' }
    $version = & $command.Source --version
    if ($version -notmatch '^v(\d+)' -or [int]$Matches[1] -lt 20) { throw 'Node.js 版本过低，请安装 Node.js 20 或以上版本。' }
    return $command.Source
}

function Save-LocalConfiguration($Values) {
    $lines = if (Test-Path -LiteralPath $localConfig) { @(Get-Content -LiteralPath $localConfig -Encoding UTF8) } else { @('# Local development configuration. Do not commit this file.') }
    $remaining = @{} + $Values
    $result = @($lines | ForEach-Object {
        if ($_ -match '^\s*([A-Z_]+)=.*$' -and $Values.ContainsKey($Matches[1])) {
            $key = $Matches[1]
            "$key=$($Values[$key])"
            $remaining.Remove($key)
        } else { $_ }
    })
    foreach ($key in ($remaining.Keys | Sort-Object)) { $result += "$key=$($remaining[$key])" }
    [IO.File]::WriteAllLines($localConfig, [string[]]$result, (New-Object Text.UTF8Encoding $false))
}

function Initialize-LocalConfiguration {
    $missingPassword = -not $env:PANDORA_DB_PASSWORD -and -not $env:SPRING_DATASOURCE_PASSWORD
    if ($Check -and ($missingPassword -or -not $env:PANDORA_JWT_SECRET)) {
        throw '后端尚未配置。请双击 start.cmd，按提示填写数据库账号和密码；脚本会自动生成并保存 JWT 密钥。也可手动填写根目录 .env。'
    }
    if ($env:PANDORA_JWT_SECRET -and [Text.Encoding]::UTF8.GetByteCount($env:PANDORA_JWT_SECRET) -lt 32) {
        throw '.env 或环境变量中的 PANDORA_JWT_SECRET 不足 32 字节，请替换为足够长的随机密钥，或清空后重新运行 start.cmd 自动生成。'
    }
    $updates = @{}
    if ($missingPassword) {
        Write-Host '首次启动后端：配置现有 MySQL 账号，输入内容只保存在本机 .env。' -ForegroundColor Yellow
        $databaseUser = if ($env:SPRING_DATASOURCE_USERNAME) { $env:SPRING_DATASOURCE_USERNAME } elseif ($env:PANDORA_DB_USERNAME) { $env:PANDORA_DB_USERNAME } else { 'pandora_app' }
        $answer = Read-Host "MySQL 用户名（回车使用 $databaseUser）"
        if ($answer.Trim()) { $databaseUser = $answer.Trim() }
        $securePassword = Read-Host 'MySQL 密码（输入时不显示）' -AsSecureString
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
        try { $databasePassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $securePassword.Dispose() }
        if (-not $databasePassword) { throw '未填写数据库密码，已取消启动。请使用现有 MySQL 账号的真实密码。' }
        $env:PANDORA_DB_USERNAME = $databaseUser
        $env:PANDORA_DB_PASSWORD = $databasePassword
        $updates['PANDORA_DB_USERNAME'] = $databaseUser
        $updates['PANDORA_DB_PASSWORD'] = $databasePassword
    }
    if (-not $env:PANDORA_JWT_SECRET) {
        $bytes = New-Object byte[] 32
        $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
        $env:PANDORA_JWT_SECRET = [Convert]::ToBase64String($bytes)
        $updates['PANDORA_JWT_SECRET'] = $env:PANDORA_JWT_SECRET
    }
    if ($updates.Count) {
        if (-not (Test-Path -LiteralPath $localConfig)) { $updates['SPRING_PROFILES_ACTIVE'] = $env:SPRING_PROFILES_ACTIVE }
        Save-LocalConfiguration $updates
        Write-Host '本机配置已保存到 .env，之后启动无需重复填写。' -ForegroundColor Green
    }
}

function Find-ProjectWorkers {
    # Recover script-owned workers if the ignored state file was removed.
    # Match this exact script path and service argument before recording a PID.
    try { $workers = @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction Stop) }
    catch { return @() }
    $pattern = '(?i)(?:^|\s)-File\s+"?' + [regex]::Escape($launcherPath) + '"?(?=\s|$).*?\s-Service\s+(Backend|Frontend)(?=\s|$)'
    foreach ($worker in $workers) {
        if ($worker.CommandLine -match $pattern) {
            $name = $Matches[1]
            $process = Get-Process -Id $worker.ProcessId -ErrorAction SilentlyContinue
            if ($process) { [pscustomobject]@{ service = $name; pid = $process.Id; started = $process.StartTime.ToUniversalTime().Ticks.ToString() } }
        }
    }
}

function Read-RunState {
    $entries = @()
    if (Test-Path -LiteralPath $stateFile) {
        try {
            $savedEntries = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
            $entries = @($savedEntries | Where-Object { $_ -and $_.pid -and $_.started -and $_.service -in @('Backend', 'Frontend') })
        }
        catch { throw "无法读取进程记录，请检查文件：$stateFile" }
    }
    foreach ($entry in @(Find-ProjectWorkers)) {
        if (-not ($entries | Where-Object { $_.pid -eq $entry.pid -and $_.started -eq $entry.started })) { $entries += $entry }
    }
    return $entries
}

function Get-OwnedProcess($Entry) {
    if (-not $Entry -or -not $Entry.pid -or -not $Entry.started) { return $null }
    $process = Get-Process -Id $Entry.pid -ErrorAction SilentlyContinue
    if ($process -and $process.StartTime -and $process.StartTime.ToUniversalTime().Ticks.ToString() -eq $Entry.started) { return $process }
    return $null
}

function Stop-OwnedProcesses($Entries) {
    foreach ($entry in $Entries) {
        $process = Get-OwnedProcess $entry
        if ($process) {
            Write-Host "正在停止 $($entry.service)..."
            & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F | Out-Null
            if ($LASTEXITCODE -ne 0 -and (Get-OwnedProcess $entry)) { throw "无法停止 $($entry.service)，请检查进程 $($process.Id)。" }
        }
    }
}

function Test-ServiceReady([string]$Name) {
    $port = if ($Name -eq 'Backend') { 8080 } else { 5173 }
    $asset = if ($Name -eq 'Backend') { 'app.js' } else { 'src/app.js' }
    $marker = if ($Name -eq 'Backend') { 'pandora.admin.token' } else { 'pandora.token' }
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/$asset" -TimeoutSec 2
        return $response.StatusCode -eq 200 -and $response.Content.Contains($marker)
    } catch { return $false }
}

function Write-RunState($Entries) {
    $validEntries = @($Entries | Where-Object { $_ -and $_.pid -and $_.started -and $_.service -in @('Backend', 'Frontend') })
    $json = if ($validEntries.Count) { ConvertTo-Json -InputObject $validEntries -Depth 4 } else { '[]' }
    Set-Content -LiteralPath $stateFile -Value $json -Encoding UTF8
}

try {
    if ($Stop) {
        Stop-OwnedProcesses @(Read-RunState)
        if (Test-Path -LiteralPath $stateFile) { Remove-Item -LiteralPath $stateFile }
        Write-Host '已停止本脚本启动的服务；单独运行的服务不受影响。' -ForegroundColor Green
        exit 0
    }

    # Worker processes keep Maven/Java and Node in separate, stoppable process trees.
    if ($Service -eq 'Backend') {
        $null = Find-Java
        $maven = Find-Maven
        Set-Location -LiteralPath (Join-Path $projectRoot 'server')
        $mavenArguments = @('spring-boot:run', '-Dspring-boot.run.arguments=--server.port=8080')
        $localRepository = Join-Path $projectRoot 'tmp\maven-repository'
        if (Test-Path -LiteralPath (Join-Path $localRepository 'org\springframework\boot\spring-boot-maven-plugin')) {
            $mavenArguments = @("-Dmaven.repo.local=$localRepository") + $mavenArguments
        }
        # Native tool warnings written to stderr must not terminate PowerShell.
        $ErrorActionPreference = 'Continue'
        & $maven @mavenArguments
        exit $LASTEXITCODE
    }
    if ($Service -eq 'Frontend') {
        $node = Find-Node
        $env:PANDORA_PORT = '5173'
        Set-Location -LiteralPath (Join-Path $projectRoot 'pandora-app')
        & $node 'server.mjs'
        exit $LASTEXITCODE
    }

    Write-Host '潘多拉 · 启动前后端' -ForegroundColor Cyan
    $java = Find-Java
    $node = Find-Node
    $maven = Find-Maven
    Write-Host "Java: $java"
    Write-Host "Node: $node"
    Write-Host "Maven: $maven"

    $servicesToStart = @()
    foreach ($name in @('Backend', 'Frontend')) {
        $port = if ($name -eq 'Backend') { 8080 } else { 5173 }
        if (Test-TcpPort '127.0.0.1' $port) {
            if (-not (Test-ServiceReady $name)) { throw "端口 $port 已被其他程序占用，或服务尚未启动完成。请关闭占用程序后重试。" }
            Write-Host "$name 已运行，复用端口 $port。" -ForegroundColor Green
        } else { $servicesToStart += $name }
    }

    if ($servicesToStart -contains 'Backend') {
        $databaseUrl = $env:SPRING_DATASOURCE_URL
        if (-not $databaseUrl) { $databaseUrl = $env:PANDORA_DB_URL }
        if (-not $databaseUrl) { $databaseUrl = 'jdbc:mysql://localhost:3306/pandora' }
        if ($databaseUrl -match '^jdbc:mysql://([^/:?]+)(?::(\d+))?/') {
            $databaseComputer = $Matches[1]
            $databasePort = if ($Matches[2]) { [int]$Matches[2] } else { 3306 }
            if (-not (Test-TcpPort $databaseComputer $databasePort)) {
                throw "无法连接 MySQL（${databaseComputer}:$databasePort）。请先启动 MySQL 服务；首次使用请按 README 准备数据库。"
            }
        }
        Initialize-LocalConfiguration
    }
    if ($Check) { Write-Host '环境检查通过，未启动任何服务。' -ForegroundColor Green; exit 0 }

    $null = New-Item -Path $runDirectory -ItemType Directory -Force
    $startLock = $null
    $startedEntries = @()
    try {
        try { $startLock = [IO.File]::Open((Join-Path $runDirectory 'start.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
        catch { throw '另一个启动脚本正在运行，请等待其完成。' }
        $entries = @(Read-RunState | Where-Object { Get-OwnedProcess $_ })
        Write-RunState $entries
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
        foreach ($name in $servicesToStart) {
            $stdout = Join-Path $runDirectory "$stamp-$name.log"
            $stderr = Join-Path $runDirectory "$stamp-$name.error.log"
            $worker = Start-Process -FilePath "$PSHOME\powershell.exe" -ArgumentList @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $launcherPath), '-Service', $name) -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
            $entry = [pscustomobject]@{ service = $name; pid = $worker.Id; started = $worker.StartTime.ToUniversalTime().Ticks.ToString(); stdout = $stdout; stderr = $stderr }
            $startedEntries += $entry
            $entries += $entry
            Write-RunState $entries
            Write-Host "正在启动 $name，日志：$stdout"
            $deadline = (Get-Date).AddMinutes(3)
            while (-not (Test-ServiceReady $name)) {
                $worker.Refresh()
                if ($worker.HasExited -or (Get-Date) -gt $deadline) {
                    Get-Content -LiteralPath $stdout, $stderr -Tail 16 -ErrorAction SilentlyContinue | Write-Host
                    throw "$name 启动失败或超过 3 分钟，请查看日志：$stdout 和 $stderr。首次启动需要联网下载 Maven 依赖，下载后可再次运行。"
                }
                Start-Sleep -Milliseconds 500
            }
            Write-Host "$name 启动成功。" -ForegroundColor Green
        }
    } catch {
        Stop-OwnedProcesses $startedEntries
        Write-RunState @(Read-RunState | Where-Object { Get-OwnedProcess $_ })
        throw
    } finally { if ($startLock) { $startLock.Dispose() } }

    Write-Host ''
    Write-Host '启动完成，关闭本窗口后服务继续运行。' -ForegroundColor Green
    Write-Host 'App 浏览器预览：http://127.0.0.1:5173'
    Write-Host 'Web 管理端：   http://127.0.0.1:8080'
    Write-Host "日志目录：     $runDirectory"
    Write-Host '结束使用时双击根目录 stop.cmd。'
} catch {
    Write-Host "错误：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
