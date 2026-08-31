[CmdletBinding()]
param(
    [string]$ResultPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$endpoint = [Uri]'https://sandybrown-wolf-559614.hostingersite.com/api/internal/readiness'
$operationId = [Guid]::NewGuid().ToString('N')
$startedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
$secureToken = $null
$tokenPointer = [IntPtr]::Zero
$plainToken = $null
$authorizationHeader = $null
$request = $null
$response = $null
$finalStateWritten = $false
$exitCode = 0

function Write-SafeProbeState {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('waiting_for_input', 'completed', 'validation_error', 'transport_error')]
        [string]$State,

        [AllowNull()]
        [Nullable[int]]$HttpStatus = $null,

        [AllowNull()]
        [string]$ReportedStatus = $null,

        [AllowNull()]
        [string]$CorrelationId = $null
    )

    if ([string]::IsNullOrWhiteSpace($ResultPath)) {
        return
    }

    $safeReportedStatus = $null
    if (@('ready', 'unavailable', 'not_found', 'ok') -contains $ReportedStatus) {
        $safeReportedStatus = $ReportedStatus
    }

    $safeCorrelationId = $null
    if (
        -not [string]::IsNullOrWhiteSpace($CorrelationId) -and
        [System.Text.RegularExpressions.Regex]::IsMatch(
            $CorrelationId,
            '\A[A-Za-z0-9._:-]{1,128}\z',
            [System.Text.RegularExpressions.RegexOptions]::CultureInvariant
        )
    ) {
        $safeCorrelationId = $CorrelationId
    }

    $completedAtUtc = $null
    if ($State -ne 'waiting_for_input') {
        $completedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
    }

    $safeResult = [ordered]@{
        state = $State
        httpStatus = $HttpStatus
        reportedStatus = $safeReportedStatus
        correlationId = $safeCorrelationId
        startedAtUtc = $startedAtUtc
        completedAtUtc = $completedAtUtc
        operationId = $operationId
    }

    $fullResultPath = [System.IO.Path]::GetFullPath($ResultPath)
    $resultDirectory = [System.IO.Path]::GetDirectoryName($fullResultPath)
    [System.IO.Directory]::CreateDirectory($resultDirectory) | Out-Null

    $temporaryPath = '{0}.{1}.{2}.tmp' -f $fullResultPath, $PID, $operationId
    $utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)

    try {
        $resultJson = $safeResult | ConvertTo-Json -Compress
        [System.IO.File]::WriteAllText($temporaryPath, $resultJson, $utf8WithoutBom)

        if ([System.IO.File]::Exists($fullResultPath)) {
            try {
                [System.IO.File]::Replace($temporaryPath, $fullResultPath, $null)
            }
            catch {
                # Some Windows file-system providers do not support File.Replace.
                # Copying with overwrite keeps the safe schema and avoids leaving
                # the probe permanently in waiting_for_input.
                [System.IO.File]::Copy($temporaryPath, $fullResultPath, $true)
                [System.IO.File]::Delete($temporaryPath)
            }
        }
        else {
            [System.IO.File]::Move($temporaryPath, $fullResultPath)
        }
    }
    finally {
        if ([System.IO.File]::Exists($temporaryPath)) {
            [System.IO.File]::Delete($temporaryPath)
        }
    }
}

function Get-SafeProbeResponse {
    param(
        [Parameter(Mandatory = $true)]
        [System.Net.HttpWebResponse]$HttpResponse
    )

    $reader = $null
    $reportedStatus = $null

    try {
        $reader = New-Object System.IO.StreamReader($HttpResponse.GetResponseStream())
        $body = $reader.ReadToEnd()

        try {
            $parsedBody = $body | ConvertFrom-Json -ErrorAction Stop
            $statusProperty = $parsedBody.PSObject.Properties['status']
            if ($null -ne $statusProperty) {
                $candidateStatus = [string]$statusProperty.Value
                if (@('ready', 'unavailable', 'not_found', 'ok') -contains $candidateStatus) {
                    $reportedStatus = $candidateStatus
                }
            }
        }
        catch {
            $reportedStatus = $null
        }
    }
    finally {
        if ($null -ne $reader) {
            $reader.Dispose()
        }
    }

    $correlationId = $HttpResponse.Headers['x-correlation-id']
    if (
        [string]::IsNullOrWhiteSpace($correlationId) -or
        -not [System.Text.RegularExpressions.Regex]::IsMatch(
            $correlationId,
            '\A[A-Za-z0-9._:-]{1,128}\z',
            [System.Text.RegularExpressions.RegexOptions]::CultureInvariant
        )
    ) {
        $correlationId = $null
    }

    return [pscustomobject]@{
        HttpStatus = [int]$HttpResponse.StatusCode
        ReportedStatus = $reportedStatus
        CorrelationId = $correlationId
    }
}

try {
    Write-SafeProbeState -State 'waiting_for_input'

    $secureToken = Read-Host 'Enter READINESS_BEARER_TOKEN (exactly 16 ASCII alphanumeric characters; input is hidden)' -AsSecureString
    $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    $plainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)

    $isTokenValid = (
        $null -ne $plainToken -and
        $plainToken.Length -eq 16 -and
        [System.Text.RegularExpressions.Regex]::IsMatch(
            $plainToken,
            '\A[A-Za-z0-9]{16}\z',
            [System.Text.RegularExpressions.RegexOptions]::CultureInvariant
        )
    )

    if (-not $isTokenValid) {
        Write-SafeProbeState -State 'validation_error'
        $finalStateWritten = $true
        $exitCode = 2
        Write-Host 'Token validation failed. Use exactly 16 characters from A-Z, a-z, or 0-9.' -ForegroundColor Yellow
    }
    else {
        $authorizationHeader = 'Bearer ' + $plainToken
        $request = [System.Net.HttpWebRequest]::Create($endpoint)
        $request.Method = 'GET'
        $request.Timeout = 20000
        $request.ReadWriteTimeout = 20000
        $request.AllowAutoRedirect = $false
        $request.Headers[[System.Net.HttpRequestHeader]::Authorization] = $authorizationHeader

        try {
            $response = [System.Net.HttpWebResponse]$request.GetResponse()
        }
        catch [System.Net.WebException] {
            if ($null -eq $_.Exception.Response) {
                throw
            }

            $response = [System.Net.HttpWebResponse]$_.Exception.Response
        }

        $safeResponse = Get-SafeProbeResponse -HttpResponse $response
        Write-SafeProbeState `
            -State 'completed' `
            -HttpStatus $safeResponse.HttpStatus `
            -ReportedStatus $safeResponse.ReportedStatus `
            -CorrelationId $safeResponse.CorrelationId
        $finalStateWritten = $true

        Write-Host ('HTTP {0}' -f $safeResponse.HttpStatus)
        if ($null -eq $safeResponse.ReportedStatus) {
            Write-Host 'Status: unknown'
        }
        else {
            Write-Host ('Status: {0}' -f $safeResponse.ReportedStatus)
        }

        if ($null -eq $safeResponse.CorrelationId) {
            Write-Host 'Correlation-ID: unavailable'
        }
        else {
            Write-Host ('Correlation-ID: {0}' -f $safeResponse.CorrelationId)
        }
    }
}
catch {
    if (-not $finalStateWritten) {
        try {
            Write-SafeProbeState -State 'transport_error'
        }
        catch {
            # Do not expose raw file-system or transport errors in interactive output.
        }
    }

    $exitCode = 1
    Write-Host 'Readiness probe failed before a safe HTTP result was received.' -ForegroundColor Red
}
finally {
    if ($null -ne $response) {
        $response.Dispose()
    }

    if ($null -ne $request) {
        $request.Abort()
    }

    $authorizationHeader = $null
    $plainToken = $null

    if ($tokenPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
        $tokenPointer = [IntPtr]::Zero
    }

    if ($null -ne $secureToken) {
        $secureToken.Dispose()
    }
}

if ($exitCode -ne 0) {
    exit $exitCode
}
