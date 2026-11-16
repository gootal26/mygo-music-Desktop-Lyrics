param(
    [string]$DataDir = $PSScriptRoot,
    [string]$Lang = "zh-CN"
)

$ErrorActionPreference = "SilentlyContinue"

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Runtime.WindowsRuntime

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class LyricsWin32 {
    public const int GWL_EXSTYLE = -20;
    public const int WS_EX_TRANSPARENT = 0x00000020;
    public const int WS_EX_TOOLWINDOW = 0x00000080;
    public const int WS_EX_NOACTIVATE = 0x08000000;

    public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    public const uint SWP_NOMOVE = 0x0002;
    public const uint SWP_NOSIZE = 0x0001;
    public const uint SWP_NOACTIVATE = 0x0010;
    private const uint LCMAP_SIMPLIFIED_CHINESE = 0x02000000;

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int LCMapStringW(uint Locale, uint dwMapFlags, string lpSrcStr, int cchSrc, StringBuilder lpDestStr, int cchDest);

    public static string ToSimplified(string text) {
        if (string.IsNullOrEmpty(text)) return text;
        try {
            int len = LCMapStringW(0x0804, LCMAP_SIMPLIFIED_CHINESE, text, text.Length, null, 0);
            if (len <= 0) return text;
            StringBuilder sb = new StringBuilder(len);
            int res = LCMapStringW(0x0804, LCMAP_SIMPLIFIED_CHINESE, text, text.Length, sb, len);
            return res > 0 ? sb.ToString() : text;
        } catch {
            return text;
        }
    }
}
"@

if (-not (Test-Path -LiteralPath $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}

$posPath = Join-Path $DataDir "window_pos.json"
$localIndexPath = [System.IO.Path]::GetFullPath((Join-Path $DataDir "..\..\local\index.json"))

# Use raw standard pipes with explicit UTF-8 + ASCII JSON escaping to prevent GBK mojibake
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$stdinReader = [System.IO.StreamReader]::new([Console]::OpenStandardInput(), $utf8NoBom)
$stdoutWriter = [System.IO.StreamWriter]::new([Console]::OpenStandardOutput(), $utf8NoBom)
$stdoutWriter.AutoFlush = $true

$cmdQueue = [System.Collections.Concurrent.ConcurrentQueue[string]]::new()
$stateQueue = [System.Collections.Concurrent.ConcurrentQueue[hashtable]]::new()
$configBox = [hashtable]::Synchronized(@{
    locked = $false
    onlineLyrics = $true
    simplifyChinese = ($Lang -eq "zh-CN")
    showTranslation = $true
    offsetMs = 0
    fontSize = "medium"
    position = "bottom"
    accentColor = "coral"
    backdropStyle = "subtle"
    localDirs = ""
    lang = $Lang
    uiLock = "Lock"
    uiWait = "MyGo Music"
})
$outLock = [object]::new()
$runningFlag = [hashtable]::Synchronized(@{ alive = $true })

function Escape-AsciiJson([string]$json) {
    $sb = [System.Text.StringBuilder]::new($json.Length + 32)
    foreach ($ch in $json.ToCharArray()) {
        $code = [int][char]$ch
        if ($code -gt 127) {
            [void]$sb.AppendFormat("\u{0:x4}", $code)
        } else {
            [void]$sb.Append($ch)
        }
    }
    return $sb.ToString()
}

function Send-HostMessage([hashtable]$Obj) {
    $json = Escape-AsciiJson ($Obj | ConvertTo-Json -Compress)
    [System.Threading.Monitor]::Enter($outLock)
    try {
        $stdoutWriter.WriteLine($json)
        $stdoutWriter.Flush()
    } finally {
        [System.Threading.Monitor]::Exit($outLock)
    }
}

# Stdin reader runspace (exits cleanly when parent closes stdin)
$stdinRunspace = [runspacefactory]::CreateRunspace()
$stdinRunspace.Open()
$stdinRunspace.SessionStateProxy.SetVariable("cmdQueue", $cmdQueue)
$stdinRunspace.SessionStateProxy.SetVariable("runningFlag", $runningFlag)
$stdinRunspace.SessionStateProxy.SetVariable("stdinReader", $stdinReader)
$stdinPs = [powershell]::Create()
$stdinPs.Runspace = $stdinRunspace
$null = $stdinPs.AddScript({
    try {
        while ($runningFlag.alive) {
            $line = $stdinReader.ReadLine()
            if ($null -eq $line) {
                $cmdQueue.Enqueue('{"type":"stop"}')
                break
            }
            if (-not [string]::IsNullOrWhiteSpace($line)) {
                $cmdQueue.Enqueue($line)
            }
        }
    } catch {
        $cmdQueue.Enqueue('{"type":"stop"}')
    }
})
$stdinHandle = $stdinPs.BeginInvoke()

# SMTC + Local LRC poller runspace
$smtcRunspace = [runspacefactory]::CreateRunspace()
$smtcRunspace.Open()
$smtcRunspace.SessionStateProxy.SetVariable("stateQueue", $stateQueue)
$smtcRunspace.SessionStateProxy.SetVariable("configBox", $configBox)
$smtcRunspace.SessionStateProxy.SetVariable("runningFlag", $runningFlag)
$smtcRunspace.SessionStateProxy.SetVariable("outLock", $outLock)
$smtcRunspace.SessionStateProxy.SetVariable("stdoutWriter", $stdoutWriter)
$smtcRunspace.SessionStateProxy.SetVariable("localIndexPath", $localIndexPath)
$smtcPs = [powershell]::Create()
$smtcPs.Runspace = $smtcRunspace
$null = $smtcPs.AddScript({
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
    $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
    $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus, Windows.Media.Control, ContentType = WindowsRuntime]

    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]

    function Await-WinRT($WinRtTask, $ResultType) {
        $netTask = $asTaskGeneric.MakeGenericMethod($ResultType).Invoke($null, @($WinRtTask))
        $netTask.Wait(-1) | Out-Null
        return $netTask.Result
    }

    function Escape-Ascii([string]$json) {
        $sb = [System.Text.StringBuilder]::new($json.Length + 32)
        foreach ($ch in $json.ToCharArray()) {
            $code = [int][char]$ch
            if ($code -gt 127) {
                [void]$sb.AppendFormat("\u{0:x4}", $code)
            } else {
                [void]$sb.Append($ch)
            }
        }
        return $sb.ToString()
    }

    function Emit-NeedLyrics($reqId, $title, $artist, $album, $durationMs) {
        $json = Escape-Ascii (@{
            type = "needLyrics"
            id = $reqId
            title = $title
            artist = $artist
            album = $album
            durationMs = $durationMs
        } | ConvertTo-Json -Compress)
        [System.Threading.Monitor]::Enter($outLock)
        try {
            $stdoutWriter.WriteLine($json)
            $stdoutWriter.Flush()
        } finally {
            [System.Threading.Monitor]::Exit($outLock)
        }
    }

    function Read-TextSmart([string]$Path) {
        if (-not (Test-Path -LiteralPath $Path)) { return "" }
        $bytes = [System.IO.File]::ReadAllBytes($Path)
        if ($bytes.Length -eq 0) { return "" }
        if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
            return [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
        }
        try {
            $strictUtf8 = [System.Text.UTF8Encoding]::new($false, $true)
            return $strictUtf8.GetString($bytes)
        } catch {
            try {
                return [System.Text.Encoding]::GetEncoding(936).GetString($bytes)
            } catch {
                return [System.Text.Encoding]::Default.GetString($bytes)
            }
        }
    }

    $cachedIndexMtime = [datetime]::MinValue
    $cachedTracks = @()

    function Get-LocalIndexTracks {
        if (-not (Test-Path -LiteralPath $localIndexPath)) { return @() }
        $info = Get-Item -LiteralPath $localIndexPath
        if ($info.LastWriteTimeUtc -ne $cachedIndexMtime) {
            $cachedIndexMtime = $info.LastWriteTimeUtc
            try {
                $raw = [System.IO.File]::ReadAllText($localIndexPath, [System.Text.Encoding]::UTF8)
                $parsed = $raw | ConvertFrom-Json
                if ($parsed -and $parsed.tracks) {
                    $cachedTracks = $parsed.tracks
                } else {
                    $cachedTracks = @()
                }
            } catch {
                $cachedTracks = @()
            }
        }
        return $cachedTracks
    }

    function Find-LocalLrc([string]$Title, [string]$Artist, [string]$Album, [string]$ExtraDirs) {
        $tNorm = $Title.Trim().ToLowerInvariant()
        $aNorm = $Artist.Trim().ToLowerInvariant()

        foreach ($tr in (Get-LocalIndexTracks)) {
            $trTitle = ([string]$tr.title).Trim().ToLowerInvariant()
            if ($trTitle -ne $tNorm) { continue }
            $trArtist = ([string]$tr.artist).Trim().ToLowerInvariant()
            if ($aNorm -and $trArtist -and ($trArtist -ne $aNorm) -and (-not $trArtist.Contains($aNorm)) -and (-not $aNorm.Contains($trArtist))) {
                continue
            }
            if ($tr.path) {
                $lrcPath = [System.IO.Path]::ChangeExtension($tr.path, ".lrc")
                if (Test-Path -LiteralPath $lrcPath) {
                    return Read-TextSmart $lrcPath
                }
            }
        }

        if (-not [string]::IsNullOrWhiteSpace($ExtraDirs)) {
            $safeTitle = $Title -replace '[\\/:*?"<>|]', '_'
            $safeArtist = $Artist -replace '[\\/:*?"<>|]', '_'
            $candidates = @()
            if ($safeArtist) {
                $candidates += "$safeArtist - $safeTitle.lrc"
                $candidates += "$safeTitle - $safeArtist.lrc"
            }
            $candidates += "$safeTitle.lrc"
            foreach ($dir in ($ExtraDirs -split ';')) {
                $d = $dir.Trim()
                if (-not $d -or -not (Test-Path -LiteralPath $d)) { continue }
                foreach ($name in $candidates) {
                    $p = Join-Path $d $name
                    if (Test-Path -LiteralPath $p) {
                        return Read-TextSmart $p
                    }
                }
            }
        }
        return ""
    }

    $mgr = $null
    try {
        $mgr = Await-WinRT ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    } catch {}

    $lastTrackKey = ""
    $reqCounter = 0

    while ($runningFlag.alive) {
        try {
            if ($null -eq $mgr) {
                $mgr = Await-WinRT ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
            }
            $session = $null
            if ($null -ne $mgr) {
                $sessions = $mgr.GetSessions()
                foreach ($s in $sessions) {
                    if ($s.SourceAppUserModelId -match 'mygo') {
                        $session = $s
                        break
                    }
                }
                if ($null -eq $session) {
                    $session = $mgr.GetCurrentSession()
                }
            }

            if ($null -eq $session) {
                $stateQueue.Enqueue(@{
                    hasSession = $false
                    playing = $false
                    title = ""
                    artist = ""
                    album = ""
                    posMs = 0.0
                    durMs = 0.0
                    hasValidUpdated = $false
                    updatedUtc = [datetime]::UtcNow
                })
                Start-Sleep -Milliseconds 350
                continue
            }

            $pb = $session.GetPlaybackInfo()
            $tl = $session.GetTimelineProperties()
            $props = Await-WinRT ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])

            $title = if ($props -and $props.Title) { [string]$props.Title } else { "" }
            $artist = if ($props -and $props.Artist) { [string]$props.Artist } else { "" }
            $album = if ($props -and $props.AlbumTitle) { [string]$props.AlbumTitle } else { "" }
            $isPlaying = ($pb -and $pb.PlaybackStatus -eq [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing)
            $posMs = if ($tl) { [double]$tl.Position.TotalMilliseconds } else { 0.0 }
            $durMs = if ($tl) { [double]$tl.EndTime.TotalMilliseconds } else { 0.0 }
            $hasValidUpdated = $false
            $updatedUtc = [datetime]::UtcNow
            if ($tl -and $tl.LastUpdatedTime.Year -ge 2000) {
                $hasValidUpdated = $true
                $updatedUtc = $tl.LastUpdatedTime.UtcDateTime
            }

            $trackKey = "$title`0$artist`0$album"
            if ($title -and $trackKey -ne $lastTrackKey) {
                $lastTrackKey = $trackKey
                $reqCounter++
                $localLrc = Find-LocalLrc -Title $title -Artist $artist -Album $album -ExtraDirs $configBox.localDirs
                if ($localLrc) {
                    $stateQueue.Enqueue(@{
                        type = "localLyrics"
                        trackKey = $trackKey
                        lrc = $localLrc
                    })
                } elseif ($configBox.onlineLyrics) {
                    Emit-NeedLyrics -reqId "$reqCounter|$trackKey" -title $title -artist $artist -album $album -durationMs ([long]$durMs)
                }
            }

            $stateQueue.Enqueue(@{
                hasSession = $true
                trackKey = $trackKey
                playing = $isPlaying
                title = $title
                artist = $artist
                album = $album
                posMs = $posMs
                durMs = $durMs
                hasValidUpdated = $hasValidUpdated
                updatedUtc = $updatedUtc
            })
        } catch {}
        Start-Sleep -Milliseconds 200
    }
})
$smtcHandle = $smtcPs.BeginInvoke()

function Maybe-Simplify([string]$text) {
    if (-not $text) { return "" }
    if ($configBox.simplifyChinese) {
        return [LyricsWin32]::ToSimplified($text)
    }
    return $text
}

function Parse-LrcLines([string]$Raw) {
    if ([string]::IsNullOrWhiteSpace($Raw)) { return @() }
    $offsetMs = 0
    $entries = [System.Collections.Generic.List[object]]::new()
    $timeRegex = [regex]'\[(\d+):(\d+)(?:[.:](\d+))?\]'
    $offsetRegex = [regex]'^\[offset:([+-]?\d+)\]$'

    foreach ($rawLine in ($Raw -split "`r?`n")) {
        $line = $rawLine.Trim()
        if (-not $line) { continue }
        $om = $offsetRegex.Match($line)
        if ($om.Success) {
            $offsetMs = [int]$om.Groups[1].Value
            continue
        }
        $matches = $timeRegex.Matches($line)
        if ($matches.Count -eq 0) { continue }
        $lastMatch = $matches[$matches.Count - 1]
        $text = $line.Substring($lastMatch.Index + $lastMatch.Length).Trim()
        foreach ($m in $matches) {
            $mins = [int]$m.Groups[1].Value
            $secs = [int]$m.Groups[2].Value
            $fracMs = 0
            if ($m.Groups[3].Success) {
                $f = $m.Groups[3].Value
                if ($f.Length -eq 1) { $fracMs = [int]$f * 100 }
                elseif ($f.Length -eq 2) { $fracMs = [int]$f * 10 }
                else { $fracMs = [int]$f.Substring(0, 3) }
            }
            $atMs = ($mins * 60 + $secs) * 1000 + $fracMs + $offsetMs
            if ($atMs -lt 0) { $atMs = 0 }
            $entries.Add([PSCustomObject]@{ At = [double]$atMs; Text = $text })
        }
    }
    return ($entries | Sort-Object At)
}

function Parse-Lrc([string]$Raw, [string]$TransRaw = "") {
    $sorted = Parse-LrcLines $Raw
    if ($sorted.Count -eq 0) { return @() }
    $merged = [System.Collections.Generic.List[object]]::new()
    foreach ($e in $sorted) {
        if ($merged.Count -gt 0 -and [math]::Abs($merged[$merged.Count - 1].At - $e.At) -lt 40) {
            $prev = $merged[$merged.Count - 1]
            if ($e.Text -and -not $prev.Translation -and $e.Text -ne $prev.Text) {
                $prev.Translation = $e.Text
            }
        } else {
            if ($e.Text) {
                $merged.Add([PSCustomObject]@{ At = $e.At; Text = $e.Text; Translation = "" })
            }
        }
    }
    if (-not [string]::IsNullOrWhiteSpace($TransRaw)) {
        $transEntries = Parse-LrcLines $TransRaw
        foreach ($te in $transEntries) {
            if (-not $te.Text) { continue }
            $best = $null
            $bestDiff = 250.0
            foreach ($ml in $merged) {
                $diff = [math]::Abs($ml.At - $te.At)
                if ($diff -lt $bestDiff) {
                    $bestDiff = $diff
                    $best = $ml
                }
            }
            if ($null -ne $best -and -not $best.Translation -and $te.Text -ne $best.Text) {
                $best.Translation = $te.Text
            }
        }
    }
    return $merged.ToArray()
}

# Build WPF overlay window (pure ASCII XAML)
$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Width="940" Height="124"
        WindowStyle="None"
        AllowsTransparency="True"
        Background="Transparent"
        Topmost="True"
        ShowInTaskbar="False"
        ResizeMode="NoResize"
        SnapsToDevicePixels="True"
        TextOptions.TextFormattingMode="Display"
        TextOptions.TextRenderingMode="ClearType">
    <Window.Resources>
        <Style x:Key="HudBtnStyle" TargetType="Button">
            <Setter Property="Foreground" Value="#EEF4F4F6"/>
            <Setter Property="Background" Value="#26FFFFFF"/>
            <Setter Property="FontFamily" Value="Microsoft YaHei UI, Segoe UI"/>
            <Setter Property="FontSize" Value="11"/>
            <Setter Property="FontWeight" Value="Medium"/>
            <Setter Property="Padding" Value="9,3"/>
            <Setter Property="Cursor" Value="Hand"/>
            <Setter Property="Template">
                <Setter.Value>
                    <ControlTemplate TargetType="Button">
                        <Border x:Name="Bd"
                                CornerRadius="7"
                                Background="{TemplateBinding Background}"
                                Padding="{TemplateBinding Padding}">
                            <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
                        </Border>
                        <ControlTemplate.Triggers>
                            <Trigger Property="IsMouseOver" Value="True">
                                <Setter TargetName="Bd" Property="Background" Value="#48FFFFFF"/>
                                <Setter Property="Foreground" Value="#FFFFFFFF"/>
                            </Trigger>
                            <Trigger Property="IsPressed" Value="True">
                                <Setter TargetName="Bd" Property="Background" Value="#60FFFFFF"/>
                            </Trigger>
                        </ControlTemplate.Triggers>
                    </ControlTemplate>
                </Setter.Value>
            </Setter>
        </Style>
    </Window.Resources>
    <Border x:Name="RootCard" CornerRadius="20" Padding="32,12" Background="#94131418" BorderThickness="1" BorderBrush="#24FFFFFF">
        <Grid>
            <StackPanel VerticalAlignment="Center" HorizontalAlignment="Center">
                <TextBlock x:Name="MainLine"
                           Text="MyGo Music"
                           FontFamily="Microsoft YaHei UI, Segoe UI"
                           FontSize="28"
                           FontWeight="SemiBold"
                           Foreground="#FFFF7466"
                           TextAlignment="Center"
                           TextTrimming="CharacterEllipsis">
                    <TextBlock.Effect>
                        <DropShadowEffect ShadowDepth="1" BlurRadius="4" Color="#B0000000" Opacity="0.72"/>
                    </TextBlock.Effect>
                </TextBlock>
                <TextBlock x:Name="SubLine"
                           Text=""
                           Margin="0,5,0,0"
                           FontFamily="Microsoft YaHei UI, Segoe UI"
                           FontSize="15"
                           FontWeight="Normal"
                           Foreground="#EBF3F4F6"
                           TextAlignment="Center"
                           TextTrimming="CharacterEllipsis">
                    <TextBlock.Effect>
                        <DropShadowEffect ShadowDepth="1" BlurRadius="3" Color="#A0000000" Opacity="0.68"/>
                    </TextBlock.Effect>
                </TextBlock>
            </StackPanel>

            <StackPanel x:Name="ControlsBar"
                        Orientation="Horizontal"
                        HorizontalAlignment="Right"
                        VerticalAlignment="Top"
                        Visibility="Collapsed">
                <Button x:Name="EarlyBtn"
                        Style="{StaticResource HudBtnStyle}"
                        Content="-0.5s"
                        Margin="0,0,5,0"/>
                <Button x:Name="LateBtn"
                        Style="{StaticResource HudBtnStyle}"
                        Content="+0.5s"
                        Margin="0,0,5,0"/>
                <Button x:Name="LockBtn"
                        Style="{StaticResource HudBtnStyle}"
                        Content="Lock"
                        Margin="0,0,5,0"/>
                <Button x:Name="CloseBtn"
                        Style="{StaticResource HudBtnStyle}"
                        Content="&#x00D7;"
                        Padding="9,2"
                        FontSize="13"/>
            </StackPanel>
        </Grid>
    </Border>
</Window>
"@

$reader = New-Object System.Xml.XmlNodeReader ([xml]$xaml)
$win = [Windows.Markup.XamlReader]::Load($reader)
$rootCard = $win.FindName("RootCard")
$mainLine = $win.FindName("MainLine")
$subLine = $win.FindName("SubLine")
$controlsBar = $win.FindName("ControlsBar")
$earlyBtn = $win.FindName("EarlyBtn")
$lateBtn = $win.FindName("LateBtn")
$lockBtn = $win.FindName("LockBtn")
$closeBtn = $win.FindName("CloseBtn")

$workArea = [System.Windows.SystemParameters]::WorkArea
$script:hwnd = [IntPtr]::Zero
$script:hasCustomPos = $false
$script:nudgeMs = 0

function Set-DefaultPosition {
    $win.Left = $workArea.Left + ($workArea.Width - $win.Width) / 2
    if ($configBox.position -eq "top") {
        $win.Top = $workArea.Top + 18
    } else {
        $win.Top = $workArea.Bottom - $win.Height - 24
    }
}

if (Test-Path -LiteralPath $posPath) {
    try {
        $savedPos = ([System.IO.File]::ReadAllText($posPath, $utf8NoBom)) | ConvertFrom-Json
        if ($null -ne $savedPos.left -and $null -ne $savedPos.top) {
            $win.Left = [double]$savedPos.left
            $win.Top = [double]$savedPos.top
            $script:hasCustomPos = $true
        }
    } catch {}
}
if (-not $script:hasCustomPos) {
    Set-DefaultPosition
}

function Apply-RestingBackdrop {
    $brushConv = [System.Windows.Media.BrushConverter]::new()
    if ($configBox.backdropStyle -eq "transparent") {
        $rootCard.Background = $brushConv.ConvertFromString("#01000000")
        $rootCard.BorderBrush = [System.Windows.Media.Brushes]::Transparent
    } else {
        $rootCard.Background = $brushConv.ConvertFromString("#8A121318")
        $rootCard.BorderBrush = $brushConv.ConvertFromString("#22FFFFFF")
    }
}

function Apply-WindowStyle {
    if ($script:hwnd -eq [IntPtr]::Zero) { return }
    $ex = [LyricsWin32]::GetWindowLong($script:hwnd, [LyricsWin32]::GWL_EXSTYLE)
    $ex = $ex -bor [LyricsWin32]::WS_EX_TOOLWINDOW -bor [LyricsWin32]::WS_EX_NOACTIVATE
    if ($configBox.locked) {
        $ex = $ex -bor [LyricsWin32]::WS_EX_TRANSPARENT
        $controlsBar.Visibility = [System.Windows.Visibility]::Collapsed
        Apply-RestingBackdrop
    } else {
        $ex = $ex -band (-bnot [LyricsWin32]::WS_EX_TRANSPARENT)
    }
    [void][LyricsWin32]::SetWindowLong($script:hwnd, [LyricsWin32]::GWL_EXSTYLE, $ex)
    [void][LyricsWin32]::SetWindowPos($script:hwnd, [LyricsWin32]::HWND_TOPMOST, 0, 0, 0, 0, [LyricsWin32]::SWP_NOMOVE -bor [LyricsWin32]::SWP_NOSIZE -bor [LyricsWin32]::SWP_NOACTIVATE)
}

function Apply-VisualTheme {
    $brushConv = [System.Windows.Media.BrushConverter]::new()
    $accentHex = switch ($configBox.accentColor) {
        "sky"   { "#FF66D1FF" }
        "gold"  { "#FFFFD56A" }
        "mint"  { "#FF5AE8C8" }
        default { "#FFFF7466" }
    }
    $mainLine.Foreground = $brushConv.ConvertFromString($accentHex)
    switch ($configBox.fontSize) {
        "small" {
            $mainLine.FontSize = 22
            $subLine.FontSize = 14
            $win.Height = 100
        }
        "large" {
            $mainLine.FontSize = 34
            $subLine.FontSize = 18
            $win.Height = 138
        }
        default {
            $mainLine.FontSize = 28
            $subLine.FontSize = 15
            $win.Height = 124
        }
    }
    $lockBtn.Content = if ($configBox.uiLock) { $configBox.uiLock } else { "Lock" }
    Apply-RestingBackdrop
    Apply-WindowStyle
}

$win.Add_SourceInitialized({
    $helper = New-Object System.Windows.Interop.WindowInteropHelper($win)
    $script:hwnd = $helper.Handle
    Apply-VisualTheme
})

$rootCard.Add_MouseEnter({
    if (-not $configBox.locked) {
        $brushConv = [System.Windows.Media.BrushConverter]::new()
        $rootCard.Background = $brushConv.ConvertFromString("#B814151B")
        $rootCard.BorderBrush = $brushConv.ConvertFromString("#3CFFFFFF")
        $controlsBar.Visibility = [System.Windows.Visibility]::Visible
    }
})

$rootCard.Add_MouseLeave({
    Apply-RestingBackdrop
    $controlsBar.Visibility = [System.Windows.Visibility]::Collapsed
})

$rootCard.Add_MouseLeftButtonDown({
    if (-not $configBox.locked) {
        try {
            $win.DragMove()
            $script:hasCustomPos = $true
            $posJson = @{ left = $win.Left; top = $win.Top } | ConvertTo-Json -Compress
            [System.IO.File]::WriteAllText($posPath, $posJson, $utf8NoBom)
        } catch {}
    }
})

$earlyBtn.Add_Click({ $script:nudgeMs += 500 })
$lateBtn.Add_Click({ $script:nudgeMs -= 500 })

$lockBtn.Add_Click({
    $configBox.locked = $true
    Apply-WindowStyle
    Send-HostMessage @{ type = "lockChanged"; locked = $true }
})

$closeBtn.Add_Click({
    Send-HostMessage @{ type = "closedByUser" }
    $runningFlag.alive = $false
    $win.Close()
})

# Playback & lyrics state on UI thread
$script:currentTrackKey = ""
$script:currentTitle = ""
$script:currentArtist = ""
$script:isPlaying = $false
$script:hasSession = $false
$script:basePosMs = 0.0
$script:baseDurMs = 0.0
$script:baseAtUtc = [datetime]::UtcNow
$script:lastRawPosMs = -1.0
$script:lastRawUpdatedTicks = 0L
$script:lyricsLines = @()
$script:plainText = ""

function Update-LyricsDisplay {
    if (-not $script:hasSession -or -not $script:currentTitle) {
        $mainLine.Text = if ($configBox.uiWait) { $configBox.uiWait } else { "MyGo Music" }
        $subLine.Text = ""
        $subLine.Visibility = [System.Windows.Visibility]::Collapsed
        return
    }

    $posMs = $script:basePosMs
    if ($script:isPlaying) {
        $elapsed = ([datetime]::UtcNow - $script:baseAtUtc).TotalMilliseconds
        if ($elapsed -gt 0) { $posMs += $elapsed }
        if ($script:baseDurMs -gt 0 -and $posMs -gt $script:baseDurMs) {
            $posMs = $script:baseDurMs
        }
    }
    $posMs += [double]($configBox.offsetMs + $script:nudgeMs)
    if ($posMs -lt 0) { $posMs = 0 }

    if ($script:lyricsLines.Count -gt 0) {
        $idx = -1
        for ($i = 0; $i -lt $script:lyricsLines.Count; $i++) {
            if ($script:lyricsLines[$i].At -le ($posMs + 120)) {
                $idx = $i
            } else {
                break
            }
        }
        if ($idx -lt 0) {
            $mainLine.Text = Maybe-Simplify $script:currentTitle
            $subLine.Text = if ($configBox.showTranslation) { Maybe-Simplify $script:lyricsLines[0].Text } else { "" }
        } else {
            $cur = $script:lyricsLines[$idx]
            $mainLine.Text = Maybe-Simplify $cur.Text
            if ($configBox.showTranslation) {
                if ($cur.Translation) {
                    $subLine.Text = Maybe-Simplify $cur.Translation
                } elseif ($idx + 1 -lt $script:lyricsLines.Count) {
                    $subLine.Text = Maybe-Simplify $script:lyricsLines[$idx + 1].Text
                } else {
                    $subLine.Text = ""
                }
            } else {
                $subLine.Text = ""
            }
        }
    } elseif ($script:plainText) {
        $firstLine = (($script:plainText -split "`r?`n") | Where-Object { $_.Trim() } | Select-Object -First 1)
        $mainLine.Text = Maybe-Simplify $(if ($firstLine) { $firstLine } else { $script:currentTitle })
        $subLine.Text = Maybe-Simplify $script:currentArtist
    } else {
        $mainLine.Text = Maybe-Simplify $script:currentTitle
        $subLine.Text = Maybe-Simplify $script:currentArtist
    }

    $subLine.Visibility = if ([string]::IsNullOrWhiteSpace($subLine.Text)) {
        [System.Windows.Visibility]::Collapsed
    } else {
        [System.Windows.Visibility]::Visible
    }
}

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(50)
$timer.Add_Tick({
    $rawCmd = $null
    while ($cmdQueue.TryDequeue([ref]$rawCmd)) {
        try {
            $cmd = $rawCmd | ConvertFrom-Json
            if ($null -eq $cmd) { continue }
            switch ($cmd.type) {
                "stop" {
                    $runningFlag.alive = $false
                    $timer.Stop()
                    $win.Close()
                    return
                }
                "config" {
                    $oldPos = $configBox.position
                    $configBox.locked = [bool]$cmd.locked
                    $configBox.onlineLyrics = [bool]$cmd.onlineLyrics
                    $configBox.simplifyChinese = [bool]$cmd.simplifyChinese
                    $configBox.showTranslation = [bool]$cmd.showTranslation
                    $configBox.offsetMs = [int]$cmd.offsetMs
                    if ($cmd.fontSize) { $configBox.fontSize = [string]$cmd.fontSize }
                    if ($cmd.position) { $configBox.position = [string]$cmd.position }
                    if ($cmd.accentColor) { $configBox.accentColor = [string]$cmd.accentColor }
                    if ($cmd.backdropStyle) { $configBox.backdropStyle = [string]$cmd.backdropStyle }
                    $configBox.localDirs = [string]$cmd.localDirs
                    if ($cmd.lang) { $configBox.lang = [string]$cmd.lang }
                    if ($cmd.uiLock) { $configBox.uiLock = [string]$cmd.uiLock }
                    if ($cmd.uiWait) { $configBox.uiWait = [string]$cmd.uiWait }
                    Apply-VisualTheme
                    if (-not $script:hasCustomPos -and $oldPos -ne $configBox.position) {
                        Set-DefaultPosition
                    }
                }
                "resetPos" {
                    $script:hasCustomPos = $false
                    if (Test-Path -LiteralPath $posPath) { Remove-Item -LiteralPath $posPath -Force }
                    Set-DefaultPosition
                }
                "lyrics" {
                    $parts = ([string]$cmd.id) -split '\|', 2
                    $targetKey = if ($parts.Count -eq 2) { $parts[1] } else { "" }
                    if (-not $targetKey -or $targetKey -eq $script:currentTrackKey) {
                        if ($cmd.lrc) {
                            $script:lyricsLines = Parse-Lrc ([string]$cmd.lrc) ([string]$cmd.tlyric)
                            $script:plainText = ""
                        } elseif ($cmd.plain) {
                            $script:lyricsLines = @()
                            $script:plainText = [string]$cmd.plain
                        }
                    }
                }
            }
        } catch {}
    }

    $st = $null
    while ($stateQueue.TryDequeue([ref]$st)) {
        if ($st.type -eq "localLyrics") {
            if ($st.trackKey -eq $script:currentTrackKey) {
                $script:lyricsLines = Parse-Lrc ([string]$st.lrc) ""
                $script:plainText = ""
            }
            continue
        }
        $script:hasSession = [bool]$st.hasSession
        if (-not $script:hasSession) {
            $script:currentTrackKey = ""
            $script:currentTitle = ""
            $script:currentArtist = ""
            $script:isPlaying = $false
            $script:lastRawPosMs = -1.0
            $script:lastRawUpdatedTicks = 0L
            $script:lyricsLines = @()
            $script:plainText = ""
            continue
        }

        $trackChanged = ($st.trackKey -ne $script:currentTrackKey)
        if ($trackChanged) {
            $script:currentTrackKey = [string]$st.trackKey
            $script:lyricsLines = @()
            $script:plainText = ""
            $script:nudgeMs = 0
        }

        $playChanged = ([bool]$st.playing -ne $script:isPlaying)
        $rawPos = [double]$st.posMs
        $rawTicks = ([datetime]$st.updatedUtc).Ticks
        $hasValidUpd = [bool]$st.hasValidUpdated
        $posChanged = ([math]::Abs($rawPos - $script:lastRawPosMs) -gt 20.0)
        $updChanged = ($hasValidUpd -and $rawTicks -ne $script:lastRawUpdatedTicks)

        if ($trackChanged -or $playChanged -or $posChanged -or $updChanged) {
            $script:basePosMs = $rawPos
            $script:lastRawPosMs = $rawPos
            if ($hasValidUpd) {
                $script:lastRawUpdatedTicks = $rawTicks
                $script:baseAtUtc = [datetime]$st.updatedUtc
            } else {
                $script:baseAtUtc = [datetime]::UtcNow
            }
        }

        $script:currentTitle = [string]$st.title
        $script:currentArtist = [string]$st.artist
        $script:isPlaying = [bool]$st.playing
        $script:baseDurMs = [double]$st.durMs
    }

    Update-LyricsDisplay
})

$win.Add_Closed({
    $runningFlag.alive = $false
    try { $timer.Stop() } catch {}
    try { $stdinPs.Dispose(); $stdinRunspace.Dispose() } catch {}
    try { $smtcPs.Dispose(); $smtcRunspace.Dispose() } catch {}
})

$timer.Start()
$null = $win.ShowDialog()
