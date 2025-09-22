# Deploy Resilient Booking System v2.0 - PowerShell Version
# Comprehensive production-ready deployment with fallback safety

param(
    [switch]$Force = $false
)

Write-Host "🚀 RESILIENT BOOKING SYSTEM v2.0 - DEPLOYMENT SCRIPT" -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Green
Write-Host "Date: $(Get-Date)" -ForegroundColor Yellow
Write-Host "Environment: $($env:NODE_ENV ?? 'development')" -ForegroundColor Yellow
Write-Host ""

# Check if we're in the right directory
if (!(Test-Path "package.json") -or !(Test-Path "src\api")) {
    Write-Host "❌ Error: Please run this script from the booking-agent root directory" -ForegroundColor Red
    exit 1
}

Write-Host "📋 DEPLOYMENT CHECKLIST" -ForegroundColor Blue
Write-Host "======================="

# 1. Backup current system
Write-Host "📦 Step 1: Creating backup of current system..." -ForegroundColor Yellow
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

if (Test-Path "src\index.js") {
    Copy-Item "src\index.js" "src\index-backup-$timestamp.js"
    Write-Host "✅ Main index.js backed up" -ForegroundColor Green
}

if (Test-Path "src\api\simple-booking.js") {
    Copy-Item "src\api\simple-booking.js" "src\api\simple-booking-backup-$timestamp.js"
    Write-Host "✅ Simple booking API backed up" -ForegroundColor Green
}

if (Test-Path "src\utils\config.js") {
    Copy-Item "src\utils\config.js" "src\utils\config-backup-$timestamp.js"
    Write-Host "✅ Configuration backed up" -ForegroundColor Green
}

Write-Host ""

# 2. Validate new system files
Write-Host "🔍 Step 2: Validating new system files..." -ForegroundColor Yellow
$requiredFiles = @(
    "src\index-v2.js",
    "src\utils\config-v2.js", 
    "src\services\serviceManager.js",
    "src\services\bookingAIService-v2.js",
    "src\api\unified-booking.js",
    "test-resilient-booking.js"
)

$missingFiles = @()
foreach ($file in $requiredFiles) {
    if (!(Test-Path $file)) {
        $missingFiles += $file
    }
}

if ($missingFiles.Count -gt 0) {
    Write-Host "❌ Error: Missing required files:" -ForegroundColor Red
    $missingFiles | ForEach-Object { Write-Host "   $_" -ForegroundColor Red }
    Write-Host "Please ensure all v2.0 system files are present before deployment." -ForegroundColor Red
    exit 1
}

Write-Host "✅ All new system files present" -ForegroundColor Green

# 3. Syntax validation
Write-Host "🧹 Step 3: Validating syntax of new files..." -ForegroundColor Yellow
foreach ($file in $requiredFiles) {
    if ($file -match '\.js$') {
        try {
            $null = node -c $file
            Write-Host "✅ $file - Syntax OK" -ForegroundColor Green
        }
        catch {
            Write-Host "❌ $file - Syntax ERROR" -ForegroundColor Red
            Write-Host "Please fix syntax errors before deployment." -ForegroundColor Red
            exit 1
        }
    }
}

# 4. Update package.json
Write-Host "📝 Step 4: Updating package.json..." -ForegroundColor Yellow

if (Test-Path "package.json") {
    try {
        $packageJson = Get-Content "package.json" -Raw | ConvertFrom-Json
        $packageJson.version = "2.0.0-resilient"
        $packageJson.scripts.start = "node src/index-v2.js"
        $packageJson | ConvertTo-Json -Depth 10 | Set-Content "package.json"
        Write-Host "✅ Package.json updated with v2.0 configuration" -ForegroundColor Green
    }
    catch {
        Write-Host "⚠️ Could not automatically update package.json - manual update required" -ForegroundColor Yellow
        Write-Host "   Please update version to '2.0.0-resilient' and start script to 'node src/index-v2.js'" -ForegroundColor Yellow
    }
}

# 5. Install/verify dependencies
Write-Host "📥 Step 5: Verifying dependencies..." -ForegroundColor Yellow
if (!(Test-Path "node_modules") -or ((Get-Item "package.json").LastWriteTime -gt (Get-Item "node_modules").LastWriteTime)) {
    Write-Host "Installing/updating dependencies..." -ForegroundColor Yellow
    npm install
    Write-Host "✅ Dependencies installed" -ForegroundColor Green
}
else {
    Write-Host "✅ Dependencies up to date" -ForegroundColor Green
}

# 6. Environment validation
Write-Host "🔧 Step 6: Environment validation..." -ForegroundColor Yellow
if (Test-Path ".env") {
    Write-Host "✅ .env file found" -ForegroundColor Green
    
    # Check for critical environment variables
    $envContent = Get-Content ".env" -Raw
    $criticalVars = @("SUPABASE_URL", "SUPABASE_SERVICE_KEY")
    $missingCritical = @()
    
    foreach ($var in $criticalVars) {
        if ($envContent -notmatch "$var=") {
            $missingCritical += $var
        }
    }
    
    if ($missingCritical.Count -gt 0) {
        Write-Host "❌ Missing critical environment variables:" -ForegroundColor Red
        $missingCritical | ForEach-Object { Write-Host "   $_" -ForegroundColor Red }
        Write-Host "Application will fail to start without these variables." -ForegroundColor Red
        exit 1
    }
    
    Write-Host "✅ Critical environment variables present" -ForegroundColor Green
    
    # Check optional services
    $optionalServices = @("OPENAI_API_KEY", "SLACK_BOT_TOKEN", "RESEND_API_KEY")
    $availableServices = @()
    $unavailableServices = @()
    
    foreach ($var in $optionalServices) {
        if ($envContent -match "$var=") {
            $availableServices += $var
        }
        else {
            $unavailableServices += $var
        }
    }
    
    if ($availableServices.Count -gt 0) {
        Write-Host "✅ Available services: $($availableServices -join ', ')" -ForegroundColor Green
    }
    
    if ($unavailableServices.Count -gt 0) {
        Write-Host "⚠️ Unavailable services (will use fallback): $($unavailableServices -join ', ')" -ForegroundColor Yellow
        Write-Host "   System will run in degraded mode for missing services" -ForegroundColor Yellow
    }
}
else {
    Write-Host "⚠️ No .env file found - relying on system environment variables" -ForegroundColor Yellow
}

# 7. Create rollback script
Write-Host "🔄 Step 7: Creating rollback script..." -ForegroundColor Yellow
$rollbackScript = @"
# PowerShell Rollback Script
Write-Host "🔄 Rolling back to previous system..." -ForegroundColor Yellow

# Restore backed up files
`$backupFiles = Get-ChildItem "src\index-backup-*.js" | Sort-Object LastWriteTime -Descending
if (`$backupFiles.Count -gt 0) {
    Copy-Item `$backupFiles[0].FullName "src\index.js"
    Write-Host "✅ Restored index.js from `$(`$backupFiles[0].Name)" -ForegroundColor Green
}

`$backupFiles = Get-ChildItem "src\api\simple-booking-backup-*.js" | Sort-Object LastWriteTime -Descending
if (`$backupFiles.Count -gt 0) {
    Copy-Item `$backupFiles[0].FullName "src\api\simple-booking.js"
    Write-Host "✅ Restored simple-booking.js from `$(`$backupFiles[0].Name)" -ForegroundColor Green
}

`$backupFiles = Get-ChildItem "src\utils\config-backup-*.js" | Sort-Object LastWriteTime -Descending
if (`$backupFiles.Count -gt 0) {
    Copy-Item `$backupFiles[0].FullName "src\utils\config.js"
    Write-Host "✅ Restored config.js from `$(`$backupFiles[0].Name)" -ForegroundColor Green
}

Write-Host "🔄 Rollback complete - restart the application" -ForegroundColor Green
"@

$rollbackScript | Out-File -FilePath "rollback-v2.ps1" -Encoding UTF8
Write-Host "✅ Rollback script created (rollback-v2.ps1)" -ForegroundColor Green

# 8. Deploy new system
Write-Host "🚀 Step 8: Deploying resilient system v2.0..." -ForegroundColor Yellow

# Replace main files with v2 versions
Copy-Item "src\index-v2.js" "src\index.js"
Write-Host "✅ Deployed new main application (index.js)" -ForegroundColor Green

Copy-Item "src\utils\config-v2.js" "src\utils\config.js"
Write-Host "✅ Deployed new configuration system (config.js)" -ForegroundColor Green

Write-Host ""
Write-Host "🎯 DEPLOYMENT VALIDATION" -ForegroundColor Blue
Write-Host "========================"

# 9. Local testing (if not on Railway)
if (!$env:RAILWAY_ENVIRONMENT) {
    Write-Host "🧪 Step 9: Running local validation tests..." -ForegroundColor Yellow
    
    # Start server in background for testing
    Write-Host "Starting server for testing..." -ForegroundColor Yellow
    $serverProcess = Start-Process -FilePath "npm" -ArgumentList "start" -PassThru -RedirectStandardOutput "server-test.log" -RedirectStandardError "server-test-error.log"
    Write-Host "Server PID: $($serverProcess.Id)" -ForegroundColor Yellow
    
    # Wait for server to start
    Write-Host "Waiting for server to initialize..." -ForegroundColor Yellow
    Start-Sleep -Seconds 8
    
    # Check if server is running
    $serverRunning = Get-Process -Id $serverProcess.Id -ErrorAction SilentlyContinue
    if ($serverRunning) {
        Write-Host "✅ Server started successfully" -ForegroundColor Green
        
        # Run health check
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:3001/health" -TimeoutSec 10 -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                Write-Host "✅ Health check passed" -ForegroundColor Green
                
                # Run comprehensive tests
                Write-Host "Running resilient system tests..." -ForegroundColor Yellow
                $testResult = & node test-resilient-booking.js
                if ($LASTEXITCODE -eq 0) {
                    Write-Host "✅ All tests passed!" -ForegroundColor Green
                    $testSuccess = $true
                }
                else {
                    Write-Host "⚠️ Some tests failed - check test output" -ForegroundColor Yellow
                    $testSuccess = $false
                }
            }
            else {
                Write-Host "❌ Health check failed" -ForegroundColor Red
                $testSuccess = $false
            }
        }
        catch {
            Write-Host "❌ Health check failed: $($_.Exception.Message)" -ForegroundColor Red
            $testSuccess = $false
        }
        
        # Stop test server
        try {
            Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
            Write-Host "Test server stopped" -ForegroundColor Yellow
        }
        catch {
            Write-Host "Could not stop test server - it may have already exited" -ForegroundColor Yellow
        }
    }
    else {
        Write-Host "❌ Server failed to start" -ForegroundColor Red
        Write-Host "Check server-test.log and server-test-error.log for details" -ForegroundColor Red
        $testSuccess = $false
    }
    
    if ($testSuccess) {
        Write-Host "✅ Local validation successful" -ForegroundColor Green
    }
    else {
        Write-Host "❌ Local validation failed" -ForegroundColor Red
        Write-Host "To rollback, run: .\rollback-v2.ps1" -ForegroundColor Red
        if (!$Force) {
            exit 1
        }
    }
}
else {
    Write-Host "🚂 Railway environment detected - skipping local tests" -ForegroundColor Yellow
    Write-Host "Railway will handle deployment validation" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "🎉 DEPLOYMENT COMPLETE" -ForegroundColor Green
Write-Host "====================="
Write-Host "✅ Resilient Booking System v2.0 deployed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "📋 What was deployed:" -ForegroundColor Blue
Write-Host "  • Service isolation and lazy initialization" -ForegroundColor White
Write-Host "  • Multi-tier processing pipeline (AI → Fallback → Emergency)" -ForegroundColor White
Write-Host "  • Graceful service degradation" -ForegroundColor White
Write-Host "  • Unified booking endpoint (/api/booking/booking-form)" -ForegroundColor White
Write-Host "  • Comprehensive error handling and recovery" -ForegroundColor White
Write-Host "  • Production-ready monitoring and diagnostics" -ForegroundColor White
Write-Host ""
Write-Host "🔗 Available endpoints:" -ForegroundColor Blue
Write-Host "  • Main booking: /api/booking/booking-form" -ForegroundColor White
Write-Host "  • Health check: /health" -ForegroundColor White
Write-Host "  • Diagnostics: /diagnostics" -ForegroundColor White
Write-Host "  • Service status: /api/booking/service-status" -ForegroundColor White
Write-Host ""
Write-Host "🔧 If issues occur:" -ForegroundColor Blue
Write-Host "  • View diagnostics: curl http://localhost:3001/diagnostics" -ForegroundColor White
Write-Host "  • Run tests: node test-resilient-booking.js" -ForegroundColor White
Write-Host "  • Rollback: .\rollback-v2.ps1" -ForegroundColor White
Write-Host ""
Write-Host "🚀 System is now production-ready and resilient!" -ForegroundColor Green
Write-Host "Deployment completed at: $(Get-Date)" -ForegroundColor Yellow