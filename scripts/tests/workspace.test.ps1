$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$scriptFile = Join-Path $projectRoot 'scripts\workspace.ps1'
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($scriptFile, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }

# Load definitions without running startup, stopping services, or reading real credentials.
foreach ($definition in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
    Invoke-Expression $definition.Extent.Text
}
function Assert($Condition, $Message) { if (-not $Condition) { throw $Message } }
$testDirectory = Join-Path $projectRoot ('tmp\startup-check-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -Path $testDirectory -ItemType Directory
$localConfig = Join-Path $testDirectory '.env'
$env:PANDORA_DB_PASSWORD = ''; $env:SPRING_DATASOURCE_PASSWORD = ''
$env:PANDORA_JWT_SECRET = ''; $env:PANDORA_DB_USERNAME = ''
$env:SPRING_DATASOURCE_USERNAME = ''; $env:SPRING_PROFILES_ACTIVE = 'demo'
$Check = $true
$threw = $false
try { Initialize-LocalConfiguration } catch { $threw = $true }
Assert $threw 'Check must report missing configuration without prompting.'
Assert (-not (Test-Path $localConfig)) 'Check must not create a configuration file.'

$Check = $false
function Read-Host {
    param($Prompt, [switch]$AsSecureString)
    if ($AsSecureString) { return ConvertTo-SecureString 'test-only-$literal-password' -AsPlainText -Force }
    return 'test-user'
}
Initialize-LocalConfiguration
$firstSecret = $env:PANDORA_JWT_SECRET
Assert ([Convert]::FromBase64String($firstSecret).Length -eq 32) 'Setup must generate a random 32-byte JWT key.'
Assert ($env:PANDORA_DB_USERNAME -eq 'test-user') 'Setup must use the selected MySQL account.'
$config = Get-Content -LiteralPath $localConfig -Raw -Encoding UTF8
Assert ($config.Contains('PANDORA_DB_PASSWORD=test-only-$literal-password')) 'Passwords must be saved literally.'
Assert ($config.Contains("PANDORA_JWT_SECRET=$firstSecret")) 'The generated key must persist across launches.'
Initialize-LocalConfiguration
Assert ($env:PANDORA_JWT_SECRET -eq $firstSecret) 'Subsequent launches must not rotate the login key.'
Add-Content -LiteralPath $localConfig -Value '# keep user settings' -Encoding UTF8
Save-LocalConfiguration @{PANDORA_DB_USERNAME='updated-user'}
$config = Get-Content -LiteralPath $localConfig -Raw -Encoding UTF8
Assert ($config.Contains('# keep user settings') -and $config.Contains("PANDORA_JWT_SECRET=$firstSecret")) 'Updating a value must preserve other settings.'
Assert ($config.Contains('PANDORA_DB_USERNAME=updated-user')) 'Existing values must be updated.'

$launcherPath = $scriptFile
$stamp = [datetime]::UtcNow
$script:fakeProcesses = @{
    123 = [pscustomobject]@{Id=123;StartTime=$stamp}
    456 = [pscustomobject]@{Id=456;StartTime=$stamp}
}
$script:workers = @(
    [pscustomobject]@{ProcessId=123;CommandLine=('powershell.exe -File "{0}" -Service Backend' -f $scriptFile)},
    [pscustomobject]@{ProcessId=456;CommandLine='powershell.exe -File "D:\another-project\scripts\workspace.ps1" -Service Backend'},
    [pscustomobject]@{ProcessId=456;CommandLine=('powershell.exe -File "{0}" -Check' -f $scriptFile)}
)
function Get-CimInstance { param($Filter) return $script:workers }
function Get-Process { param($Id) return $script:fakeProcesses[[int]$Id] }
$owned = @(Find-ProjectWorkers)
Assert ($owned.Count -eq 1 -and $owned[0].pid -eq 123) 'Recovery must only identify this exact project script and a service argument.'
Assert ($null -ne (Get-OwnedProcess $owned[0])) 'A matching PID and creation time must be recognized.'
$owned[0].started = $stamp.AddSeconds(-1).Ticks.ToString()
Assert ($null -eq (Get-OwnedProcess $owned[0])) 'Reused PIDs with different creation times must not be stopped.'
$stateFile = Join-Path $testDirectory 'processes.json'
$recovered = @(Read-RunState)
Assert ($recovered.Count -eq 1) 'Missing state must recover existing project workers.'
Write-RunState $recovered
Assert (@(Read-RunState).Count -eq 1) 'Recovery must not duplicate recorded workers.'
$script:workers = @()
Write-RunState @()
Assert ((Get-Content -LiteralPath $stateFile -Raw).Trim() -eq '[]') 'Empty process state must serialize as an empty JSON array.'
Assert (@(Read-RunState).Count -eq 0) 'Empty JSON state must not become a phantom process entry.'
Assert ($null -eq (Get-OwnedProcess $null)) 'Missing process entries must never resolve to the current process.'
Write-Host 'Startup checks passed: noninteractive check, first-run setup, literal password persistence, stable JWT key, settings preservation, exact worker recovery, PID reuse and state deduplication.'
