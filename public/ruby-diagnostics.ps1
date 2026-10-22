# Read-only Ruby diagnostics. No uploads, queue changes, or machine commands.
# Requires Windows PowerShell 5.1 or PowerShell 7. No administrator access needed.
# Credentials stay in this process. Redirects and cookies are disabled.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http

$base = Read-Host 'Ruby API address [https://localhost:5001]'
if ([string]::IsNullOrWhiteSpace($base)) { $base = 'https://localhost:5001' }
$uri = [Uri]$base
$loopback = $uri.IsLoopback
$address = $null
$isIp = [System.Net.IPAddress]::TryParse($uri.Host, [ref]$address)
$privateIp = $isIp -and $uri.Host -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)'
$knownHost = $uri.Host -in @('x-bidc229pc2', 'x-bidc229pc2.boilerad.purdue.edu')
if ((-not ($loopback -or $privateIp -or $knownHost)) -or
    ($uri.Scheme -ne 'https' -and -not ($loopback -and $uri.Scheme -eq 'http')) -or
    $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -ne '/') {
    throw 'Use the local Ruby API origin, such as https://localhost:5001.'
}
$base = $uri.GetLeftPart([UriPartial]::Authority)
$secureToken = Read-Host 'Ruby Personal Access Token (hidden; Enter to skip)' -AsSecureString
$token = [System.Net.NetworkCredential]::new('', $secureToken).Password.Trim() -replace '^Bearer\s+', ''
$format = Read-Host 'Authorization format [bearer], or raw'
if ($format -ne 'raw') { $format = 'bearer' }
$authValue = if ($format -eq 'raw') { $token } else { "Bearer $token" }
$origin = 'https://badges.purduehackers.com'

$handler = [System.Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect = $false
$handler.UseCookies = $false
$handler.UseDefaultCredentials = $false
$client = [System.Net.Http.HttpClient]::new($handler)
$client.Timeout = [TimeSpan]::FromSeconds(15)
$client.MaxResponseContentBufferSize = 8MB

function Protect-Data($value) {
    if ($null -eq $value) { return $null }
    if ($value -is [string]) {
        if ($token) { $value = $value.Replace($token, '[redacted]') }
        $value = $value -replace 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[redacted JWT]'
        return ($value -replace 'Bearer\s+[^\s"<>]+', 'Bearer [redacted]')
    }
    if ($value -is [System.Collections.IDictionary]) {
        $result = [ordered]@{}
        foreach ($key in $value.Keys) {
            $result[$key] = if ($key -match 'password|secret|token|authorization|cookie|credential|api[-_]?key' -and $value[$key] -is [string]) { '[redacted]' } else { Protect-Data $value[$key] }
        }
        return $result
    }
    if ($value -is [PSCustomObject]) {
        $result = [ordered]@{}
        foreach ($property in $value.PSObject.Properties) {
            $result[$property.Name] = if ($property.Name -match 'password|secret|token|authorization|cookie|credential|api[-_]?key' -and $property.Value -is [string]) { '[redacted]' } else { Protect-Data $property.Value }
        }
        return $result
    }
    if ($value -is [System.Collections.IEnumerable]) {
        return ,@(foreach ($item in $value) { Protect-Data $item })
    }
    return $value
}

function Read-Ruby($name, $path, $method = 'GET', $authenticated = $true) {
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $result = [ordered]@{ name = $name; path = $path; method = $method }
    $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new($method), "$base$path")
    $request.Headers.TryAddWithoutValidation('Accept', 'application/json') | Out-Null
    $request.Headers.TryAddWithoutValidation('Origin', $origin) | Out-Null
    if ($method -eq 'OPTIONS') {
        $request.Headers.TryAddWithoutValidation('Access-Control-Request-Method', 'GET') | Out-Null
        $request.Headers.TryAddWithoutValidation('Access-Control-Request-Headers', 'authorization') | Out-Null
    } elseif ($authenticated -and $token) {
        $request.Headers.TryAddWithoutValidation('Authorization', $authValue) | Out-Null
    }
    $response = $null
    try {
        $response = $client.SendAsync($request).GetAwaiter().GetResult()
        $result.status = [int]$response.StatusCode
        $result.state = if ($response.IsSuccessStatusCode) { 'collected' } else { 'error' }
        $headers = [ordered]@{}
        foreach ($header in $response.Headers) {
            if ($header.Key -match '^(Access-Control-|Server$|Vary$|WWW-Authenticate$)') {
                $headers[$header.Key] = $header.Value -join ', '
            }
        }
        $result.headers = $headers
        $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        if ($body -and $method -ne 'OPTIONS') {
            try { $result.data = Protect-Data (ConvertFrom-Json $body) }
            catch { $result.state = 'error'; $result.error = 'Response was not JSON. Check the API address and port.' }
        }
        Write-Host "$name : HTTP $($result.status)"
    } catch {
        $result.state = 'blocked'
        $result.error = Protect-Data $_.Exception.GetBaseException().Message
        Write-Host "$name : $($result.error)"
    } finally {
        $result.durationMs = $clock.ElapsedMilliseconds
        $request.Dispose()
        if ($response) { $response.Dispose() }
    }
    return $result
}

try {
    $checks = [System.Collections.Generic.List[object]]::new()
    $schema = Read-Ruby 'API schema' '/swagger/1.0-OpenApi/swagger.json' 'GET' $false
    if ($schema.status -in @(401, 403) -and $token) {
        $schema = Read-Ruby 'API schema' '/swagger/1.0-OpenApi/swagger.json' 'GET' $true
    }
    $checks.Add($schema)
    $checks.Add((Read-Ruby 'CORS preflight' '/api/OpenApi/GetDeviceStatus' 'OPTIONS' $false))
    foreach ($entry in @(
        @('Device', 'GetDeviceStatus'),
        @('Import profiles', 'GetImportProfiles'),
        @('Designs', 'GetDesigns'),
        @('Workbenches', 'GetWorkbenches'),
        @('Queue', 'GetQueueElements'),
        @('Job status', 'GetJobsStatus')
    )) { $checks.Add((Read-Ruby $entry[0] "/api/OpenApi/$($entry[1])")) }

    $report = [ordered]@{
        version = 1
        collectedAt = [DateTime]::UtcNow.ToString('o')
        source = 'windows'
        baseUrl = $base
        testedOrigin = $origin
        powershell = $PSVersionTable.PSVersion.ToString()
        os = [Environment]::OSVersion.VersionString
        auth = @{ supplied = [bool]$token; format = $format }
        checks = $checks.ToArray()
        notes = 'Only GET and OPTIONS requests. CORS headers are evidence, not proof that a browser will grant access. No TLS validation bypass.'
    }
    $file = Join-Path (Get-Location) ("ruby-diagnostics-" + [DateTime]::Now.ToString('yyyyMMdd-HHmmss') + '.json')
    $json = Protect-Data (ConvertTo-Json -InputObject $report -Depth 100)
    [System.IO.File]::WriteAllText($file, $json, [System.Text.UTF8Encoding]::new($false))
    Write-Host "Saved $file"
} finally {
    $client.Dispose()
    $token = $null
    $authValue = $null
    $secureToken.Dispose()
}
