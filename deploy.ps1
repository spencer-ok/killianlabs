$Region = 'us-east-1'
$BucketName = 'killianlabs-web'
$DistId = 'E2GYPDUE9XLK1K'

$tailExcludes = @(
  '--exclude', '.git/*',
  '--exclude', '*.ps1',
  '--exclude', '*.md',
  '--exclude', '.gitignore'
)

Write-Host 'Deploying killianlabs frontend to S3...' -ForegroundColor Cyan

# Pass 1: images & icons — 1-day cache
Write-Host '  (1/2) images & icons (1-day cache)...' -ForegroundColor DarkGray
aws s3 sync . "s3://$BucketName" --region $Region `
  --exclude '*' `
  --include '*.png' --include '*.ico' --include '*.jpg' --include '*.jpeg' `
  --include '*.svg' --include '*.webp' `
  @tailExcludes `
  --cache-control 'public, max-age=86400'

if ($LASTEXITCODE -ne 0) { Write-Host 'S3 sync (images) failed!' -ForegroundColor Red; exit 1 }

# Pass 2: html & code — no-cache so updates appear immediately
Write-Host '  (2/2) html (no-cache)...' -ForegroundColor DarkGray
aws s3 sync . "s3://$BucketName" --region $Region `
  --exclude '*.png' --exclude '*.ico' --exclude '*.jpg' --exclude '*.jpeg' `
  --exclude '*.svg' --exclude '*.webp' `
  @tailExcludes `
  --cache-control 'no-cache'

if ($LASTEXITCODE -ne 0) { Write-Host 'S3 sync (html) failed!' -ForegroundColor Red; exit 1 }

# Refresh Cache-Control metadata on index.html
aws s3 cp "s3://$BucketName/index.html" "s3://$BucketName/index.html" --region $Region `
  --metadata-directive REPLACE --cache-control 'no-cache' --content-type 'text/html' | Out-Null

# CloudFront invalidation
Write-Host "Invalidating CloudFront cache (Distribution: $DistId)..." -ForegroundColor Cyan
aws cloudfront create-invalidation --distribution-id $DistId --paths '/*' --region $Region | Out-Null

if ($LASTEXITCODE -eq 0) {
  Write-Host 'killianlabs.com deployed successfully!' -ForegroundColor Green
} else {
  Write-Host 'CloudFront invalidation failed!' -ForegroundColor Red
}
