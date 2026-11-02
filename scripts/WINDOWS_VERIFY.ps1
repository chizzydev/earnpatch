param([switch]$Browser)
$ErrorActionPreference='Stop'
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
 & npm.cmd ci --ignore-scripts --no-audit --no-fund
 if($LASTEXITCODE -ne 0){throw 'DEPENDENCY_INSTALL_FAILED'}
 & npm.cmd test
 if($LASTEXITCODE -ne 0){throw 'SOURCE_TESTS_FAILED'}
 & npm.cmd run test:https
 if($LASTEXITCODE -ne 0){throw 'HTTPS_TEST_FAILED'}
 & npm.cmd run test:wasm
 if($LASTEXITCODE -ne 0){throw 'COMPILED_WASM_HOST_FAILED'}
 & npm.cmd run verify
 if($LASTEXITCODE -ne 0){throw 'SOURCE_SECURITY_OR_INTEGRITY_FAILED'}
 if($Browser){& npm.cmd run test:browser;if($LASTEXITCODE -ne 0){throw 'BROWSER_TEST_FAILED'}}
 Write-Output 'RELEASE_VERIFICATION=PASS; no blockchain mutation or hosting deployment'
} finally {Pop-Location}
