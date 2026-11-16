param([Parameter(Mandatory=$true)][string]$Payload)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class DshPetMouse {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
}
public static class DshPetWindow {
  public sealed class WindowInfo {
    public IntPtr Handle;
    public int ProcessId;
    public string Title;
    public string ClassName;
    public bool Visible;
    public bool Minimized;
    public bool Cloaked;
    public bool ToolWindow;
    public bool AppWindow;
    public bool Owned;
    public int Width;
    public int Height;
  }
  [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left, Top, Right, Bottom; }
  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr hWnd, uint command);
  [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr hWnd, int index);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out int value, int size);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);

  public static WindowInfo[] ListProcessWindows(int processId) {
    var result = new List<WindowInfo>();
    EnumWindows((hWnd, _) => {
      uint pid;
      GetWindowThreadProcessId(hWnd, out pid);
      if (pid != (uint)processId) return true;
      var titleBuffer = new StringBuilder(Math.Max(2, GetWindowTextLength(hWnd) + 1));
      GetWindowText(hWnd, titleBuffer, titleBuffer.Capacity);
      var classBuffer = new StringBuilder(256);
      GetClassName(hWnd, classBuffer, classBuffer.Capacity);
      RECT rect;
      var hasRect = GetWindowRect(hWnd, out rect);
      var exStyle = GetWindowLong(hWnd, -20);
      var cloaked = 0;
      try { DwmGetWindowAttribute(hWnd, 14, out cloaked, sizeof(int)); } catch { cloaked = 0; }
      result.Add(new WindowInfo {
        Handle = hWnd,
        ProcessId = processId,
        Title = titleBuffer.ToString(),
        ClassName = classBuffer.ToString(),
        Visible = IsWindowVisible(hWnd),
        Minimized = IsIconic(hWnd),
        Cloaked = cloaked != 0,
        ToolWindow = (exStyle & 0x80) != 0,
        AppWindow = (exStyle & 0x40000) != 0,
        Owned = GetWindow(hWnd, 4) != IntPtr.Zero,
        Width = hasRect ? Math.Max(0, rect.Right - rect.Left) : 0,
        Height = hasRect ? Math.Max(0, rect.Bottom - rect.Top) : 0
      });
      return true;
    }, IntPtr.Zero);
    return result.ToArray();
  }
}
'@

function Write-JsonLine([hashtable]$value) {
  [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress -Depth 6))
  [Console]::Out.Flush()
}
function Progress([string]$stage, [hashtable]$extra = @{}) {
  $value = @{ type = 'progress'; stage = $stage }
  foreach ($item in $extra.GetEnumerator()) { $value[$item.Key] = $item.Value }
  Write-JsonLine $value
}
function Result([bool]$ok, [string]$message, $data = $null) {
  $value = @{ type = 'result'; ok = $ok; message = $message }
  if ($null -ne $data) { $value.data = $data }
  Write-JsonLine $value
}
function Complete-Action([string]$message, $data = $null) {
  Progress 'returning'
  Progress 'completed'
  Result $true $message $data
}
function Cursor {
  $p = New-Object DshPetMouse+POINT
  [void][DshPetMouse]::GetCursorPos([ref]$p)
  return @{ X = $p.X; Y = $p.Y }
}
function Ensure-Point([int]$x, [int]$y) {
  $screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
  if ($x -lt $screen.Left -or $x -ge $screen.Right -or $y -lt $screen.Top -or $y -ge $screen.Bottom) {
    throw "Point is outside the virtual desktop: $x,$y"
  }
}
function Ensure-NotCancelled {
  if ($script:CancelPath -and (Test-Path -LiteralPath $script:CancelPath)) { throw 'Cancelled by request' }
  if (([DshPetMouse]::GetAsyncKeyState(0x1B) -band 0x8000) -ne 0) { throw 'Cancelled by Escape' }
}
function Announce-Approach([string]$action) {
  $p = Cursor
  Progress 'approaching-pointer' @{ pointer = @{ x = $p.X; y = $p.Y }; action = $action }
  Start-Sleep -Milliseconds 100
  Ensure-NotCancelled
}
function Move-Cute([int]$x, [int]$y, [int]$duration = 0, [string]$action = 'move') {
  Ensure-Point $x $y
  $start = Cursor
  $lastX = $start.X; $lastY = $start.Y
  $dx = $x - $start.X; $dy = $y - $start.Y
  $distance = [Math]::Sqrt($dx * $dx + $dy * $dy)
  # 固定 360ms 会让跨屏操作像瞬移。默认时长按距离增长：近处约半秒，跨屏约 1.5~1.8 秒；
  # 拖拽略快一点，避免按住鼠标时显得迟钝，但仍保留明显的“桌宠拖着走”节奏。
  if ($duration -le 0) {
    $base = if ($action -eq 'drag') { 520.0 } else { 480.0 }
    $perPixel = if ($action -eq 'drag') { 0.95 } else { 1.10 }
    $minimum = if ($action -eq 'drag') { 560 } else { 520 }
    $duration = [int][Math]::Round([Math]::Max($minimum, [Math]::Min(1800, $base + $distance * $perPixel)))
  }
  # 约 40~55 FPS 的小步进既平滑，也不会因进度事件过密拖慢主进程。
  $steps = [Math]::Max(18, [Math]::Min(72, [int][Math]::Ceiling($duration / 20.0)))
  for ($i = 1; $i -le $steps; $i++) {
    Ensure-NotCancelled
    $now = Cursor
    if ([Math]::Abs($now.X - $lastX) -gt 18 -or [Math]::Abs($now.Y - $lastY) -gt 18) {
      throw 'Cancelled because the user moved the pointer'
    }
    $t = $i / [double]$steps
    $ease = if ($t -lt 0.5) { 4 * $t * $t * $t } else { 1 - [Math]::Pow(-2 * $t + 2, 3) / 2 }
    $lastX = [int][Math]::Round($start.X + ($x - $start.X) * $ease)
    $lastY = [int][Math]::Round($start.Y + ($y - $start.Y) * $ease)
    [void][DshPetMouse]::SetCursorPos($lastX, $lastY)
    Progress 'carrying-pointer' @{
      pointer = @{ x = $lastX; y = $lastY }
      target = @{ x = $x; y = $y }
      progress = [Math]::Round($t, 4)
      durationMs = $duration
      action = $action
    }
    Start-Sleep -Milliseconds ([Math]::Max(5, [int]($duration / $steps)))
  }
}
function Active-Root {
  $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
  if ($null -eq $focused) { throw 'No active window was found' }
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $node = $focused
  while ($true) {
    $parent = $walker.GetParent($node)
    if ($null -eq $parent -or $parent -eq [System.Windows.Automation.AutomationElement]::RootElement) { return $node }
    $node = $parent
  }
}
function Target-Element([string]$name) {
  $root = Active-Root
  $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)
  $items = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
  if ($items.Count -eq 0) { throw "No control named '$name' was found in the active window" }
  if ($items.Count -gt 1) { throw "The active window has $($items.Count) controls named '$name'" }
  return $items[0]
}
function Target-EditableElement([string]$name) {
  $root = Active-Root
  try {
    $exact = Target-Element $name
    $exactPattern = $null
    if ($exact.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$exactPattern) -and -not $exactPattern.Current.IsReadOnly) {
      return @{ Element = $exact; Pattern = $exactPattern }
    }
  } catch {}
  $available = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::IsValuePatternAvailableProperty, $true)
  $items = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $available)
  $candidates = @()
  foreach ($item in $items) {
    try {
      $pattern = $null
      if ($item.Current.IsEnabled -and $item.Current.IsKeyboardFocusable -and
          $item.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern) -and
          -not $pattern.Current.IsReadOnly) {
        $candidates += ,@{ Element = $item; Pattern = $pattern }
      }
    } catch {}
  }
  if ($candidates.Count -eq 1) { return $candidates[0] }
  $preferred = @($candidates | Where-Object {
    $_.Element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Document -or
    $_.Element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit
  })
  if ($preferred.Count -eq 1) { return $preferred[0] }
  if ($candidates.Count -eq 0) { throw "No editable control was found in the active window" }
  throw "The active window has $($candidates.Count) editable controls"
}
function Element-Center($element) {
  $rect = $element.Current.BoundingRectangle
  if ($rect.IsEmpty -or $rect.Width -le 0 -or $rect.Height -le 0) { throw "Control is not visible" }
  return @{ X = [int]($rect.Left + $rect.Width / 2); Y = [int]($rect.Top + $rect.Height / 2) }
}
function Target-Center([string]$name) { return Element-Center (Target-Element $name) }
function Mouse-Down { [DshPetMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero) }
function Mouse-Up { [DshPetMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero) }
function Right-Down { [DshPetMouse]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero) }
function Right-Up { [DshPetMouse]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero) }
function Click-At([int]$x, [int]$y, [string]$kind) {
  Announce-Approach $kind
  Move-Cute $x $y 0 $kind
  Progress 'committing' @{ action = $kind; pointer = @{ x = $x; y = $y } }
  if ($kind -eq 'right_click') {
    Right-Down; Start-Sleep -Milliseconds 70; Right-Up
  } else {
    $count = if ($kind -eq 'double_click') { 2 } else { 1 }
    for ($i = 0; $i -lt $count; $i++) {
      Mouse-Down; Start-Sleep -Milliseconds 55; Mouse-Up
      if ($i + 1 -lt $count) { Start-Sleep -Milliseconds 90 }
    }
  }
}
function Focus-Window([IntPtr]$handle) {
  if ($handle -eq [IntPtr]::Zero) { return $false }
  [void][DshPetWindow]::ShowWindowAsync($handle, 9)
  $foreground = [DshPetWindow]::GetForegroundWindow()
  $foregroundThread = [DshPetWindow]::GetWindowThreadProcessId($foreground, [IntPtr]::Zero)
  $targetThread = [DshPetWindow]::GetWindowThreadProcessId($handle, [IntPtr]::Zero)
  $currentThread = [DshPetWindow]::GetCurrentThreadId()
  $attachedForeground = $false
  $attachedTarget = $false
  try {
    if ($foregroundThread -ne 0 -and $foregroundThread -ne $currentThread) {
      $attachedForeground = [DshPetWindow]::AttachThreadInput($currentThread, $foregroundThread, $true)
    }
    if ($targetThread -ne 0 -and $targetThread -ne $currentThread -and $targetThread -ne $foregroundThread) {
      $attachedTarget = [DshPetWindow]::AttachThreadInput($currentThread, $targetThread, $true)
    }
    [void][DshPetWindow]::BringWindowToTop($handle)
    [void][DshPetWindow]::SetForegroundWindow($handle)
  } finally {
    if ($attachedTarget) { [void][DshPetWindow]::AttachThreadInput($currentThread, $targetThread, $false) }
    if ($attachedForeground) { [void][DshPetWindow]::AttachThreadInput($currentThread, $foregroundThread, $false) }
  }
  Start-Sleep -Milliseconds 220
  return [DshPetWindow]::GetForegroundWindow() -eq $handle
}
function Find-AppWindow([string[]]$names, [System.Diagnostics.Process]$started = $null, [int]$timeoutMs = 5000) {
  $deadline = [DateTime]::UtcNow.AddMilliseconds($timeoutMs)
  do {
    if ($null -ne $started) {
      try { $started.Refresh(); if ($started.MainWindowHandle -ne 0) { return [IntPtr]$started.MainWindowHandle } } catch {}
    }
    foreach ($name in $names) {
      $candidate = Get-Process -Name $name -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } |
        Sort-Object StartTime -Descending |
        Select-Object -First 1
      if ($null -ne $candidate) { return [IntPtr]$candidate.MainWindowHandle }
    }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  return [IntPtr]::Zero
}
function Focus-App([string]$app, [System.Diagnostics.Process]$started = $null) {
  $processes = @{
    notepad=@('Notepad'); calculator=@('CalculatorApp','Calculator'); explorer=@('explorer');
    paint=@('mspaint'); settings=@('SystemSettings');
    browser=@('msedge','chrome','firefox','brave'); wechat=@('Weixin','WeChat'); qq=@('QQ','QQNT')
  }
  $names = $processes[$app]
  if (-not $names) { throw 'Application focus target is not allowlisted' }
  $handle = Find-AppWindow $names $started
  if ($handle -ne [IntPtr]::Zero) { return Focus-Window $handle }
  $running = @($names | ForEach-Object { Get-Process -Name $_ -ErrorAction SilentlyContinue } | Sort-Object Id -Unique)
  $candidate = Find-RestorableAppWindow $running $app
  if ($null -ne $candidate -and (Focus-Window ([IntPtr]$candidate.Window.Handle))) { return $true }
  foreach ($name in $names) {
    $restored = Restore-HiddenApp ([string]$name)
    if ($restored -ne [IntPtr]::Zero) { return $true }
  }
  return $false
}
function Focus-WindowByTitle([string]$title) {
  $candidate = Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$title*" } |
    Sort-Object StartTime -Descending |
    Select-Object -First 1
  return $null -ne $candidate -and (Focus-Window ([IntPtr]$candidate.MainWindowHandle))
}
function Get-RegisteredAppProcesses([string]$appId, [string]$processName) {
  $items = @()
  if ($appId -and [IO.Path]::IsPathRooted($appId)) {
    $fullPath = [IO.Path]::GetFullPath($appId)
    $items = @(Get-Process -Name $processName -ErrorAction SilentlyContinue | Where-Object {
      try { [string]::Equals([IO.Path]::GetFullPath($_.Path), $fullPath, [StringComparison]::OrdinalIgnoreCase) } catch { $false }
    })
  } elseif ($processName) {
    $items = @(Get-Process -Name $processName -ErrorAction SilentlyContinue)
  }
  return @($items | Sort-Object Id -Unique)
}
function Find-RestorableAppWindow([object[]]$processes, [string]$displayName) {
  $displayKey = Normalize-AppName $displayName
  $ranked = @()
  foreach ($process in $processes) {
    foreach ($window in @([DshPetWindow]::ListProcessWindows([int]$process.Id))) {
      $area = [int64]$window.Width * [int64]$window.Height
      $hasTitle = -not [string]::IsNullOrWhiteSpace([string]$window.Title)
      # 排除小型内部/消息窗口；正常主窗口至少有标题、AppWindow 标记或足够大的可见区域。
      if (-not $hasTitle -and -not $window.AppWindow -and (-not $window.Visible -or $area -lt 30000)) { continue }
      if ($window.ToolWindow -and -not $window.AppWindow -and -not $hasTitle) { continue }
      $score = 0
      if ($window.Visible) { $score += 120 }
      if ($window.Minimized) { $score += 90 }
      if (-not $window.Cloaked) { $score += 35 }
      if ($hasTitle) { $score += 60 }
      if (-not $window.Owned) { $score += 25 }
      if (-not $window.ToolWindow) { $score += 15 }
      if ($area -ge 120000) { $score += 20 }
      $titleKey = Normalize-AppName ([string]$window.Title)
      if ($displayKey -and $titleKey -and ($titleKey.Contains($displayKey) -or $displayKey.Contains($titleKey))) { $score += 80 }
      $ranked += [pscustomobject]@{ Window=$window; Score=$score; Process=$process }
    }
  }
  return $ranked | Sort-Object @{Expression='Score';Descending=$true}, @{Expression={ $_.Window.Visible };Descending=$true} | Select-Object -First 1
}
function Restore-HiddenApp([string]$processName) {
  # 微信/QQ 缩到托盘后 MainWindowHandle 会变成 0，单看可见窗口会误判为“未启动”。
  # 这些客户端提供全局显示/隐藏快捷键：先唤醒现有会话，只有恢复失败才允许重新启动 EXE。
  $strategies = @{
    weixin  = @{ Keys='^%w'; Names=@('Weixin','WeChat') }
    wechat  = @{ Keys='^%w'; Names=@('Weixin','WeChat') }
    qq      = @{ Keys='^%z'; Names=@('QQ','QQNT') }
    qqnt    = @{ Keys='^%z'; Names=@('QQ','QQNT') }
  }
  $strategy = $strategies[$processName.ToLowerInvariant()]
  if ($null -eq $strategy) { return [IntPtr]::Zero }
  $running = @($strategy.Names | ForEach-Object { Get-Process -Name $_ -ErrorAction SilentlyContinue }).Count -gt 0
  if (-not $running) { return [IntPtr]::Zero }
  [System.Windows.Forms.SendKeys]::SendWait([string]$strategy.Keys)
  $handle = Find-AppWindow ([string[]]$strategy.Names) $null 2500
  if ($handle -ne [IntPtr]::Zero -and (Focus-Window $handle)) { return $handle }
  return [IntPtr]::Zero
}
function Wait-Target([string]$name, [int]$timeoutMs) {
  $deadline = [DateTime]::UtcNow.AddMilliseconds($timeoutMs)
  do {
    Ensure-NotCancelled
    try { return Target-Element $name } catch {}
    Start-Sleep -Milliseconds 80
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Timed out waiting for '$name'"
}
function Normalize-AppName([string]$value) {
  return (($value -replace '[^\p{L}\p{Nd}]', '').ToLowerInvariant())
}
function App-QueryKeys([string]$value) {
  $key = Normalize-AppName $value
  $aliases = @{
    wechat=@('微信','weixin'); weixin=@('微信','wechat'); 微信=@('wechat','weixin')
    googlechrome=@('chrome','谷歌浏览器'); chrome=@('googlechrome','谷歌浏览器'); 谷歌浏览器=@('googlechrome','chrome')
    microsoftedge=@('edge'); edge=@('microsoftedge')
    网易云=@('网易云音乐'); cloudmusic=@('网易云音乐'); 网易云音乐=@('网易云','cloudmusic')
    notepad=@('记事本'); 记事本=@('notepad')
  }
  $keys = @($key)
  foreach ($alias in @($aliases[$key])) {
    $normalized = Normalize-AppName ([string]$alias)
    if ($normalized -and $normalized -notin $keys) { $keys += $normalized }
  }
  return $keys
}
function Is-BlockedRegisteredApp([string]$name, [string]$appId) {
  $text = "$name $appId"
  return $text -match '(?i)(卸载|uninstall|unins\d*|命令提示符|command prompt|powershell|pwsh|windows terminal|终端|cmd\.exe|regedit|注册表|组策略|任务计划|服务管理|设备管理器|磁盘管理|控制面板|windows 安全|defender|火绒|安全中心|脚本宿主|wscript|cscript|mshta|rundll32|msiexec|管理员工具)'
}
function Resolve-RegisteredApp([string]$query) {
  $needles = @(App-QueryKeys $query)
  if ($needles.Count -eq 0 -or -not $needles[0]) { throw 'Application name is empty' }
  $scored = @()
  foreach ($app in @(Get-StartApps)) {
    $name = [string]$app.Name
    $appId = [string]$app.AppID
    if (-not $name -or -not $appId -or (Is-BlockedRegisteredApp $name $appId)) { continue }
    $normalized = Normalize-AppName $name
    $score = 0
    $matchedNeedle = $needles[0]
    foreach ($needle in $needles) {
      $candidateScore = 0
      if ($normalized -eq $needle) { $candidateScore = 100 }
      elseif ($normalized.StartsWith($needle)) { $candidateScore = 80 }
      elseif ($normalized.Contains($needle)) { $candidateScore = 70 }
      elseif ($needle.Contains($normalized)) { $candidateScore = 60 }
      if ($candidateScore -gt $score) { $score = $candidateScore; $matchedNeedle = $needle }
    }
    if ($score -gt 0) {
      $scored += [pscustomobject]@{ Name=$name; AppID=$appId; Score=$score; Extra=[Math]::Abs($normalized.Length-$matchedNeedle.Length) }
    }
  }
  $ranked = @($scored | Sort-Object @{Expression='Score';Descending=$true}, @{Expression='Extra';Ascending=$true}, Name)
  if ($ranked.Count -eq 0) { throw "没有在 Windows 已安装应用中找到 [$query]" }
  $best = $ranked[0]
  $ties = @($ranked | Where-Object { $_.Score -eq $best.Score -and $_.Extra -eq $best.Extra })
  if ($ties.Count -gt 1) {
    $names = (($ties | Select-Object -First 5 -ExpandProperty Name) -join '、')
    throw "找到多个相似应用：$names。请说完整名称"
  }
  return $best
}
function Start-RegisteredApp($app) {
  $appId = [string]$app.AppID
  $displayName = [string]$app.Name
  Progress 'discovering-app' @{ name=$displayName; appId=$appId }
  $before = @{}
  Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } |
    ForEach-Object { $before[[Int64]$_.MainWindowHandle] = $true }
  $started = $null
  if ($appId -match '(?i)\.exe$' -and [IO.Path]::IsPathRooted($appId) -and (Test-Path -LiteralPath $appId -PathType Leaf)) {
    $processName = [IO.Path]::GetFileNameWithoutExtension($appId)
    $running = @(Get-RegisteredAppProcesses $appId $processName)
    $candidate = Find-RestorableAppWindow $running $displayName
    if ($null -ne $candidate) {
      Progress 'restoring-app' @{ name=$displayName; processId=[int]$candidate.Process.Id; source='window' }
      if (Focus-Window ([IntPtr]$candidate.Window.Handle)) {
        Progress 'verifying-app' @{ name=$displayName; processId=[int]$candidate.Process.Id; title=[string]$candidate.Window.Title }
        return @{ Method='existing-window'; ProcessId=[int]$candidate.Process.Id; Title=[string]$candidate.Window.Title }
      }
      # 已经找到真实顶层窗口时不能再发送“显示/隐藏”托盘快捷键。快捷键是 toggle，
      # 前台锁导致 Focus-Window 暂时失败时继续发送会把本来可见的窗口隐藏，随后又误启动新实例。
      throw "[$displayName] 窗口已存在，但 Windows 暂时不允许把它切到前台"
    }
    if ($running.Count -gt 0) {
      Progress 'restoring-app' @{ name=$displayName; processId=[int]$running[0].Id; source='tray' }
      $restored = Restore-HiddenApp $processName
      if ($restored -ne [IntPtr]::Zero) {
        Progress 'verifying-app' @{ name=$displayName; processId=[int]$running[0].Id; title=$displayName }
        return @{ Method='tray-restore'; ProcessId=[int]$running[0].Id; Title=$displayName }
      }
    }
    Progress 'launching-app' @{ name=$displayName; appId=$appId; alreadyRunning=($running.Count -gt 0) }
    $started = Start-Process -FilePath $appId -PassThru
    $handle = Find-AppWindow @($processName) $started 5000
    if ($handle -ne [IntPtr]::Zero -and (Focus-Window $handle)) {
      Progress 'verifying-app' @{ name=$displayName; processId=[int]$started.Id; title=$displayName }
      return @{ Method=$(if ($running.Count -gt 0) { 'single-instance-signal' } else { 'cold-start' }); ProcessId=[int]$started.Id; Title=$displayName }
    }
  } else {
    Progress 'launching-app' @{ name=$displayName; appId=$appId; alreadyRunning=$false }
    Start-Process -FilePath 'explorer.exe' -ArgumentList @("shell:AppsFolder\$appId")
  }
  $deadline = [DateTime]::UtcNow.AddSeconds(4)
  do {
    Start-Sleep -Milliseconds 120
    $foreground = [DshPetWindow]::GetForegroundWindow()
    if ($foreground -ne [IntPtr]::Zero -and -not $before.ContainsKey([Int64]$foreground)) {
      Progress 'verifying-app' @{ name=$displayName; title=$displayName }
      return @{ Method='registered-launch'; Title=$displayName }
    }
    $candidate = Get-Process -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowHandle -ne 0 -and -not $before.ContainsKey([Int64]$_.MainWindowHandle) } |
      Sort-Object StartTime -Descending | Select-Object -First 1
    if ($null -ne $candidate -and (Focus-Window ([IntPtr]$candidate.MainWindowHandle))) {
      Progress 'verifying-app' @{ name=$displayName; processId=[int]$candidate.Id; title=[string]$candidate.MainWindowTitle }
      return @{ Method='registered-launch'; ProcessId=[int]$candidate.Id; Title=[string]$candidate.MainWindowTitle }
    }
  } while ([DateTime]::UtcNow -lt $deadline)
  if (Focus-WindowByTitle $displayName) {
    Progress 'verifying-app' @{ name=$displayName; title=$displayName }
    return @{ Method='title-match'; Title=$displayName }
  }
  return $null
}

try {
  $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload))
  $action = $json | ConvertFrom-Json
  $script:CancelPath = [string]$action._cancelPath
  Ensure-NotCancelled
  Progress 'accepted' @{ action = [string]$action.type }
  switch ($action.type) {
    'open_app_name' {
      $app = Resolve-RegisteredApp ([string]$action.name)
      $activation = Start-RegisteredApp $app
      if ($null -eq $activation) { throw "[$($app.Name)] 已启动，但 Windows 没有找到可验证的前台窗口" }
      Complete-Action "Opened registered app '$($app.Name)'" @{
        name=[string]$app.Name; appId=[string]$app.AppID; method=[string]$activation.Method
        processId=$activation.ProcessId; title=[string]$activation.Title
      }
    }
    'open_app' {
      $apps = @{ notepad='notepad.exe'; calculator='calc.exe'; explorer='explorer.exe'; paint='mspaint.exe' }
      $exe = $apps[[string]$action.app]
      if (-not $exe) { throw 'Application is not allowlisted' }
      Progress 'discovering-app' @{ name=[string]$action.app }
      if (Focus-App ([string]$action.app)) {
        Progress 'restoring-app' @{ name=[string]$action.app; source='existing-window' }
        Progress 'verifying-app' @{ name=[string]$action.app }
        Complete-Action 'Existing application window restored'
        break
      }
      Progress 'launching-app' @{ name=[string]$action.app; alreadyRunning=$false }
      $started = Start-Process -FilePath $exe -PassThru
      if (-not (Focus-App ([string]$action.app) $started)) { throw 'Application opened, but Windows did not allow it to move to the foreground' }
      Progress 'verifying-app' @{ name=[string]$action.app; processId=[int]$started.Id }
      Complete-Action 'Application opened in the foreground'
    }
    'close_app' {
      $appName = [string]$action.app
      Progress 'discovering-app' @{ name=$appName }
      if (-not (Focus-App $appName)) {
        Complete-Action 'Application window was already closed' @{ name=$appName; alreadyClosed=$true }
        break
      }
      Progress 'committing' @{ action='close_app'; name=$appName }
      [System.Windows.Forms.SendKeys]::SendWait('%{F4}')
      Start-Sleep -Milliseconds 450
      Complete-Action 'Close request sent to the application window' @{ name=$appName }
    }
    'close_app_name' {
      $app = Resolve-RegisteredApp ([string]$action.name)
      $displayName = [string]$app.Name
      $appId = [string]$app.AppID
      Progress 'discovering-app' @{ name=$displayName; appId=$appId }
      $focused = $false
      if ($appId -match '(?i)\.exe$' -and [IO.Path]::IsPathRooted($appId)) {
        $processName = [IO.Path]::GetFileNameWithoutExtension($appId)
        $running = @(Get-RegisteredAppProcesses $appId $processName)
        $candidate = Find-RestorableAppWindow $running $displayName
        if ($null -ne $candidate) { $focused = Focus-Window ([IntPtr]$candidate.Window.Handle) }
      } else {
        $focused = Focus-WindowByTitle $displayName
      }
      if (-not $focused) {
        Complete-Action 'Application window was already closed' @{ name=$displayName; alreadyClosed=$true }
        break
      }
      Progress 'committing' @{ action='close_app_name'; name=$displayName }
      [System.Windows.Forms.SendKeys]::SendWait('%{F4}')
      Start-Sleep -Milliseconds 450
      Complete-Action 'Close request sent to the application window' @{ name=$displayName }
    }
    'media_play' {
      Progress 'committing' @{ action = 'media_play' }
      $root = Active-Root
      $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
      $play = $null
      $alreadyPlaying = $false
      foreach ($item in $all) {
        try {
          $name = [string]$item.Current.Name
          if ($name -match '^(暂停|暂停播放)$') { $alreadyPlaying = $true; break }
          if ($null -eq $play -and $name -match '^(播放|播放音乐|播放/暂停)$') { $play = $item }
        } catch {}
      }
      if (-not $alreadyPlaying) {
        if ($null -ne $play) {
          $point = Element-Center $play
          Click-At $point.X $point.Y 'click'
        } else {
          [DshPetMouse]::keybd_event(0xB3, 0, 0, [UIntPtr]::Zero)
          Start-Sleep -Milliseconds 60
          [DshPetMouse]::keybd_event(0xB3, 0, 2, [UIntPtr]::Zero)
        }
      }
      Complete-Action $(if ($alreadyPlaying) { 'Music was already playing' } else { 'Music playback started' })
    }
    'focus_app' {
      if (-not (Focus-App ([string]$action.app))) { throw 'Application opened, but its foreground window was not found' }
      Complete-Action 'Application focused'
    }
    'focus_window' {
      Progress 'committing' @{ action = 'focus_window' }
      if (-not (Focus-WindowByTitle ([string]$action.window))) { throw 'Matching foreground window was not found' }
      Complete-Action 'Window focused'
    }
    { $_ -in @('click','double_click','right_click') } {
      $p = Target-Center ([string]$action.target)
      Click-At $p.X $p.Y ([string]$action.type)
      Complete-Action "Clicked '$($action.target)'"
    }
    { $_ -in @('click_point','double_click_point','right_click_point') } {
      $kind = ([string]$action.type) -replace '_point$',''
      Click-At ([int]$action.x) ([int]$action.y) $kind
      Complete-Action 'Clicked the point'
    }
    'drag' {
      $from = Target-Center ([string]$action.from); $to = Target-Center ([string]$action.to)
      Announce-Approach 'drag'; Move-Cute $from.X $from.Y 0 'drag'
      Progress 'committing' @{ action = 'drag'; pointer = @{ x = $from.X; y = $from.Y } }
      Mouse-Down
      try { Start-Sleep -Milliseconds 100; Move-Cute $to.X $to.Y 0 'drag' } finally { Mouse-Up }
      Complete-Action "Dragged '$($action.from)' to '$($action.to)'"
    }
    'drag_point' {
      Announce-Approach 'drag'; Move-Cute ([int]$action.fromX) ([int]$action.fromY) 0 'drag'
      Progress 'committing' @{ action = 'drag'; pointer = @{ x = [int]$action.fromX; y = [int]$action.fromY } }
      Mouse-Down
      try { Start-Sleep -Milliseconds 100; Move-Cute ([int]$action.toX) ([int]$action.toY) 0 'drag' } finally { Mouse-Up }
      Complete-Action 'Drag completed'
    }
    'scroll' {
      if ($null -ne $action.target) {
        $p = Target-Center ([string]$action.target); Announce-Approach 'scroll'; Move-Cute $p.X $p.Y 0 'scroll'
      }
      Progress 'committing' @{ action = 'scroll' }
      [DshPetMouse]::mouse_event(0x0800, 0, 0, ([int]$action.amount * 120), [UIntPtr]::Zero)
      Complete-Action 'Scrolled'
    }
    'type_text' {
      $editable = Target-EditableElement ([string]$action.target)
      $element = $editable.Element
      $pattern = $editable.Pattern
      Progress 'committing' @{ action = 'type' }
      $element.SetFocus(); $pattern.SetValue([string]$action.text)
      Complete-Action 'Text entered'
    }
    'hotkey' {
      $map = @{
        escape='{ESC}'; tab='{TAB}'; 'shift+tab'='+{TAB}'; 'alt+tab'='%{TAB}';
        'ctrl+a'='^a'; 'ctrl+c'='^c'; 'ctrl+f'='^f'; 'ctrl+l'='^l'; 'ctrl+n'='^n'; 'ctrl+v'='^v'; 'ctrl+x'='^x'
      }
      $keys = $map[[string]$action.keys]
      if (-not $keys) { throw 'Hotkey is not allowlisted' }
      Progress 'committing' @{ action = 'hotkey' }
      [System.Windows.Forms.SendKeys]::SendWait($keys)
      Complete-Action 'Hotkey sent'
    }
    'wait_for' {
      [void](Wait-Target ([string]$action.target) ([int]$action.timeoutMs))
      Complete-Action 'Target appeared'
    }
    'inspect_window' {
      $root = Active-Root
      $rect = $root.Current.BoundingRectangle
      $data = @{
        name = [string]$root.Current.Name
        automationId = [string]$root.Current.AutomationId
        processId = [int]$root.Current.ProcessId
        bounds = @{ x = [int]$rect.X; y = [int]$rect.Y; width = [int]$rect.Width; height = [int]$rect.Height }
      }
      Complete-Action 'Window inspected' $data
    }
    default { throw 'Unknown action' }
  }
} catch {
  try { Mouse-Up } catch {}
  $message = $_.Exception.Message
  $stage = if ($message -like 'Cancelled*') { 'cancelled' } else { 'failed' }
  Progress $stage @{ message = $message }
  Result $false $message
  exit 1
}
