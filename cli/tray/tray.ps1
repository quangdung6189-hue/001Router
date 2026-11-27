param(
  [int]$ServerPid = 0,
  [string]$DashboardUrl = "http://127.0.0.1:20128",
  [string]$IconPath = "",
  [string]$CliTokenFile = ""
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Get-CliToken {
  if ($CliTokenFile -and (Test-Path -LiteralPath $CliTokenFile)) {
    try {
      return (Get-Content -LiteralPath $CliTokenFile -Raw).Trim()
    } catch {
      return ""
    }
  }
  return ""
}

function Invoke-RouterShutdown {
  $token = Get-CliToken
  $headers = @{}
  if ($token) {
    $headers["X-001R-CLI-Token"] = $token
  }
  try {
    Invoke-RestMethod -Uri "$DashboardUrl/api/version/shutdown" -Method POST -Headers $headers -TimeoutSec 3 | Out-Null
  } catch {
    # Server may already be exiting
  }
}

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Text = "001Router AI Gateway"
$notifyIcon.Visible = $true

if ($IconPath -and (Test-Path -LiteralPath $IconPath)) {
  try {
    $notifyIcon.Icon = New-Object System.Drawing.Icon($IconPath)
  } catch {
    $notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
  }
} else {
  $notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
}

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$openItem = New-Object System.Windows.Forms.ToolStripMenuItem("Open 001Router Dashboard")
$openItem.Add_Click({
  try { Start-Process $DashboardUrl } catch {}
})
$menu.Items.Add($openItem) | Out-Null

$endpointItem = New-Object System.Windows.Forms.ToolStripMenuItem("Show Local Endpoint")
$endpointItem.Add_Click({
  $notifyIcon.ShowBalloonTip(2500, "001Router", "API Base URL: $DashboardUrl/v1", [System.Windows.Forms.ToolTipIcon]::Info)
})
$menu.Items.Add($endpointItem) | Out-Null

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$stopItem = New-Object System.Windows.Forms.ToolStripMenuItem("Stop 001Router & Exit")
$stopItem.Add_Click({
  Invoke-RouterShutdown
  $notifyIcon.Visible = $false
  $notifyIcon.Dispose()
  [System.Windows.Forms.Application]::Exit()
})
$menu.Items.Add($stopItem) | Out-Null

$notifyIcon.ContextMenuStrip = $menu
$notifyIcon.Add_DoubleClick({
  try { Start-Process $DashboardUrl } catch {}
})

if ($ServerPid -gt 0) {
  $watchdog = New-Object System.Windows.Forms.Timer
  $watchdog.Interval = 2500
  $watchdog.Add_Tick({
    $proc = Get-Process -Id $ServerPid -ErrorAction SilentlyContinue
    if (-not $proc) {
      $watchdog.Stop()
      $notifyIcon.Visible = $false
      $notifyIcon.Dispose()
      [System.Windows.Forms.Application]::Exit()
    }
  })
  $watchdog.Start()
}

[System.Windows.Forms.Application]::Run()
