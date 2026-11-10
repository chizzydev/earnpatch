param([switch]$Browser,[switch]$Postgres,[switch]$Container,[switch]$ReadOnlyProof)
$ErrorActionPreference='Stop'
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
 & npm.cmd ci --ignore-scripts --no-audit --no-fund
 if($LASTEXITCODE -ne 0){throw 'DEPENDENCY_INSTALL_FAILED'}
 foreach($gate in @('test','verify:package','test:https','test:wasm','verify')){
  if($gate -eq 'test'){& npm.cmd test}else{& npm.cmd run $gate}
  if($LASTEXITCODE -ne 0){throw ('LOCAL_GATE_FAILED: '+$gate)}
 }
 if($Browser){foreach($gate in @('test:browser','test:evaluation','test:acceptance','test:journey')){& npm.cmd run $gate;if($LASTEXITCODE -ne 0){throw ('BROWSER_GATE_FAILED: '+$gate)}}}
 if($Postgres){& npm.cmd run test:postgres;if($LASTEXITCODE -ne 0){throw 'REAL_POSTGRES_VERIFICATION_FAILED'}}else{Write-Output 'REAL_POSTGRES=NOT_REQUESTED'}
 if($Container){& npm.cmd run test:container;if($LASTEXITCODE -ne 0){throw 'LOCAL_CONTAINER_VERIFICATION_FAILED'}}else{Write-Output 'LOCAL_CONTAINER=NOT_REQUESTED'}
 if($ReadOnlyProof){& npm.cmd run verify:proof;if($LASTEXITCODE -ne 0){throw 'FINALIZED_REGISTRATION_READ_UNAVAILABLE_OR_INVALID'}}
 Write-Output 'REQUESTED_LOCAL_GATES=PASS; no blockchain mutation or hosting deployment'
 Write-Output 'PUBLIC_SHIP=REQUIRES_OWNER_PUBLICATION_AND_POST_PUSH_CLONE_VERIFICATION'
} finally {Pop-Location}
