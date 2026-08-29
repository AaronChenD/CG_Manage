# CG Vault JSON 版本地修复脚本
# 用途：从旧 PostgreSQL/Drizzle 版切换到本地 JSON 版时，清理旧缓存与旧数据库文件。

$ErrorActionPreference = "Stop"

Write-Host "CG Vault 本地 JSON 版修复开始..." -ForegroundColor Cyan

if (-not (Test-Path "package.json")) {
  Write-Host "请在项目根目录运行本脚本，也就是 package.json 所在目录。" -ForegroundColor Red
  exit 1
}

$pathsToRemove = @(
  ".next",
  ".turbo",
  "drizzle.config.json",
  "src\db\index.ts",
  "src\db\schema.ts"
)

foreach ($path in $pathsToRemove) {
  if (Test-Path $path) {
    Remove-Item $path -Recurse -Force
    Write-Host "已删除：$path" -ForegroundColor Green
  }
}

if (Test-Path "src\db") {
  $remaining = Get-ChildItem "src\db" -Force -ErrorAction SilentlyContinue
  if (-not $remaining) {
    Remove-Item "src\db" -Force
    Write-Host "已删除空目录：src\db" -ForegroundColor Green
  } else {
    Write-Host "src\db 目录仍有文件，请确认是否需要手动删除。" -ForegroundColor Yellow
  }
}

if (Test-Path ".env") {
  $envContent = Get-Content ".env" -ErrorAction SilentlyContinue
  $usefulLines = $envContent | Where-Object { $_.Trim() -ne "" -and -not $_.Trim().StartsWith("#") }
  $onlyDatabaseUrl = $usefulLines.Count -gt 0 -and (($usefulLines | Where-Object { $_ -notmatch "^DATABASE_URL=" }).Count -eq 0)
  if ($onlyDatabaseUrl) {
    Remove-Item ".env" -Force
    Write-Host "已删除仅包含 DATABASE_URL 的 .env；JSON 版不需要它。" -ForegroundColor Green
  } else {
    Write-Host ".env 中可能还有其他配置，已保留。JSON 版不需要 DATABASE_URL。" -ForegroundColor Yellow
  }
}

Write-Host "正在检查 src 中是否仍有数据库引用..." -ForegroundColor Cyan
$matches = @()
if (Test-Path "src") {
  $matches = Select-String -Path "src\*.ts", "src\*.tsx", "src\**\*.ts", "src\**\*.tsx" -Pattern "@/db", "DATABASE_URL", "drizzle-orm", "db\.execute", "postgres" -ErrorAction SilentlyContinue
}

if ($matches.Count -gt 0) {
  Write-Host "仍发现数据库相关引用，请根据下面位置删除旧代码：" -ForegroundColor Red
  $matches | ForEach-Object { Write-Host ("  {0}:{1}  {2}" -f $_.Path, $_.LineNumber, $_.Line.Trim()) -ForegroundColor Yellow }
  exit 2
}

Write-Host "源码检查通过：未发现数据库运行时引用。" -ForegroundColor Green
Write-Host "请继续运行：" -ForegroundColor Cyan
Write-Host "  npm install" -ForegroundColor White
Write-Host "  npm run dev" -ForegroundColor White
Write-Host "然后访问：http://localhost:3000" -ForegroundColor White
